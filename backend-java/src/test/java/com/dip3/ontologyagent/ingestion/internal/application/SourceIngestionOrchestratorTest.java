package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.DatasetVersion;
import com.dip3.ontologyagent.ingestion.api.IngestionCursor;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import com.dip3.ontologyagent.ingestion.api.SourceSnapshot;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.postgres.PostgresSourceConnector;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.codec.RowPackV1Codec;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.IngestionPostgresPersistenceAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.SourceCatalogPostgresAdapter;
import com.dip3.ontologyagent.ingestion.spi.PostgresSourceConnectionProvider;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.spy;

/** Two-database integration evidence for the complete source-ingestion application flow. */
@Testcontainers
class SourceIngestionOrchestratorTest {
    @Container
    static final PostgreSQLContainer SOURCE = new PostgreSQLContainer("postgres:17.8-alpine");

    @Container
    static final PostgreSQLContainer TARGET = new PostgreSQLContainer("postgres:17.8-alpine");

    private JdbcTemplate sourceJdbc;
    private JdbcTemplate targetJdbc;
    private IngestionPersistencePort persistence;
    private RowPackV1Codec codec;
    private SourceIngestionOrchestrator orchestrator;

    @BeforeAll
    static void migrateTarget() {
        MigrationTestSupport.migrate(TARGET);
    }

    @BeforeEach
    void reset() {
        DataSource sourceDataSource = dataSource(SOURCE);
        DataSource targetDataSource = dataSource(TARGET);
        sourceJdbc = new JdbcTemplate(sourceDataSource);
        targetJdbc = new JdbcTemplate(targetDataSource);
        sourceJdbc.execute("DROP SCHEMA IF EXISTS source_data CASCADE");
        sourceJdbc.execute("CREATE SCHEMA source_data");
        sourceJdbc.execute("""
                CREATE TABLE source_data.orders (
                  id bigint PRIMARY KEY,
                  updated_at timestamptz NOT NULL,
                  attributes jsonb NOT NULL)
                """);
        sourceJdbc.execute("""
                CREATE TABLE source_data.profiles (
                  id bigint PRIMARY KEY,
                  display_name text NOT NULL)
                """);

        targetJdbc.execute("""
                truncate ingestion.dataset_version_set_items, ingestion.dataset_version_sets,
                  ingestion.data_product_version_lineage, ingestion.data_product_versions,
                  ingestion.product_materialization_runs, ingestion.dataset_cursors,
                  ingestion.source_dataset_batches, ingestion.source_dataset_versions,
                  ingestion.source_ingestion_runs, ingestion.data_product_inputs,
                  ingestion.data_product_definitions, ingestion.dataset_definitions,
                  ingestion.source_definitions cascade
                """);
        registerCatalog();

        JsonCodec json = new JsonCodec();
        persistence = new IngestionPostgresPersistenceAdapter(targetJdbc, json,
                new JdbcTransactionManager(targetDataSource));
        codec = new RowPackV1Codec();
        PostgresSourceConnectionProvider connections = reference -> {
            if (!"source-test".equals(reference)) {
                throw new IllegalArgumentException("unknown source connection reference");
            }
            return new PostgresSourceConnectionProvider.ResolvedConnection(sourceDataSource,
                    new JdbcTransactionManager(sourceDataSource), 5);
        };
        orchestrator = orchestrator(targetJdbc, json, connections, codec);
    }

    @Test
    void fullThenIncrementalPublishesTypedBatchesAndAdvancesOnlyEligibleDataset() {
        insertOrder(1, "2026-01-01T00:00:00Z", "{\"kind\":\"a\"}");
        insertOrder(2, "2026-01-01T00:00:00Z", "{\"kind\":\"b\"}");
        insertOrder(3, "2026-01-02T00:00:00Z", "{\"kind\":\"c\"}");
        for (long id = 1; id <= 3; id++) {
            sourceJdbc.update("INSERT INTO source_data.profiles(id,display_name) VALUES (?,?)",
                    id, "profile-" + id);
        }

        SourceIngestionOrchestrator.Result full = orchestrator.ingest(command(
                "full-run", IngestionRun.Mode.FULL, 2));
        assertEquals(List.of("orders", "profiles"), full.versions().stream()
                .map(DatasetVersion::datasetKey).toList());
        assertTrue(full.versions().stream().allMatch(
                version -> version.status() == DatasetVersion.Status.PUBLISHED));
        assertEquals("completed", text("select status from ingestion.source_ingestion_runs "
                + "where id='full-run'"));
        assertEquals(2L, number("select count(*) from ingestion.source_dataset_versions "
                + "where source_ingestion_run_id='full-run' and source_watermark=(select "
                + "snapshot_context from ingestion.source_ingestion_runs where id='full-run')"));
        assertEquals(4L, number("select count(*) from ingestion.source_dataset_batches"));

        DatasetVersion orders = version(full, "orders");
        List<SourceRow> fullRows = decode(orders, ordersDefinition());
        assertEquals(List.of(1L, 2L, 3L), ids(fullRows));
        assertEquals(Map.of("kind", "a"), fullRows.getFirst().values().get(2));
        assertEquals("3", text("select committed_cursor->>'id' from ingestion.dataset_cursors "
                + "where dataset_key='orders'"));
        String profileVersion = text("select last_successful_version_id from "
                + "ingestion.dataset_cursors where dataset_key='profiles'");

        insertOrder(4, "2026-01-02T00:00:00Z", "{\"kind\":\"d\"}");
        SourceIngestionOrchestrator.Result incremental = orchestrator.ingest(command(
                "incremental-run", IngestionRun.Mode.INCREMENTAL, 2));

        assertEquals(1, incremental.versions().size());
        DatasetVersion increment = version(incremental, "orders");
        assertEquals(1, increment.rowCount());
        assertEquals(List.of(4L), ids(decode(increment, ordersDefinition())));
        assertEquals("4", text("select committed_cursor->>'id' from ingestion.dataset_cursors "
                + "where dataset_key='orders'"));
        assertEquals(profileVersion, text("select last_successful_version_id from "
                + "ingestion.dataset_cursors where dataset_key='profiles'"));
        assertEquals(4L, sourceJdbc.queryForObject(
                "select count(*) from source_data.orders", Long.class));
    }

    @Test
    void closesSourceSnapshotBeforeWritingTheFirstTargetBatchAndRecordsObservedContext() {
        insertOrder(1, "2026-01-01T00:00:00Z", "{\"kind\":\"a\"}");
        sourceJdbc.update("INSERT INTO source_data.profiles(id,display_name) VALUES (1,'profile-1')");

        AtomicBoolean sourceSnapshotClosed = new AtomicBoolean();
        PostgresSourceConnectionProvider connections = reference -> {
            DataSource sourceDataSource = dataSource(SOURCE);
            return new PostgresSourceConnectionProvider.ResolvedConnection(sourceDataSource,
                    new JdbcTransactionManager(sourceDataSource), 5);
        };
        PostgresSourceConnector delegateConnector = new PostgresSourceConnector(connections);
        SourceConnector observingConnector = new SourceConnector() {
            @Override
            public String connectorType() {
                return delegateConnector.connectorType();
            }

            @Override
            public SourceSnapshot openSnapshot(com.dip3.ontologyagent.ingestion.api.SourceDefinition source,
                                               List<DatasetDefinition> datasets,
                                               List<IngestionCursor> committedCursors,
                                               IngestionRun.Mode mode, int pageSize) {
                assertEquals("running", text("select status from ingestion.source_ingestion_runs "
                        + "where id='ordered-run'"));
                assertEquals("planned", text("select snapshot_context->>'phase' "
                        + "from ingestion.source_ingestion_runs where id='ordered-run'"));
                SourceSnapshot delegate = delegateConnector.openSnapshot(source, datasets,
                        committedCursors, mode, pageSize);
                return new SourceSnapshot() {
                    @Override
                    public Map<String, Object> snapshotContext() {
                        return delegate.snapshotContext();
                    }

                    @Override
                    public com.dip3.ontologyagent.ingestion.api.SourcePage readPage(String datasetKey) {
                        return delegate.readPage(datasetKey);
                    }

                    @Override
                    public com.dip3.ontologyagent.ingestion.api.SourcePage readPage(
                            String datasetKey, Map<String, Object> afterCursor) {
                        return delegate.readPage(datasetKey, afterCursor);
                    }

                    @Override
                    public void close() {
                        delegate.close();
                        sourceSnapshotClosed.set(true);
                    }
                };
            }
        };
        IngestionPostgresPersistenceAdapter target = spy(
                (IngestionPostgresPersistenceAdapter) persistence);
        doAnswer(invocation -> {
            assertTrue(sourceSnapshotClosed.get(),
                    "target batch writes must happen after source snapshot close");
            return invocation.callRealMethod();
        }).when(target).appendSourceBatch(any());

        SourceIngestionOrchestrator isolated = new SourceIngestionOrchestrator(
                new SourceCatalogPostgresAdapter(targetJdbc, new JsonCodec()),
                new SourceConnectorRegistry(List.of(observingConnector)), codec, target);

        SourceIngestionOrchestrator.Result result = isolated.ingest(
                command("ordered-run", IngestionRun.Mode.FULL, 1));

        assertTrue(sourceSnapshotClosed.get());
        assertEquals(2, result.versions().size());
        assertEquals("postgres", text("select snapshot_context->>'connector' "
                + "from ingestion.source_ingestion_runs where id='ordered-run'"));
        assertEquals("completed", text("select status from ingestion.source_ingestion_runs "
                + "where id='ordered-run'"));
    }

    @Test
    void failureInSecondDatasetLeavesNoTargetArtifacts() {
        insertOrder(1, "2026-01-01T00:00:00Z", "{\"kind\":\"a\"}");
        sourceJdbc.update("INSERT INTO source_data.profiles(id,display_name) VALUES (1,'profile-1')");
        SourceBatchCodec failingCodec = new SourceBatchCodec() {
            @Override public String codec() { return codec.codec(); }

            @Override
            public byte[] encode(DatasetDefinition definition, List<SourceRow> rows) {
                if ("profiles".equals(definition.datasetKey())) {
                    throw new IllegalArgumentException("test contract failure");
                }
                return codec.encode(definition, rows);
            }

            @Override
            public List<SourceRow> decode(DatasetDefinition definition, byte[] payload) {
                return codec.decode(definition, payload);
            }
        };
        PostgresSourceConnectionProvider connections = reference -> {
            DataSource dataSource = dataSource(SOURCE);
            return new PostgresSourceConnectionProvider.ResolvedConnection(dataSource,
                    new JdbcTransactionManager(dataSource), 5);
        };
        SourceIngestionOrchestrator failing = orchestrator(targetJdbc, new JsonCodec(),
                connections, failingCodec);

        assertThrows(IllegalArgumentException.class,
                () -> failing.ingest(command("failed-run", IngestionRun.Mode.FULL, 2)));

        assertEquals("failed", text("select status from ingestion.source_ingestion_runs "
                + "where id='failed-run'"));
        assertEquals("INGESTION_CONTRACT_INVALID", text("select error_code from "
                + "ingestion.source_ingestion_runs where id='failed-run'"));
        assertEquals("postgres", text("select snapshot_context->>'connector' from "
                + "ingestion.source_ingestion_runs where id='failed-run'"));
        assertEquals("profiles", text("select error_detail->>'datasetKey' from "
                + "ingestion.source_ingestion_runs where id='failed-run'"));
        assertEquals(0L, number("select count(*) from ingestion.source_dataset_versions"));
        assertEquals(0L, number("select count(*) from ingestion.source_dataset_batches"));
        assertEquals(0L, number("select count(*) from ingestion.dataset_cursors"));

        SourceIngestionOrchestrator.Result recovered = orchestrator.ingest(command(
                "recovery-run", IngestionRun.Mode.FULL, 2));
        assertTrue(recovered.versions().stream().allMatch(
                version -> version.status() == DatasetVersion.Status.PUBLISHED));
        assertEquals("completed", text("select status from ingestion.source_ingestion_runs "
                + "where id='recovery-run'"));
        assertEquals(2L, number("select count(*) from ingestion.dataset_cursors"));
    }

    @Test
    void incrementalWithoutCommittedCursorLeavesFailedAuditWithoutArtifacts() {
        SourceConnectorException error = assertThrows(SourceConnectorException.class,
                () -> orchestrator.ingest(command("missing-cursor-run",
                        IngestionRun.Mode.INCREMENTAL, 2)));

        assertEquals("SOURCE_CURSOR_CONTRACT_INVALID", error.code());
        assertEquals(1L, number("select count(*) from ingestion.source_ingestion_runs"));
        assertEquals("failed", text("select status from ingestion.source_ingestion_runs "
                + "where id='missing-cursor-run'"));
        assertEquals("SOURCE_CURSOR_CONTRACT_INVALID", text("select error_code from "
                + "ingestion.source_ingestion_runs where id='missing-cursor-run'"));
        assertEquals("planned", text("select snapshot_context->>'phase' from "
                + "ingestion.source_ingestion_runs where id='missing-cursor-run'"));
        assertEquals(0L, number("select count(*) from ingestion.source_dataset_versions"));
    }

    private SourceIngestionOrchestrator orchestrator(
            JdbcTemplate target, JsonCodec json,
            PostgresSourceConnectionProvider connections, SourceBatchCodec sourceCodec) {
        SourceCatalogPort catalog = new SourceCatalogPostgresAdapter(target, json);
        SourceConnectorRegistry connectors = new SourceConnectorRegistry(
                List.of(new PostgresSourceConnector(connections)));
        return new SourceIngestionOrchestrator(catalog, connectors, sourceCodec, persistence);
    }

    private List<SourceRow> decode(DatasetVersion version, DatasetDefinition definition) {
        List<SourceRow> rows = new ArrayList<>();
        for (IngestionPersistencePort.SourceBatch batch
                : persistence.readPublishedSourceBatches(version.id())) {
            rows.addAll(codec.decode(definition, batch.payload()));
        }
        return rows;
    }

    private void registerCatalog() {
        targetJdbc.update("""
                insert into ingestion.source_definitions
                  (source_key,connector_type,connection_ref,status)
                values ('source-test','postgres','source-test','active')
                """);
        targetJdbc.update("""
                insert into ingestion.dataset_definitions
                  (dataset_key,source_key,source_namespace,source_relation,primary_key_columns,
                   column_contract,cursor_spec,delete_policy,delete_spec,schema_version,status)
                values
                  ('orders','source-test','source_data','orders',array['id'],
                   '[{"name":"id","type":"LONG","nullable":false},
                     {"name":"updated_at","type":"TIMESTAMPTZ","nullable":false,
                      "timeSemantics":{"column":"updated_at","kind":"INSTANT"}},
                     {"name":"attributes","type":"JSON","nullable":false}]'::jsonb,
                   '{"strategy":"WATERMARK","watermarkColumn":"updated_at",
                     "tieBreakerColumn":"id"}'::jsonb,
                   'none','{}'::jsonb,1,'active'),
                  ('profiles','source-test','source_data','profiles',array['id'],
                   '[{"name":"id","type":"LONG","nullable":false},
                     {"name":"display_name","type":"STRING","nullable":false}]'::jsonb,
                   '{"strategy":"SNAPSHOT"}'::jsonb,
                   'none','{}'::jsonb,1,'active')
                """);
    }

    private DatasetDefinition ordersDefinition() {
        return new SourceCatalogPostgresAdapter(targetJdbc, new JsonCodec())
                .loadActiveSource("source-test").datasets().stream()
                .filter(dataset -> "orders".equals(dataset.datasetKey())).findFirst().orElseThrow();
    }

    private void insertOrder(long id, String updatedAt, String attributes) {
        sourceJdbc.update("INSERT INTO source_data.orders(id,updated_at,attributes) "
                        + "VALUES (?,?,cast(? as jsonb))", id,
                Timestamp.from(Instant.parse(updatedAt)), attributes);
    }

    private static SourceIngestionOrchestrator.Command command(
            String runId, IngestionRun.Mode mode, int pageSize) {
        return new SourceIngestionOrchestrator.Command(runId, "source-test", mode,
                IngestionRun.TriggerType.MANUAL, "operator", "trace-" + runId, pageSize);
    }

    private static DatasetVersion version(SourceIngestionOrchestrator.Result result,
                                          String datasetKey) {
        return result.versions().stream().filter(version -> datasetKey.equals(version.datasetKey()))
                .findFirst().orElseThrow();
    }

    private static List<Long> ids(List<SourceRow> rows) {
        return rows.stream().map(row -> ((Number) row.values().getFirst()).longValue()).toList();
    }

    private static DriverManagerDataSource dataSource(PostgreSQLContainer container) {
        return new DriverManagerDataSource(
                container.getJdbcUrl(), container.getUsername(), container.getPassword());
    }

    private String text(String sql) {
        return targetJdbc.queryForObject(sql, String.class);
    }

    private long number(String sql) {
        return targetJdbc.queryForObject(sql, Long.class);
    }
}
