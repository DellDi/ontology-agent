package com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence;

import com.dip3.ontologyagent.ingestion.api.DataProductVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionPersistencePort;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

@Testcontainers
class IngestionPersistenceTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

    private JdbcTemplate jdbc;
    private IngestionPersistencePort persistence;
    private DatasetVersionSetPostgresAdapter versionSets;

    @BeforeAll
    static void migrate() {
        MigrationTestSupport.migrate(POSTGRES);
    }

    @BeforeEach
    void reset() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        persistence = new IngestionPostgresPersistenceAdapter(
                jdbc, new JsonCodec(), new JdbcTransactionManager(dataSource));
        versionSets = new DatasetVersionSetPostgresAdapter(jdbc, new JsonCodec());
        jdbc.execute("""
                truncate ingestion.dataset_version_set_items, ingestion.dataset_version_sets,
                  ingestion.data_product_version_lineage, ingestion.data_product_versions,
                  ingestion.product_materialization_runs, ingestion.dataset_cursors,
                  ingestion.source_dataset_batches, ingestion.source_dataset_versions,
                  ingestion.source_ingestion_runs,
                  ingestion.data_product_inputs, ingestion.data_product_definitions,
                  ingestion.dataset_definitions, ingestion.source_definitions cascade
                """);
        registerDefinitions();
    }

    @Test
    void publishesOneSourceSnapshotWithTwoDatasetVersionsAndCursorsAtomically() {
        reserveAndAppendSource("source-run-a", "1");
        var publication = sourcePublication("source-run-a", "1", "1");

        List<DatasetVersion> versions = persistence.publishSourceSnapshot(publication);
        List<DatasetVersion> repeated = persistence.publishSourceSnapshot(publication);
        assertEquals(versions, persistence.reserveSourceVersions(sourceReservation("source-run-a", "1")));
        var retriedBatch = appendSourceBatch("version-a-1", 1, 2, payload("dataset-a-1"));

        assertEquals(List.of(1L, 1L), versions.stream().map(DatasetVersion::versionNumber).toList());
        assertEquals(versions, repeated);
        assertEquals("completed", value("select status from ingestion.source_ingestion_runs where id='source-run-a'"));
        assertEquals(2L, count("ingestion.source_dataset_versions"));
        assertEquals(2L, count("ingestion.source_dataset_batches"));
        assertEquals(IngestionPersistencePort.ROW_PACK_CODEC, retriedBatch.codec());
        assertEquals(2L, count("ingestion.dataset_cursors"));
        assertEquals("version-a-1", value("""
                select last_successful_version_id from ingestion.dataset_cursors
                where dataset_key='dataset-a'
                """));
        assertEquals("1", value("""
                select committed_cursor->>'position' from ingestion.dataset_cursors
                where dataset_key='dataset-a'
                """));
    }

    @Test
    void reserveAndAppendAreIdempotentForTheSameRequestAndRetry() {
        startSource("source-run-a");
        var reservation = sourceReservation("source-run-a", "1");
        List<DatasetVersion> first = persistence.reserveSourceVersions(reservation);
        List<DatasetVersion> repeated = persistence.reserveSourceVersions(reservation);

        assertEquals(first, repeated);
        assertEquals(DatasetVersion.Status.BUILDING, first.getFirst().status());
        byte[] bytes = payload("dataset-a-1");
        IngestionPersistencePort.SourceBatchAppend append =
                new IngestionPersistencePort.SourceBatchAppend("version-a-1", 1, 2, bytes);
        IngestionPersistencePort.SourceBatchReceipt receipt = persistence.appendSourceBatch(append);
        assertEquals(receipt, persistence.appendSourceBatch(append));
        assertEquals(1L, count("ingestion.source_dataset_batches"));
        assertEquals(64, receipt.contentHash().length());
        assertEquals(IngestionPersistencePort.ROW_PACK_CODEC, receipt.codec());
    }

    @Test
    void readsPublishedSourceBatchesWithImmutableDefensivePayloadCopies() {
        publishSource("source-run-a");

        List<IngestionPersistencePort.SourceBatch> batches =
                persistence.readPublishedSourceBatches("version-a-1");

        assertEquals(1, batches.size());
        assertEquals(1L, batches.getFirst().receipt().batchNumber());
        assertArrayEquals(payload("dataset-a-1"), batches.getFirst().payload());
        byte[] returnedPayload = batches.getFirst().payload();
        returnedPayload[0] = (byte) (returnedPayload[0] ^ 0x01);
        assertArrayEquals(payload("dataset-a-1"), batches.getFirst().payload());
        assertThrows(UnsupportedOperationException.class, batches::clear);
    }

    @Test
    void readsPublishedSourceVersionWithZeroRowsAndZeroBatches() {
        startSource("source-run-a");
        persistence.reserveSourceVersions(sourceReservation("source-run-a", "1"));
        String emptyAggregateHash = aggregateHash(List.of());
        persistence.publishSourceSnapshot(new IngestionPersistencePort.SourcePublication(
                "source-run-a", List.of(
                new IngestionPersistencePort.SourceDatasetPublication(
                        "dataset-a", 0, 0, emptyAggregateHash, Map.of("position", "1")),
                new IngestionPersistencePort.SourceDatasetPublication(
                        "dataset-b", 0, 0, emptyAggregateHash, Map.of("position", "1")))));

        assertEquals(List.of(), persistence.readPublishedSourceBatches("version-a-1"));
        assertEquals(List.of(), persistence.readPublishedSourceBatches("version-b-1"));
    }

    @Test
    void onlyPublishedSourceVersionsCanBeRead() {
        startSource("source-run-a");
        persistence.reserveSourceVersions(sourceReservation("source-run-a", "1"));
        assertThrows(BackendException.class,
                () -> persistence.readPublishedSourceBatches("version-a-1"));

        persistence.failSourceRun("source-run-a", "SOURCE_CONTRACT_INVALID", Map.of());
        assertThrows(BackendException.class,
                () -> persistence.readPublishedSourceBatches("version-a-1"));

        reserveAndAppendSource("source-run-b", "2");
        persistence.publishSourceSnapshot(sourcePublication("source-run-b", "2", "2"));
        jdbc.update("update ingestion.dataset_cursors set last_successful_version_id=null "
                + "where dataset_key='dataset-a'");
        jdbc.update("update ingestion.source_dataset_versions set status='revoked' where id=?",
                "version-a-2");
        assertThrows(BackendException.class,
                () -> persistence.readPublishedSourceBatches("version-a-2"));
    }

    @Test
    void completedSourcePublicationRemainsIdempotentAfterNewerCursorAdvances() {
        reserveAndAppendSource("source-run-a", "1");
        var first = sourcePublication("source-run-a", "1", "1");
        List<DatasetVersion> firstVersions = persistence.publishSourceSnapshot(first);

        reserveAndAppendSource("source-run-b", "2");
        persistence.publishSourceSnapshot(sourcePublication("source-run-b", "2", "2"));

        assertEquals(firstVersions, persistence.publishSourceSnapshot(first));
        assertEquals("2", value("""
                select committed_cursor->>'position' from ingestion.dataset_cursors
                where dataset_key='dataset-a'
                """));
        assertEquals("1", value("""
                select committed_cursor->>'position' from ingestion.source_dataset_versions
                where id='version-a-1'
                """));
    }

    @Test
    void incrementalReservationRejectsAParentFromAStaleSnapshotCursor() {
        reserveAndAppendSource("source-run-a", "1");
        persistence.publishSourceSnapshot(sourcePublication("source-run-a", "1", "1"));
        reserveAndAppendSource("source-run-b", "2");
        persistence.publishSourceSnapshot(sourcePublication("source-run-b", "2", "2"));

        persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(
                "source-run-incremental", "source-a", IngestionRun.Mode.INCREMENTAL,
                IngestionRun.TriggerType.MANUAL, "operator-a", "trace-incremental",
                Map.of("snapshot", "stale")));
        persistence.startSourceRun("source-run-incremental");

        BackendException error = assertThrows(BackendException.class,
                () -> persistence.reserveSourceVersions(
                        new IngestionPersistencePort.SourceVersionReservation(
                                "source-run-incremental", List.of(
                                new IngestionPersistencePort.SourceDatasetReservation(
                                        "version-a-stale", "dataset-a", "version-a-1",
                                        Map.of("snapshot", "stale"), 1)))));

        assertEquals("INGESTION_SOURCE_CURSOR_STALE", error.code());
        assertEquals(0L, jdbc.queryForObject(
                "select count(*) from ingestion.source_dataset_versions "
                        + "where source_ingestion_run_id='source-run-incremental'", Long.class));
        assertEquals("version-a-2", value("select last_successful_version_id from "
                + "ingestion.dataset_cursors where dataset_key='dataset-a'"));
    }

    @Test
    void sourcePublicationMismatchRollsBackPublishButFailureKeepsBuildingVersionAndBatchesAuditable() {
        startSource("source-run-a");
        persistence.reserveSourceVersions(sourceReservation("source-run-a", "1"));
        appendSourceBatch("version-a-1", 1, 2, payload("dataset-a-1"));
        appendSourceBatch("version-b-1", 1, 3, payload("dataset-b-1"));
        var invalid = new IngestionPersistencePort.SourcePublication("source-run-a", List.of(
                new IngestionPersistencePort.SourceDatasetPublication("dataset-a", 1, 999,
                        aggregateHash(List.of(batchLine(1, 2, payload("dataset-a-1")))),
                        Map.of("position", "1")),
                new IngestionPersistencePort.SourceDatasetPublication("dataset-b", 1, 3,
                        aggregateHash(List.of(batchLine(1, 3, payload("dataset-b-1")))),
                        Map.of("position", "1"))));

        BackendException error = assertThrows(BackendException.class,
                () -> persistence.publishSourceSnapshot(invalid));
        assertEquals("INGESTION_BATCH_MISMATCH", error.code());
        assertEquals(2L, count("ingestion.source_dataset_versions"));
        assertEquals(2L, count("ingestion.source_dataset_batches"));
        assertEquals(0L, count("ingestion.dataset_cursors"));
        assertEquals("building", value("select status from ingestion.source_dataset_versions where id='version-a-1'"));
        assertEquals("running", value("select status from ingestion.source_ingestion_runs where id='source-run-a'"));

        persistence.failSourceRun("source-run-a", "SOURCE_CONTRACT_INVALID",
                Map.of("datasetKey", "dataset-b"));
        assertEquals("failed", value("select status from ingestion.source_ingestion_runs where id='source-run-a'"));
        assertEquals("SOURCE_CONTRACT_INVALID", value(
                "select error_code from ingestion.source_ingestion_runs where id='source-run-a'"));
        assertEquals(2L, jdbc.queryForObject("""
                select count(*) from ingestion.source_dataset_versions where status='failed'
                """, Long.class));
        assertEquals(2L, count("ingestion.source_dataset_batches"));
    }

    @Test
    void productPublicationWritesAllLineageWithoutChangingSourceCursors() {
        publishSource("source-run-a");
        Map<String, String> cursorBefore = Map.of(
                "dataset-a", value("select last_successful_version_id from ingestion.dataset_cursors where dataset_key='dataset-a'"),
                "dataset-b", value("select last_successful_version_id from ingestion.dataset_cursors where dataset_key='dataset-b'"));

        DataProductVersion productA = publishProduct("product-run-a", "product-a", "product-version-a",
                Map.of("input-a", "version-a-1", "input-b", "version-b-1"));
        DataProductVersion productB = publishProduct("product-run-b", "product-b", "product-version-b",
                Map.of("input-a", "version-a-1"));

        assertEquals(1L, productA.versionNumber());
        assertEquals(1L, productB.versionNumber());
        assertEquals(3L, count("ingestion.data_product_version_lineage"));
        assertEquals(1L, jdbc.queryForObject("""
                select count(distinct id) from ingestion.source_dataset_versions
                where id='version-a-1'
                """, Long.class));
        assertEquals(cursorBefore.get("dataset-a"), value(
                "select last_successful_version_id from ingestion.dataset_cursors where dataset_key='dataset-a'"));
        assertEquals(cursorBefore.get("dataset-b"), value(
                "select last_successful_version_id from ingestion.dataset_cursors where dataset_key='dataset-b'"));
    }

    @Test
    void productPublicationFailureAfterFirstLineageRollsBackVersionAndLineageThenCanBeAudited() {
        publishSource("source-run-a");
        createAndStartProduct("product-run-a", "product-a",
                Map.of("input-a", "version-a-1", "input-b", "version-b-1"));

        jdbc.execute("""
                create or replace function ingestion.test_fail_second_lineage()
                returns trigger language plpgsql as $$
                begin
                  if new.input_key = 'input-b' then
                    raise exception 'deterministic lineage failure';
                  end if;
                  return new;
                end
                $$
                """);
        jdbc.execute("""
                create trigger test_fail_second_lineage
                before insert on ingestion.data_product_version_lineage
                for each row execute function ingestion.test_fail_second_lineage()
                """);
        try {
            assertThrows(DataAccessException.class,
                    () -> persistence.publishProduct(new IngestionPersistencePort.ProductPublication(
                            "product-run-a", "product-version-a", "facts.product_a@1", 3,
                            "hash-a", 1), () -> {}));
        } finally {
            jdbc.execute("drop trigger test_fail_second_lineage on ingestion.data_product_version_lineage");
            jdbc.execute("drop function ingestion.test_fail_second_lineage()");
        }
        assertEquals(0L, count("ingestion.data_product_versions"));
        assertEquals(0L, count("ingestion.data_product_version_lineage"));
        assertEquals("running", value("""
                select status from ingestion.product_materialization_runs
                where id='product-run-a'
                """));

        persistence.failProductRun("product-run-a", "PRODUCT_CONTRACT_INVALID",
                Map.of("schemaVersion", 2));
        assertEquals("failed", value("""
                select status from ingestion.product_materialization_runs
                where id='product-run-a'
                """));
    }

    @Test
    void freezesOnlyPublishedProductVersionsAsAnImmutableManifest() {
        publishSource("source-run-a");
        DataProductVersion published = publishProduct("product-run-a", "product-a", "product-version-a",
                Map.of("input-a", "version-a-1", "input-b", "version-b-1"));
        Instant capturedAt = Instant.now();
        var request = new IngestionPersistencePort.VersionSetPublication("set-a",
                Map.of("product-a", published.id()), capturedAt, "operator-a");

        DatasetVersionSet frozen = persistence.freezeVersionSet(request);
        DatasetVersionSet repeated = persistence.freezeVersionSet(request);

        assertEquals(DatasetVersionSet.Status.FROZEN, frozen.status());
        assertEquals(frozen, repeated);
        assertEquals(Map.of("product-a", "product-version-a"), frozen.productVersionIds());

        createAndStartProduct("product-run-b", "product-b", Map.of("input-a", "version-a-1"));
        jdbc.update("""
                insert into ingestion.data_product_versions
                  (id,product_key,materialization_run_id,version_number,row_count,schema_version,status,created_at)
                values ('building-version','product-b','product-run-b',1,0,1,'building',now())
                """);
        BackendException invalid = assertThrows(BackendException.class,
                () -> persistence.freezeVersionSet(new IngestionPersistencePort.VersionSetPublication(
                        "set-building", Map.of("product-b", "building-version"), Instant.now(), "operator-a")));
        assertEquals("INGESTION_PRODUCT_VERSION_INVALID", invalid.code());
        assertEquals(0L, jdbc.queryForObject("""
                select count(*) from ingestion.dataset_version_sets where set_id='set-building'
                """, Long.class));
    }

    @Test
    void resolvesOnlyTheLatestExactFrozenManifest() {
        publishSource("source-run-a");
        DataProductVersion productA = publishProduct("product-run-a", "product-a", "product-version-a",
                Map.of("input-a", "version-a-1", "input-b", "version-b-1"));
        DataProductVersion productB = publishProduct("product-run-b", "product-b", "product-version-b",
                Map.of("input-a", "version-a-1"));
        Instant base = Instant.now();
        persistence.freezeVersionSet(new IngestionPersistencePort.VersionSetPublication(
                "set-partial", Map.of("product-a", productA.id()), base, "operator-a"));
        persistence.freezeVersionSet(new IngestionPersistencePort.VersionSetPublication(
                "set-complete", Map.of("product-a", productA.id(), "product-b", productB.id()),
                base.plusMillis(1), "operator-a"));

        DatasetVersionSet selected = versionSets.latestFrozen(
                java.util.Set.of("product-a", "product-b")).orElseThrow();

        assertEquals("set-complete", selected.publicationId());
        assertEquals(Map.of("product-a", productA.id(), "product-b", productB.id()),
                selected.productVersionIds());
        BackendException incomplete = assertThrows(BackendException.class,
                () -> versionSets.requireFrozen("set-partial",
                        java.util.Set.of("product-a", "product-b")));
        assertEquals("DATASET_VERSION_SET_INCOMPLETE", incomplete.code());
    }

    @Test
    void latestFrozenUsesCapturedSnapshotOrderWhenFreezeTimesAreInterleaved() {
        publishSource("source-run-a");
        DataProductVersion productA = publishProduct("product-run-a", "product-a", "product-version-a",
                Map.of("input-a", "version-a-1", "input-b", "version-b-1"));
        DataProductVersion productB = publishProduct("product-run-b", "product-b", "product-version-b",
                Map.of("input-a", "version-a-1"));
        Map<String, String> products = Map.of("product-a", productA.id(), "product-b", productB.id());

        Instant olderCapture = Instant.parse("2026-09-01T00:00:00Z");
        Instant olderFreeze = Instant.parse("2026-09-03T00:00:00Z");
        Instant newerCapture = Instant.parse("2026-09-02T00:00:00Z");
        Instant newerFreeze = Instant.parse("2026-09-02T01:00:00Z");
        insertFrozenManifest("set-frozen-later", products, olderCapture, olderFreeze);
        insertFrozenManifest("set-captured-later", products, newerCapture, newerFreeze);

        DatasetVersionSet selected = versionSets.latestFrozen(products.keySet()).orElseThrow();

        assertEquals("set-captured-later", selected.publicationId());
        assertEquals(newerCapture, selected.capturedAt());
        assertEquals(newerFreeze, selected.frozenAt());
    }

    @Test
    void frozenManifestProtectsProductVersionsAndCannotBeRevokedAfterExecutionBinding() {
        publishSource("source-run-a");
        DataProductVersion product = publishProduct("product-run-a", "product-a", "product-version-a",
                Map.of("input-a", "version-a-1", "input-b", "version-b-1"));
        persistence.freezeVersionSet(new IngestionPersistencePort.VersionSetPublication(
                "set-a", Map.of("product-a", product.id()), Instant.now(), "operator-a"));

        assertThrows(DataAccessException.class, () -> jdbc.update(
                "update ingestion.data_product_versions set status='revoked' where id=?",
                product.id()));
        assertThrows(DataAccessException.class, () -> jdbc.update(
                "update ingestion.dataset_version_sets set captured_at=captured_at + interval '1 second' "
                        + "where set_id='set-a'"));

        jdbc.update("""
                insert into platform.analysis_execution_snapshots
                  (execution_id,session_id,owner_user_id,status,plan_snapshot,step_results,
                   conclusion_state,result_blocks,mobile_projection,capability_binding,
                   created_at,updated_at,dataset_version_set_id)
                values ('execution-a','session-a','owner-a','completed','{}','[]','{}','[]','{}',
                        '{"source":"test"}',now(),now(),'set-a')
                """);

        assertThrows(DataAccessException.class, () -> jdbc.update(
                "update ingestion.dataset_version_sets set status='revoked' where set_id='set-a'"));
        assertEquals("frozen", value(
                "select status from ingestion.dataset_version_sets where set_id='set-a'"));
        assertEquals("published", value(
                "select status from ingestion.data_product_versions where id='product-version-a'"));
    }

    @Test
    void sameSourceRunIdIsIdempotentButDifferentRequestAndConcurrentRunConflict() throws Exception {
        var request = sourceRunRequest("same-run");
        assertEquals(persistence.createSourceRun(request), persistence.createSourceRun(request));
        BackendException idConflict = assertThrows(BackendException.class,
                () -> persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(
                        "same-run", "source-b", IngestionRun.Mode.FULL,
                        IngestionRun.TriggerType.MANUAL, "operator-a", "trace-other",
                        Map.of("snapshot", "other"))));
        assertEquals("INGESTION_RUN_ID_CONFLICT", idConflict.code());
        persistence.failSourceRun("same-run", "CANCELLED_BY_TEST", Map.of("reason", "concurrency"));

        CyclicBarrier barrier = new CyclicBarrier(2);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> {
                barrier.await(5, TimeUnit.SECONDS);
                return createSourceResult("concurrent-a");
            });
            var second = executor.submit(() -> {
                barrier.await(5, TimeUnit.SECONDS);
                return createSourceResult("concurrent-b");
            });
            List<String> results = List.of(first.get(10, TimeUnit.SECONDS),
                    second.get(10, TimeUnit.SECONDS));
            assertEquals(1, results.stream().filter("created"::equals).count());
            assertEquals(1, results.stream().filter("INGESTION_SOURCE_CONFLICT"::equals).count());
        }
    }

    @Test
    void recordsObservedSourceSnapshotContextOnceAndRejectsDifferentOrLateUpdates() {
        IngestionPersistencePort.SourceRunRequest request = new IngestionPersistencePort.SourceRunRequest(
                "snapshot-context-run", "source-a", IngestionRun.Mode.FULL,
                IngestionRun.TriggerType.MANUAL, "operator-a", "trace-context",
                Map.of("phase", "planned"));
        persistence.createSourceRun(request);
        persistence.startSourceRun(request.id());

        assertThrows(IllegalArgumentException.class,
                () -> persistence.recordSourceSnapshotContext(request.id(), Map.of()));
        assertThrows(IllegalArgumentException.class,
                () -> persistence.recordSourceSnapshotContext(request.id(), Map.of(
                        "phase", "planned")));

        Map<String, Object> observed = Map.of(
                "connector", "postgres",
                "transactionSnapshot", "00000001-00000001-00000000",
                "observedAt", "2026-09-05T00:00:00Z");
        IngestionRun recorded = persistence.recordSourceSnapshotContext(request.id(), observed);

        assertEquals(observed, recorded.snapshotContext());
        assertEquals(recorded, persistence.createSourceRun(request));
        assertEquals(recorded, persistence.recordSourceSnapshotContext(request.id(), observed));
        BackendException conflict = assertThrows(BackendException.class,
                () -> persistence.recordSourceSnapshotContext(request.id(), Map.of(
                        "connector", "postgres", "transactionSnapshot", "different",
                        "observedAt", "2026-09-05T00:00:00Z")));
        assertEquals("INGESTION_SNAPSHOT_CONTEXT_CONFLICT", conflict.code());

        persistence.failSourceRun(request.id(), "FAILED_BY_TEST", Map.of("reason", "test"));
        BackendException late = assertThrows(BackendException.class,
                () -> persistence.recordSourceSnapshotContext(request.id(), observed));
        assertEquals("INGESTION_STATE_CONFLICT", late.code());
    }

    @Test
    void databaseRejectsCrossSourceVersionAndPublishedArtifactMutation() {
        persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(
                "source-run-b", "source-b", IngestionRun.Mode.FULL,
                IngestionRun.TriggerType.MANUAL, "operator-a", "trace-source-b", Map.of()));
        assertThrows(DataAccessException.class, () -> jdbc.update("""
                insert into ingestion.source_dataset_versions
                  (id,source_key,dataset_key,source_ingestion_run_id,version_number,status)
                values ('cross-source','source-a','dataset-a','source-run-b',1,'building')
                """));

        publishSource("source-run-a");
        assertThrows(DataAccessException.class, () -> jdbc.update("""
                update ingestion.source_dataset_versions set row_count=999
                where id='version-a-1'
                """));
        assertEquals("ingestion://source-dataset-version/version-a-1/row-pack-v1", value("""
                select storage_ref from ingestion.source_dataset_versions where id='version-a-1'
                """));
        assertThrows(DataAccessException.class, () -> jdbc.update("""
                update ingestion.source_dataset_batches set row_count=999
                where source_dataset_version_id='version-a-1' and batch_number=1
                """));
        publishProduct("product-run-a", "product-a", "product-version-a",
                Map.of("input-a", "version-a-1", "input-b", "version-b-1"));
        assertThrows(DataAccessException.class, () -> jdbc.update("""
                delete from ingestion.data_product_version_lineage
                where product_version_id='product-version-a'
                """));
    }

    private String createSourceResult(String runId) {
        try {
            persistence.createSourceRun(sourceRunRequest(runId));
            return "created";
        } catch (BackendException error) {
            return error.code();
        }
    }

    private void startSource(String runId) {
        persistence.createSourceRun(sourceRunRequest(runId));
        persistence.startSourceRun(runId);
    }

    private void publishSource(String runId) {
        reserveAndAppendSource(runId, "1");
        persistence.publishSourceSnapshot(sourcePublication(runId, "1", "1"));
    }

    private IngestionPersistencePort.SourceRunRequest sourceRunRequest(String runId) {
        return new IngestionPersistencePort.SourceRunRequest(runId, "source-a",
                IngestionRun.Mode.FULL, IngestionRun.TriggerType.MANUAL,
                "operator-a", "trace-" + runId, Map.of("snapshot", runId));
    }

    private List<DatasetVersion> reserveAndAppendSource(String runId, String versionSuffix) {
        startSource(runId);
        List<DatasetVersion> versions = persistence.reserveSourceVersions(
                sourceReservation(runId, versionSuffix));
        appendSourceBatch("version-a-" + versionSuffix, 1, 2,
                payload("dataset-a-" + versionSuffix));
        appendSourceBatch("version-b-" + versionSuffix, 1, 3,
                payload("dataset-b-" + versionSuffix));
        return versions;
    }

    private IngestionPersistencePort.SourceVersionReservation sourceReservation(
            String runId, String versionSuffix) {
        return new IngestionPersistencePort.SourceVersionReservation(runId, List.of(
                new IngestionPersistencePort.SourceDatasetReservation("version-a-" + versionSuffix,
                        "dataset-a", null, Map.of("strategy", "snapshot", "observedAt",
                        "2026-09-04T00:00:00Z"), 1),
                new IngestionPersistencePort.SourceDatasetReservation("version-b-" + versionSuffix,
                        "dataset-b", null, Map.of("strategy", "snapshot", "observedAt",
                        "2026-09-04T00:00:00Z"), 1)));
    }

    private IngestionPersistencePort.SourcePublication sourcePublication(
            String runId, String versionSuffix, String cursorPosition) {
        return new IngestionPersistencePort.SourcePublication(runId, List.of(
                new IngestionPersistencePort.SourceDatasetPublication("dataset-a", 1, 2,
                        aggregateHash(List.of(batchLine(1, 2, payload("dataset-a-" + versionSuffix)))),
                        Map.of("position", cursorPosition)),
                new IngestionPersistencePort.SourceDatasetPublication("dataset-b", 1, 3,
                        aggregateHash(List.of(batchLine(1, 3, payload("dataset-b-" + versionSuffix)))),
                        Map.of("position", cursorPosition))));
    }

    private IngestionPersistencePort.SourceBatchReceipt appendSourceBatch(
            String versionId, long batchNumber, long rowCount, byte[] payload) {
        return persistence.appendSourceBatch(new IngestionPersistencePort.SourceBatchAppend(
                versionId, batchNumber, rowCount, payload));
    }

    private DataProductVersion publishProduct(String runId, String productKey, String versionId,
                                              Map<String, String> inputVersions) {
        createAndStartProduct(runId, productKey, inputVersions);
        return persistence.publishProduct(new IngestionPersistencePort.ProductPublication(
                runId, versionId, "facts." + productKey.replace('-', '_') + "@1",
                3, "hash-" + versionId, 1), () -> {});
    }

    private void insertFrozenManifest(String setId, Map<String, String> productVersions,
                                      Instant capturedAt, Instant frozenAt) {
        jdbc.update("""
                insert into ingestion.dataset_version_sets
                  (set_id,status,captured_at,frozen_at,created_by,created_at)
                values (?,'frozen',?,?,?,?)
                """, setId, Timestamp.from(capturedAt), Timestamp.from(frozenAt),
                "operator-a", Timestamp.from(capturedAt));
        productVersions.forEach((productKey, productVersionId) -> jdbc.update("""
                insert into ingestion.dataset_version_set_items
                  (set_id,product_key,product_version_id) values (?,?,?)
                """, setId, productKey, productVersionId));
    }

    private void createAndStartProduct(String runId, String productKey,
                                       Map<String, String> inputVersions) {
        persistence.createProductRun(new IngestionPersistencePort.ProductRunRequest(
                runId, productKey, ProductMaterializationRun.Mode.FULL,
                ProductMaterializationRun.TriggerType.MANUAL, "operator-a", "trace-" + runId,
                inputVersions));
        persistence.startProductRun(runId);
    }

    private void registerDefinitions() {
        jdbc.update("""
                insert into ingestion.source_definitions(source_key,connector_type,connection_ref,status)
                values ('source-a','postgres','connection-a','active'),
                       ('source-b','postgres','connection-b','active')
                """);
        jdbc.update("""
                insert into ingestion.dataset_definitions
                  (dataset_key,source_key,source_namespace,source_relation,primary_key_columns,
                   column_contract,cursor_spec,delete_policy,delete_spec,schema_version,status)
                values
                  ('dataset-a','source-a','public','source_a',array['id'],
                   '[{"name":"id","type":"LONG","nullable":false}]'::jsonb,
                   '{"strategy":"SNAPSHOT"}'::jsonb,'none','{}'::jsonb,1,'active'),
                  ('dataset-b','source-a','public','source_b',array['id'],
                   '[{"name":"id","type":"LONG","nullable":false}]'::jsonb,
                   '{"strategy":"SNAPSHOT"}'::jsonb,'none','{}'::jsonb,1,'active')
                """);
        jdbc.update("""
                insert into ingestion.data_product_definitions
                  (product_key,domain_key,canonical_schema,canonical_relation,transform_ref,
                   schema_version,freshness_policy,status)
                values ('product-a','domain-a','facts','product_a','transform-a',1,'{}'::jsonb,'active'),
                       ('product-b','domain-b','facts','product_b','transform-b',1,'{}'::jsonb,'active')
                """);
        jdbc.update("""
                insert into ingestion.data_product_inputs
                  (product_key,input_key,dataset_key,ordinal,is_required,mapping_spec)
        values ('product-a','input-a','dataset-a',0,true,'{}'::jsonb),
                       ('product-a','input-b','dataset-b',1,true,'{}'::jsonb),
                       ('product-b','input-a','dataset-a',0,true,'{}'::jsonb)
                """);
    }

    private static byte[] payload(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    private static String batchLine(long batchNumber, long rowCount, byte[] payload) {
        return batchNumber + ":" + rowCount + ":" + sha256(payload) + "\n";
    }

    private static String aggregateHash(List<String> lines) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            lines.forEach(line -> digest.update(line.getBytes(StandardCharsets.UTF_8)));
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private static String sha256(byte[] payload) {
        try {
            return java.util.HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(payload));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private long count(String relation) {
        return jdbc.queryForObject("select count(*) from " + relation, Long.class);
    }

    private String value(String sql) {
        return jdbc.queryForObject(sql, String.class);
    }
}
