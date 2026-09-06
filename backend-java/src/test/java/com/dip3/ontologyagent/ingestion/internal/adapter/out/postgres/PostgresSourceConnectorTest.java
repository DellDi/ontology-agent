package com.dip3.ontologyagent.ingestion.internal.adapter.out.postgres;

import com.dip3.ontologyagent.ingestion.spi.PostgresSourceConnectionProvider;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.IngestionCursor;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.SourceDefinition;
import com.dip3.ontologyagent.ingestion.api.SourcePage;
import com.dip3.ontologyagent.ingestion.api.SourceSnapshot;
import com.dip3.ontologyagent.ingestion.internal.application.SourceConnectorException;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.AbstractDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** PostgreSQL integration evidence for the connector boundary. */
@Testcontainers
class PostgresSourceConnectorTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

    private static JdbcTemplate admin;

    @BeforeAll
    static void connectAdmin() {
        admin = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        admin.execute("CREATE SCHEMA source_data");
    }

    @BeforeEach
    void resetSourceTables() {
        admin.execute("DROP TABLE IF EXISTS source_data.alpha, source_data.beta, "
                + "source_data.incremental, source_data.composite, source_data.schema_drift CASCADE");
        admin.execute("CREATE TABLE source_data.alpha (id bigint PRIMARY KEY, payload text, "
                + "updated_at timestamptz NOT NULL)");
        admin.execute("CREATE TABLE source_data.beta (id bigint PRIMARY KEY, payload text, "
                + "updated_at timestamptz NOT NULL)");
        admin.execute("CREATE TABLE source_data.incremental (id bigint PRIMARY KEY, payload text, "
                + "updated_at timestamptz NOT NULL)");
        admin.execute("CREATE TABLE source_data.composite (part_a bigint NOT NULL, part_b bigint NOT NULL, "
                + "payload text, PRIMARY KEY (part_a, part_b))");
    }

    @Test
    void oneSnapshotUsesOneReadOnlyRepeatableReadTransactionAcrossDatasets() throws Exception {
        insert("source_data.alpha", 1, "a1", "2026-01-01T00:00:00Z");
        insert("source_data.beta", 1, "b1", "2026-01-01T00:00:00Z");
        RecordingDataSource sourceDataSource = sourceDataSource();
        PostgresSourceConnector connector = connector(sourceDataSource);

        try (SourceSnapshot snapshot = connector.openSnapshot(source(),
                List.of(dataset("alpha", "alpha", DatasetDefinition.CursorSpec.Strategy.SNAPSHOT),
                        dataset("beta", "beta", DatasetDefinition.CursorSpec.Strategy.SNAPSHOT)),
                List.of(), IngestionRun.Mode.FULL, 1)) {
            assertEquals("postgres", snapshot.snapshotContext().get("connector"));
            assertTrue(snapshot.snapshotContext().containsKey("transactionSnapshot"));
            assertTrue(snapshot.snapshotContext().containsKey("observedAt"));
            assertEquals(List.of(1L), ids(snapshot.readPage("alpha")));

            // The snapshot was already established by alpha. This row must not
            // become visible when beta is read on the same source transaction.
            insert("source_data.beta", 2, "b2", "2026-01-01T00:00:00Z");
            assertEquals(List.of(1L), ids(snapshot.readPage("beta")));

            Connection connection = sourceDataSource.openedConnection.get();
            assertTrue(connection.isReadOnly());
            assertEquals(Connection.TRANSACTION_REPEATABLE_READ,
                    connection.getTransactionIsolation());
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT current_setting('transaction_read_only'), "
                            + "current_setting('transaction_isolation')");
                 ResultSet result = statement.executeQuery()) {
                assertTrue(result.next());
                assertEquals("on", result.getString(1));
                assertEquals("repeatable read", result.getString(2));
            }
            assertTrue(sourceDataSource.queryTimeouts.stream().allMatch(timeout -> timeout == 5));
            assertTrue(sourceDataSource.queryTimeouts.size() >= 2);
            assertEquals(List.of(2, 2), sourceDataSource.fetchSizes);
        }

        assertEquals(2, admin.queryForObject(
                "SELECT count(*) FROM source_data.beta", Integer.class));
    }

    @Test
    void fullSnapshotUsesCompletePrimaryKeyKeysetWithoutMissingOrDuplicateRows() {
        for (int id = 1; id <= 5; id++) {
            insert("source_data.alpha", id, "a" + id, "2026-01-01T00:00:00Z");
        }
        RecordingDataSource sourceDataSource = sourceDataSource();
        PostgresSourceConnector connector = connector(sourceDataSource);
        List<Long> ids = new ArrayList<>();
        try (SourceSnapshot snapshot = connector.openSnapshot(source(),
                List.of(dataset("alpha", "alpha", DatasetDefinition.CursorSpec.Strategy.SNAPSHOT)),
                List.of(emptyCursor("alpha")), IngestionRun.Mode.FULL, 2)) {
            SourcePage page = snapshot.readPage("alpha");
            while (true) {
                ids.addAll(ids(page));
                if (page.lastPage()) break;
                page = snapshot.readPage("alpha", page.nextCursor());
            }
        }

        assertEquals(List.of(1L, 2L, 3L, 4L, 5L), ids);
        assertEquals(5, ids.stream().distinct().count());
        assertTrue(sourceDataSource.preparedSql.stream().allMatch(sql ->
                sql.trim().toUpperCase().startsWith("SELECT")));
        assertTrue(sourceDataSource.preparedSql.stream().noneMatch(sql ->
                sql.toUpperCase().contains(" OFFSET ")));
    }

    @Test
    void incrementalSnapshotUsesWatermarkAndTieBreakerForEqualWatermarks() {
        insert("source_data.incremental", 1, "i1", "2026-01-01T00:00:00Z");
        insert("source_data.incremental", 2, "i2", "2026-01-01T00:00:00Z");
        insert("source_data.incremental", 3, "i3", "2026-01-02T00:00:00Z");
        DatasetDefinition definition = incrementalDataset();
        PostgresSourceConnector connector = connector(sourceDataSource());

        List<Long> ids = new ArrayList<>();
        try (SourceSnapshot snapshot = connector.openSnapshot(source(),
                List.of(definition), List.of(new IngestionCursor("incremental",
                        Map.of("updated_at", Instant.parse("2026-01-01T00:00:00Z"),
                                "id", 1L), null, Instant.now())),
                IngestionRun.Mode.INCREMENTAL, 1)) {
            SourcePage page = snapshot.readPage("incremental");
            while (true) {
                ids.addAll(ids(page));
                if (page.lastPage()) break;
                page = snapshot.readPage("incremental", page.nextCursor());
            }
        }

        assertEquals(List.of(2L, 3L), ids);
        assertEquals(ids.size(), ids.stream().distinct().count());
    }

    @Test
    void fullWatermarkSnapshotIgnoresOldCursorAndProducesIncrementalCheckpoint() {
        insert("source_data.incremental", 1, "i1", "2026-01-01T00:00:00Z");
        insert("source_data.incremental", 2, "i2", "2026-01-01T00:00:00Z");
        insert("source_data.incremental", 3, "i3", "2026-01-02T00:00:00Z");
        DatasetDefinition definition = incrementalDataset();
        PostgresSourceConnector connector = connector(sourceDataSource());
        Map<String, Object> checkpoint;

        List<Long> fullIds = new ArrayList<>();
        try (SourceSnapshot snapshot = connector.openSnapshot(source(), List.of(definition),
                List.of(new IngestionCursor("incremental",
                        Map.of("updated_at", Instant.parse("2026-01-02T00:00:00Z"), "id", 3L),
                        "old-version", Instant.now())), IngestionRun.Mode.FULL, 2)) {
            SourcePage page = snapshot.readPage("incremental");
            while (true) {
                fullIds.addAll(ids(page));
                if (page.lastPage()) {
                    checkpoint = page.nextCursor();
                    break;
                }
                page = snapshot.readPage("incremental", page.nextCursor());
            }
        }
        assertEquals(List.of(1L, 2L, 3L), fullIds);
        assertEquals(java.util.Set.of("updated_at", "id"), checkpoint.keySet());

        insert("source_data.incremental", 4, "i4", "2026-01-02T00:00:00Z");
        try (SourceSnapshot snapshot = connector.openSnapshot(source(), List.of(definition),
                List.of(new IngestionCursor("incremental", checkpoint, "full-version", Instant.now())),
                IngestionRun.Mode.INCREMENTAL, 10)) {
            assertEquals(List.of(4L), ids(snapshot.readPage("incremental")));
        }
    }

    @Test
    void fullSnapshotSupportsCompositePrimaryKeyKeyset() {
        admin.update("INSERT INTO source_data.composite(part_a,part_b,payload) VALUES "
                + "(1,1,'a'),(1,2,'b'),(2,1,'c'),(2,2,'d')");
        DatasetDefinition definition = new DatasetDefinition("composite", "source", "source_data",
                "composite", List.of(
                new DatasetDefinition.SourceColumn("part_a", DatasetDefinition.ColumnType.LONG, false),
                new DatasetDefinition.SourceColumn("part_b", DatasetDefinition.ColumnType.LONG, false),
                new DatasetDefinition.SourceColumn("payload", DatasetDefinition.ColumnType.STRING, true)),
                List.of("part_a", "part_b"), new DatasetDefinition.CursorSpec(
                DatasetDefinition.CursorSpec.Strategy.SNAPSHOT, null, null),
                DatasetDefinition.DeletePolicy.NONE, DatasetDefinition.DeletionSpec.none(), 1,
                DatasetDefinition.Status.ACTIVE, Map.of());
        List<String> keys = new ArrayList<>();

        try (SourceSnapshot snapshot = connector(sourceDataSource()).openSnapshot(source(),
                List.of(definition), List.of(), IngestionRun.Mode.FULL, 1)) {
            SourcePage page = snapshot.readPage("composite");
            while (true) {
                page.rows().forEach(row -> keys.add(row.values().get(0) + ":" + row.values().get(1)));
                if (page.lastPage()) break;
                page = snapshot.readPage("composite", page.nextCursor());
            }
        }

        assertEquals(List.of("1:1", "1:2", "2:1", "2:2"), keys);
    }

    @Test
    void readOnlySourceTransactionRejectsDmlAndConnectorHasNoSqlEscapeHatch() throws Exception {
        insert("source_data.alpha", 1, "original", "2026-01-01T00:00:00Z");
        RecordingDataSource sourceDataSource = sourceDataSource();
        PostgresSourceConnector connector = connector(sourceDataSource);

        try (SourceSnapshot ignored = connector.openSnapshot(source(),
                List.of(dataset("alpha", "alpha", DatasetDefinition.CursorSpec.Strategy.SNAPSHOT)),
                List.of(emptyCursor("alpha")), IngestionRun.Mode.FULL, 1)) {
            Connection connection = sourceDataSource.openedConnection.get();
            assertThrows(SQLException.class, () -> connection.createStatement().executeUpdate(
                    "UPDATE source_data.alpha SET payload = 'changed' WHERE id = 1"));
        }

        assertEquals("original", admin.queryForObject(
                "SELECT payload FROM source_data.alpha WHERE id = 1", String.class));
        assertThrows(IllegalArgumentException.class, () -> new DatasetDefinition(
                "unsafe", "source", "source_data", "alpha; DROP TABLE source_data.alpha",
                columns(), List.of("id"), new DatasetDefinition.CursorSpec(
                        DatasetDefinition.CursorSpec.Strategy.SNAPSHOT, null, null),
                DatasetDefinition.DeletePolicy.NONE, DatasetDefinition.DeletionSpec.none(), 1,
                DatasetDefinition.Status.ACTIVE, Map.of()));
    }

    @Test
    void unsupportedCdcAndIncompleteIncrementalCursorContractsFailLoudly() {
        DatasetDefinition cdc = new DatasetDefinition("cdc", "source", "source_data", "alpha",
                columns(), List.of("id"), new DatasetDefinition.CursorSpec(
                DatasetDefinition.CursorSpec.Strategy.SNAPSHOT, null, null),
                DatasetDefinition.DeletePolicy.CDC, DatasetDefinition.DeletionSpec.none(), 1,
                DatasetDefinition.Status.ACTIVE, Map.of());
        SourceConnectorException cdcError = assertThrows(SourceConnectorException.class,
                () -> connector(sourceDataSource()).openSnapshot(source(), List.of(cdc),
                        List.of(emptyCursor("cdc")), IngestionRun.Mode.FULL, 1));
        assertEquals("SOURCE_CURSOR_STRATEGY_UNSUPPORTED", cdcError.code());

        DatasetDefinition noTieBreaker = new DatasetDefinition("incremental", "source",
                "source_data", "incremental", columns(), List.of("id"),
                new DatasetDefinition.CursorSpec(DatasetDefinition.CursorSpec.Strategy.WATERMARK,
                        "updated_at", null), DatasetDefinition.DeletePolicy.NONE,
                DatasetDefinition.DeletionSpec.none(), 1, DatasetDefinition.Status.ACTIVE, Map.of());
        SourceConnectorException cursorError = assertThrows(SourceConnectorException.class,
                () -> connector(sourceDataSource()).openSnapshot(source(), List.of(noTieBreaker),
                        List.of(emptyCursor("incremental")), IngestionRun.Mode.INCREMENTAL, 1));
        assertEquals("SOURCE_CURSOR_CONTRACT_INVALID", cursorError.code());

        assertThrows(IllegalArgumentException.class,
                () -> connector(sourceDataSource()).openSnapshot(source(),
                        List.of(dataset("alpha", "alpha",
                                DatasetDefinition.CursorSpec.Strategy.SNAPSHOT)),
                        List.of(), IngestionRun.Mode.FULL,
                        PostgresSourceConnector.MAX_PAGE_SIZE + 1));
    }

    @Test
    void schemaMetadataDriftFailsEvenWhenTheSourceRelationIsEmpty() {
        admin.execute("CREATE TABLE source_data.schema_drift "
                + "(id bigint PRIMARY KEY, payload text)");
        DatasetDefinition nullabilityMismatch = new DatasetDefinition(
                "schema-drift", "source", "source_data", "schema_drift",
                List.of(
                        new DatasetDefinition.SourceColumn(
                                "id", DatasetDefinition.ColumnType.LONG, false),
                        new DatasetDefinition.SourceColumn(
                                "payload", DatasetDefinition.ColumnType.STRING, false)),
                List.of("id"), new DatasetDefinition.CursorSpec(
                DatasetDefinition.CursorSpec.Strategy.SNAPSHOT, null, null),
                DatasetDefinition.DeletePolicy.NONE, DatasetDefinition.DeletionSpec.none(),
                1, DatasetDefinition.Status.ACTIVE, Map.of());

        try (SourceSnapshot snapshot = connector(sourceDataSource()).openSnapshot(source(),
                List.of(nullabilityMismatch), List.of(), IngestionRun.Mode.FULL, 10)) {
            SourceConnectorException error = assertThrows(
                    SourceConnectorException.class,
                    () -> snapshot.readPage("schema-drift"));
            assertEquals("SOURCE_DATASET_SCHEMA_MISMATCH", error.code());
        }

        admin.execute("DROP TABLE source_data.schema_drift");
        admin.execute("CREATE TABLE source_data.schema_drift "
                + "(id text PRIMARY KEY, payload text)");
        DatasetDefinition typeMismatch = new DatasetDefinition(
                "schema-drift", "source", "source_data", "schema_drift",
                List.of(
                        new DatasetDefinition.SourceColumn(
                                "id", DatasetDefinition.ColumnType.LONG, false),
                        new DatasetDefinition.SourceColumn(
                                "payload", DatasetDefinition.ColumnType.STRING, true)),
                List.of("id"), new DatasetDefinition.CursorSpec(
                DatasetDefinition.CursorSpec.Strategy.SNAPSHOT, null, null),
                DatasetDefinition.DeletePolicy.NONE, DatasetDefinition.DeletionSpec.none(),
                1, DatasetDefinition.Status.ACTIVE, Map.of());
        try (SourceSnapshot snapshot = connector(sourceDataSource()).openSnapshot(source(),
                List.of(typeMismatch), List.of(), IngestionRun.Mode.FULL, 10)) {
            SourceConnectorException error = assertThrows(
                    SourceConnectorException.class,
                    () -> snapshot.readPage("schema-drift"));
            assertEquals("SOURCE_DATASET_SCHEMA_MISMATCH", error.code());
        }
    }

    private static PostgresSourceConnector connector(RecordingDataSource dataSource) {
        PlatformTransactionManager transactionManager = new DataSourceTransactionManager(dataSource);
        PostgresSourceConnectionProvider provider = ref ->
                new PostgresSourceConnectionProvider.ResolvedConnection(
                        dataSource, transactionManager, 5);
        return new PostgresSourceConnector(provider);
    }

    private static RecordingDataSource sourceDataSource() {
        return new RecordingDataSource(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }

    private static SourceDefinition source() {
        return new SourceDefinition("source", "postgres", "source_ref",
                SourceDefinition.Status.ACTIVE);
    }

    private static IngestionCursor emptyCursor(String datasetKey) {
        return new IngestionCursor(datasetKey, Map.of(), null, Instant.now());
    }

    private static DatasetDefinition dataset(String key, String relation,
                                             DatasetDefinition.CursorSpec.Strategy strategy) {
        return new DatasetDefinition(key, "source", "source_data", relation, columns(),
                List.of("id"), new DatasetDefinition.CursorSpec(strategy, null, null),
                DatasetDefinition.DeletePolicy.NONE, DatasetDefinition.DeletionSpec.none(), 1,
                DatasetDefinition.Status.ACTIVE, Map.of());
    }

    private static DatasetDefinition incrementalDataset() {
        return new DatasetDefinition("incremental", "source", "source_data", "incremental",
                columns(), List.of("id"), new DatasetDefinition.CursorSpec(
                DatasetDefinition.CursorSpec.Strategy.WATERMARK, "updated_at", "id"),
                DatasetDefinition.DeletePolicy.NONE, DatasetDefinition.DeletionSpec.none(), 1,
                DatasetDefinition.Status.ACTIVE, Map.of());
    }

    private static List<DatasetDefinition.SourceColumn> columns() {
        return List.of(
                new DatasetDefinition.SourceColumn("id", DatasetDefinition.ColumnType.LONG, false),
                new DatasetDefinition.SourceColumn("payload", DatasetDefinition.ColumnType.STRING, true),
                new DatasetDefinition.SourceColumn("updated_at", DatasetDefinition.ColumnType.TIMESTAMPTZ,
                        false, DatasetDefinition.TimeSemantics.instant("updated_at")));
    }

    private static void insert(String table, long id, String payload, String updatedAt) {
        admin.update("INSERT INTO " + table + " (id,payload,updated_at) VALUES (?,?,?)",
                id, payload, Timestamp.from(Instant.parse(updatedAt)));
    }

    private static List<Long> ids(SourcePage page) {
        return page.rows().stream().map(row -> ((Number) row.values().getFirst()).longValue()).toList();
    }

    /** Records the connector's prepared statements while retaining a real DataSource. */
    private static final class RecordingDataSource extends AbstractDataSource {
        private final DataSource delegate;
        private final AtomicReference<Connection> openedConnection = new AtomicReference<>();
        private final List<String> preparedSql = new ArrayList<>();
        private final List<Integer> queryTimeouts = new ArrayList<>();
        private final List<Integer> fetchSizes = new ArrayList<>();

        private RecordingDataSource(DataSource delegate) {
            this.delegate = delegate;
        }

        @Override
        public Connection getConnection() throws SQLException {
            return record(delegate.getConnection());
        }

        @Override
        public Connection getConnection(String username, String password) throws SQLException {
            return record(delegate.getConnection(username, password));
        }

        private Connection record(Connection connection) {
            openedConnection.set((Connection) Proxy.newProxyInstance(
                    Connection.class.getClassLoader(), new Class<?>[]{Connection.class},
                    (proxy, method, args) -> {
                        if ("prepareStatement".equals(method.getName())
                                && args != null && args.length > 0 && args[0] instanceof String sql) {
                            preparedSql.add(sql);
                        }
                        try {
                            Object result = method.invoke(connection, args);
                            if (result instanceof PreparedStatement statement
                                    && "prepareStatement".equals(method.getName())) {
                                return Proxy.newProxyInstance(PreparedStatement.class.getClassLoader(),
                                        new Class<?>[]{PreparedStatement.class},
                                        (preparedProxy, preparedMethod, preparedArgs) -> {
                                            if ("setQueryTimeout".equals(preparedMethod.getName())
                                                    && preparedArgs != null
                                                    && preparedArgs.length == 1) {
                                                queryTimeouts.add((Integer) preparedArgs[0]);
                                            }
                                            if ("setFetchSize".equals(preparedMethod.getName())
                                                    && preparedArgs != null
                                                    && preparedArgs.length == 1) {
                                                fetchSizes.add((Integer) preparedArgs[0]);
                                            }
                                            try {
                                                return preparedMethod.invoke(statement, preparedArgs);
                                            } catch (InvocationTargetException error) {
                                                throw error.getCause();
                                            }
                                        });
                            }
                            return result;
                        } catch (InvocationTargetException error) {
                            throw error.getCause();
                        }
                    }));
            return openedConnection.get();
        }
    }
}
