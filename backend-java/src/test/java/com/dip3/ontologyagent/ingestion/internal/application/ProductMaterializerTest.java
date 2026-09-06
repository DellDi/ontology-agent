package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.DataProductVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.codec.RowPackV1Codec;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.IngestionPostgresPersistenceAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.ProductCatalogPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.SourceCatalogPostgresAdapter;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Integration evidence that typed canonical writes and product publication share one transaction. */
@Testcontainers
class ProductMaterializerTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

    private JdbcTemplate jdbc;
    private IngestionPersistencePort persistence;
    private RowPackV1Codec codec;
    private ProductCatalogPort productCatalog;

    @BeforeAll
    static void migrate() {
        MigrationTestSupport.migrate(POSTGRES);
    }

    @BeforeEach
    void reset() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("""
                truncate ingestion.dataset_version_set_items, ingestion.dataset_version_sets,
                  ingestion.data_product_version_lineage, ingestion.data_product_versions,
                  ingestion.product_materialization_runs, ingestion.dataset_cursors,
                  ingestion.source_dataset_batches, ingestion.source_dataset_versions,
                  ingestion.source_ingestion_runs, ingestion.data_product_inputs,
                  ingestion.data_product_definitions, ingestion.dataset_definitions,
                  ingestion.source_definitions cascade
                """);
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS facts");
        jdbc.execute("DROP TABLE IF EXISTS facts.canonical_test");
        jdbc.execute("""
                CREATE TABLE facts.canonical_test (
                  product_version_id text NOT NULL,
                  entity_id bigint NOT NULL,
                  display_name text NOT NULL,
                  deleted boolean NOT NULL,
                  PRIMARY KEY (product_version_id,entity_id))
                """);
        registerCatalog();

        JsonCodec json = new JsonCodec();
        persistence = new IngestionPostgresPersistenceAdapter(
                jdbc, json, new JdbcTransactionManager(dataSource));
        codec = new RowPackV1Codec();
        SourceCatalogPort sourceCatalog = new SourceCatalogPostgresAdapter(jdbc, json);
        productCatalog = new ProductCatalogPostgresAdapter(jdbc, json, sourceCatalog);
        publishSourceVersion(sourceCatalog.loadActiveSource("source-test").datasets().getFirst());
    }

    @Test
    void writesTypedFactsAndPublishesVersionAndLineage() {
        ProductMaterializer materializer = materializer(successfulTransform());

        DataProductVersion version = materializer.materialize(command(
                "product-run", "product-version"));

        assertEquals(DataProductVersion.Status.PUBLISHED, version.status());
        assertEquals(2, version.rowCount());
        assertEquals(2L, count("facts.canonical_test"));
        assertEquals(List.of("alpha", "beta"), jdbc.queryForList(
                "select display_name from facts.canonical_test order by entity_id", String.class));
        assertEquals(List.of(false, true), jdbc.queryForList(
                "select deleted from facts.canonical_test order by entity_id", Boolean.class));
        assertEquals(1L, count("ingestion.data_product_versions"));
        assertEquals(1L, count("ingestion.data_product_version_lineage"));
        assertEquals("completed", value("select status from ingestion.product_materialization_runs "
                + "where id='product-run'"));
    }

    @Test
    void canonicalWriteFailureRollsBackFactsVersionAndLineageThenAuditsRunFailure() {
        CanonicalProductTransform failing = new CanonicalProductTransform() {
            @Override public String transformRef() { return "test-transform"; }

            @Override
            public PreparedProduct prepare(Context context) {
                return new PreparedProduct("facts.canonical_test@" + context.productVersionId(),
                        2, hash("invalid"), () -> {
                    jdbc.update("insert into facts.canonical_test values (?,?,?,?)",
                            context.productVersionId(), 1L, "first", false);
                    jdbc.update("insert into facts.canonical_test values (?,?,?,?)",
                            context.productVersionId(), 1L, "duplicate", false);
                });
            }
        };

        assertThrows(DataIntegrityViolationException.class,
                () -> materializer(failing).materialize(command(
                        "failed-product-run", "failed-product-version")));

        assertEquals(0L, count("facts.canonical_test"));
        assertEquals(0L, count("ingestion.data_product_versions"));
        assertEquals(0L, count("ingestion.data_product_version_lineage"));
        assertEquals("failed", value("select status from ingestion.product_materialization_runs "
                + "where id='failed-product-run'"));
        assertEquals("PRODUCT_MATERIALIZATION_FAILED", value("select error_code from "
                + "ingestion.product_materialization_runs where id='failed-product-run'"));
    }

    @Test
    void incrementalHeadReconstructsACompleteSnapshotFromItsPublishedParentChain() {
        DatasetDefinition definition = new SourceCatalogPostgresAdapter(jdbc, new JsonCodec())
                .loadActiveSource("source-test").datasets().getFirst();
        publishIncrementalSourceVersion(definition);

        DataProductVersion version = materializer(successfulTransform()).materialize(
                command("incremental-product-run", "incremental-product-version",
                        "source-version-2", ProductMaterializationRun.Mode.INCREMENTAL));

        assertEquals(3, version.rowCount());
        assertEquals(List.of("alpha-updated", "beta", "gamma"), jdbc.queryForList("""
                select display_name from facts.canonical_test
                where product_version_id='incremental-product-version'
                order by entity_id
                """, String.class));
        assertEquals(List.of(false, false, false), jdbc.queryForList("""
                select deleted from facts.canonical_test
                where product_version_id='incremental-product-version'
                order by entity_id
                """, Boolean.class));
        assertEquals("source-version", value("select parent_version_id from "
                + "ingestion.source_dataset_versions where id='source-version-2'"));
        assertEquals("source-version-2", value("select source_dataset_version_id from "
                + "ingestion.data_product_version_lineage where "
                + "product_version_id='incremental-product-version'"));
        assertThrows(DataAccessException.class, () -> jdbc.update(
                "update ingestion.source_dataset_versions set status='revoked' "
                        + "where id='source-version'"));
        assertThrows(DataAccessException.class, () -> jdbc.update(
                "update ingestion.source_dataset_versions set status='revoked' "
                        + "where id='source-version-2'"));
    }

    @Test
    void zeroRowIncrementalKeepsTheCompleteTwoLevelParentSnapshot() {
        DatasetDefinition definition = new SourceCatalogPostgresAdapter(jdbc, new JsonCodec())
                .loadActiveSource("source-test").datasets().getFirst();
        publishIncrementalSourceVersion(definition);
        publishEmptyIncrementalSourceVersion(definition);

        DataProductVersion version = materializer(successfulTransform()).materialize(
                command("empty-incremental-product-run", "empty-incremental-product-version",
                        "source-version-3", ProductMaterializationRun.Mode.INCREMENTAL));

        assertEquals(3, version.rowCount());
        assertEquals(List.of("alpha-updated", "beta", "gamma"), jdbc.queryForList("""
                select display_name from facts.canonical_test
                where product_version_id='empty-incremental-product-version'
                order by entity_id
                """, String.class));
        assertEquals("source-version-2", value("select parent_version_id from "
                + "ingestion.source_dataset_versions where id='source-version-3'"));
    }

    private ProductMaterializer materializer(CanonicalProductTransform transform) {
        return new ProductMaterializer(productCatalog,
                new CanonicalProductTransformRegistry(List.of(transform)), codec, persistence);
    }

    private CanonicalProductTransform successfulTransform() {
        return new CanonicalProductTransform() {
            @Override public String transformRef() { return "test-transform"; }

            @Override
            public PreparedProduct prepare(Context context) {
                List<SourceRow> rows = context.inputs().get("entities").rows();
                String content = rows.stream().map(row -> row.values().get(0) + ":"
                        + row.values().get(1) + ":" + row.values().get(2) + "\n")
                        .reduce("", String::concat);
                return new PreparedProduct("facts.canonical_test@" + context.productVersionId(),
                        rows.size(), hash(content), () -> rows.forEach(row -> jdbc.update(
                        "insert into facts.canonical_test"
                                + "(product_version_id,entity_id,display_name,deleted) "
                                + "values (?,?,?,?)", context.productVersionId(),
                        ((Number) row.values().get(0)).longValue(), row.values().get(1),
                        row.values().get(2))));
            }
        };
    }

    private void publishSourceVersion(DatasetDefinition definition) {
        persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(
                "source-run", "source-test", IngestionRun.Mode.FULL,
                IngestionRun.TriggerType.BOOTSTRAP, "test", "trace-source",
                Map.of("connector", "test", "snapshot", "1")));
        persistence.startSourceRun("source-run");
        persistence.reserveSourceVersions(new IngestionPersistencePort.SourceVersionReservation(
                "source-run", List.of(new IngestionPersistencePort.SourceDatasetReservation(
                "source-version", "source-entities", null, Map.of("snapshot", "1"),
                definition.schemaVersion()))));
        byte[] payload = codec.encode(definition, List.of(
                new SourceRow(List.of(1L, "alpha", false)),
                new SourceRow(List.of(2L, "beta", true))));
        IngestionPersistencePort.SourceBatchReceipt receipt = persistence.appendSourceBatch(
                new IngestionPersistencePort.SourceBatchAppend(
                        "source-version", 1, 2, payload));
        SourceBatchManifest.Aggregate aggregate = SourceBatchManifest.aggregate(List.of(receipt));
        persistence.publishSourceSnapshot(new IngestionPersistencePort.SourcePublication(
                "source-run", List.of(new IngestionPersistencePort.SourceDatasetPublication(
                "source-entities", 1, 2, aggregate.contentHash(), Map.of("id", 2L)))));
    }

    private void publishIncrementalSourceVersion(DatasetDefinition definition) {
        persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(
                "source-run-2", "source-test", IngestionRun.Mode.INCREMENTAL,
                IngestionRun.TriggerType.MANUAL, "test", "trace-source-2",
                Map.of("connector", "test", "snapshot", "2")));
        persistence.startSourceRun("source-run-2");
        persistence.reserveSourceVersions(new IngestionPersistencePort.SourceVersionReservation(
                "source-run-2", List.of(new IngestionPersistencePort.SourceDatasetReservation(
                "source-version-2", "source-entities", "source-version",
                Map.of("snapshot", "2"),
                definition.schemaVersion()))));
        byte[] payload = codec.encode(definition, List.of(
                new SourceRow(List.of(1L, "alpha-updated", false)),
                new SourceRow(List.of(2L, "beta", false)),
                new SourceRow(List.of(3L, "gamma", false))));
        IngestionPersistencePort.SourceBatchReceipt receipt = persistence.appendSourceBatch(
                new IngestionPersistencePort.SourceBatchAppend(
                        "source-version-2", 1, 3, payload));
        SourceBatchManifest.Aggregate aggregate = SourceBatchManifest.aggregate(List.of(receipt));
        persistence.publishSourceSnapshot(new IngestionPersistencePort.SourcePublication(
                "source-run-2", List.of(new IngestionPersistencePort.SourceDatasetPublication(
                "source-entities", 1, 3, aggregate.contentHash(), Map.of("id", 3L)))));
    }

    private void publishEmptyIncrementalSourceVersion(DatasetDefinition definition) {
        persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(
                "source-run-3", "source-test", IngestionRun.Mode.INCREMENTAL,
                IngestionRun.TriggerType.MANUAL, "test", "trace-source-3",
                Map.of("connector", "test", "snapshot", "3")));
        persistence.startSourceRun("source-run-3");
        persistence.reserveSourceVersions(new IngestionPersistencePort.SourceVersionReservation(
                "source-run-3", List.of(new IngestionPersistencePort.SourceDatasetReservation(
                "source-version-3", "source-entities", "source-version-2",
                Map.of("snapshot", "3"), definition.schemaVersion()))));
        SourceBatchManifest.Aggregate aggregate = SourceBatchManifest.aggregate(List.of());
        persistence.publishSourceSnapshot(new IngestionPersistencePort.SourcePublication(
                "source-run-3", List.of(new IngestionPersistencePort.SourceDatasetPublication(
                "source-entities", 0, 0, aggregate.contentHash(), Map.of("id", 3L)))));
    }

    private void registerCatalog() {
        jdbc.update("""
                insert into ingestion.source_definitions
                  (source_key,connector_type,connection_ref,status)
                values ('source-test','postgres','source-test','active')
                """);
        jdbc.update("""
                insert into ingestion.dataset_definitions
                  (dataset_key,source_key,source_namespace,source_relation,primary_key_columns,
                   column_contract,cursor_spec,delete_policy,delete_spec,schema_version,status)
                values ('source-entities','source-test','source_data','entities',array['id'],
                  '[{"name":"id","type":"LONG","nullable":false},
                    {"name":"display_name","type":"STRING","nullable":false},
                    {"name":"is_deleted","type":"BOOLEAN","nullable":false}]'::jsonb,
                  '{"strategy":"SNAPSHOT"}'::jsonb,'soft_delete',
                  '{"column":"is_deleted","deletedValues":["true"]}'::jsonb,1,'active')
                """);
        jdbc.update("""
                insert into ingestion.data_product_definitions
                  (product_key,domain_key,canonical_schema,canonical_relation,transform_ref,
                   schema_version,freshness_policy,status)
                values ('product-test','domain-test','facts','canonical_test','test-transform',
                        1,'{}'::jsonb,'active')
                """);
        jdbc.update("""
                insert into ingestion.data_product_inputs
                  (product_key,input_key,dataset_key,ordinal,is_required,mapping_spec)
                values ('product-test','entities','source-entities',0,true,'{}'::jsonb)
                """);
    }

    private static ProductMaterializer.Command command(String runId, String versionId) {
        return command(runId, versionId, "source-version", ProductMaterializationRun.Mode.FULL);
    }

    private static ProductMaterializer.Command command(String runId, String versionId,
                                                        String sourceVersionId,
                                                        ProductMaterializationRun.Mode mode) {
        return new ProductMaterializer.Command(runId, "product-test", versionId,
                mode,
                ProductMaterializationRun.TriggerType.MANUAL,
                "operator", "trace-" + runId, Map.of("entities", sourceVersionId));
    }

    private static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
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
