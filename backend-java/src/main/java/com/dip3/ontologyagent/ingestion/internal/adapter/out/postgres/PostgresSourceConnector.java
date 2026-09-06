package com.dip3.ontologyagent.ingestion.internal.adapter.out.postgres;

import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.IngestionCursor;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.SourceDefinition;
import com.dip3.ontologyagent.ingestion.api.SourcePage;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import com.dip3.ontologyagent.ingestion.api.SourceSnapshot;
import com.dip3.ontologyagent.ingestion.internal.application.SourceConnector;
import com.dip3.ontologyagent.ingestion.internal.application.SourceConnectorException;
import com.dip3.ontologyagent.ingestion.spi.PostgresSourceConnectionProvider;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.DefaultTransactionDefinition;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Governed PostgreSQL source reader.
 *
 * <p>Every snapshot owns one read-only repeatable-read source transaction.
 * Queries are generated solely from the validated {@link DatasetDefinition}
 * and use keyset predicates plus bound values. There is intentionally no
 * query-string escape hatch.</p>
 */
public final class PostgresSourceConnector implements SourceConnector {
    public static final String CONNECTOR_TYPE = "postgres";
    public static final int MAX_PAGE_SIZE = 10_000;
    static final int JDBC_FETCH_SIZE = 100;

    private static final Pattern IDENTIFIER = Pattern.compile("[a-z_][a-z0-9_]*");

    private final PostgresSourceConnectionProvider connectionProvider;

    public PostgresSourceConnector(PostgresSourceConnectionProvider connectionProvider) {
        this.connectionProvider = Objects.requireNonNull(
                connectionProvider, "connectionProvider must not be null");
    }

    @Override
    public String connectorType() {
        return CONNECTOR_TYPE;
    }

    @Override
    public SourceSnapshot openSnapshot(SourceDefinition source,
                                       List<DatasetDefinition> datasets,
                                       List<IngestionCursor> committedCursors,
                                       IngestionRun.Mode mode,
                                       int pageSize) {
        validateOpenArguments(source, datasets, committedCursors, mode, pageSize);
        List<DatasetPlan> plans = planDatasets(source, datasets, committedCursors, mode);

        PostgresSourceConnectionProvider.ResolvedConnection resolved;
        try {
            resolved = connectionProvider.resolve(source.connectionRef());
        } catch (RuntimeException error) {
            throw new SourceConnectorException("SOURCE_CONNECTION_RESOLUTION_FAILED",
                    "source connection could not be resolved for source " + source.sourceKey(), error);
        }
        if (resolved == null) {
            throw new SourceConnectorException("SOURCE_CONNECTION_RESOLUTION_FAILED",
                    "source connection provider returned no connection for source "
                            + source.sourceKey());
        }

        return beginSnapshot(source, plans, pageSize, resolved);
    }

    private SourceSnapshot beginSnapshot(SourceDefinition source,
                                         List<DatasetPlan> plans,
                                         int pageSize,
                                         PostgresSourceConnectionProvider.ResolvedConnection resolved) {
        DataSource dataSource = resolved.dataSource();
        PlatformTransactionManager transactionManager = resolved.transactionManager();
        DefaultTransactionDefinition definition = new DefaultTransactionDefinition();
        definition.setName("source-snapshot/" + source.sourceKey());
        definition.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        definition.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        definition.setReadOnly(true);

        TransactionStatus status = null;
        Connection connection = null;
        try {
            status = transactionManager.getTransaction(definition);
            connection = DataSourceUtils.getConnection(dataSource);
            if (!DataSourceUtils.isConnectionTransactional(connection, dataSource)) {
                throw new SourceConnectorException("SOURCE_TRANSACTION_NOT_BOUND",
                        "source connector did not obtain the transaction-bound connection");
            }
            Map<String, Object> snapshotContext = observeSnapshotTransaction(
                    connection, resolved.queryTimeoutSeconds());
            return new PostgresSourceSnapshot(source, plans, pageSize, dataSource,
                    transactionManager, status, connection, snapshotContext,
                    resolved.queryTimeoutSeconds());
        } catch (RuntimeException error) {
            rollbackQuietly(transactionManager, status);
            releaseQuietly(connection, dataSource);
            if (error instanceof SourceConnectorException) {
                throw error;
            }
            throw new SourceConnectorException("SOURCE_SNAPSHOT_OPEN_FAILED",
                    "could not open read-only source snapshot for " + source.sourceKey(), error);
        }
    }

    private static Map<String, Object> observeSnapshotTransaction(Connection connection,
                                                                  int queryTimeoutSeconds) {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT current_setting('transaction_read_only'), "
                        + "current_setting('transaction_isolation'), "
                        + "txid_current_snapshot()::text, transaction_timestamp()")) {
            statement.setQueryTimeout(queryTimeoutSeconds);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) {
                    throw new SourceConnectorException("SOURCE_TRANSACTION_INVALID",
                            "source transaction settings could not be observed");
                }
                String readOnly = result.getString(1);
                String isolation = result.getString(2);
                if (!"on".equalsIgnoreCase(readOnly)
                        || !"repeatable read".equalsIgnoreCase(isolation)) {
                    throw new SourceConnectorException("SOURCE_TRANSACTION_INVALID",
                            "source snapshot requires READ ONLY REPEATABLE READ transaction");
                }
                return Map.of(
                        "connector", CONNECTOR_TYPE,
                        "transactionSnapshot", result.getString(3),
                        "observedAt", result.getTimestamp(4).toInstant().toString());
            }
        } catch (SQLException error) {
            throw new SourceConnectorException("SOURCE_TRANSACTION_INVALID",
                    "source transaction settings could not be verified", error);
        }
    }

    private static void validateOpenArguments(SourceDefinition source,
                                              List<DatasetDefinition> datasets,
                                              List<IngestionCursor> cursors,
                                              IngestionRun.Mode mode,
                                              int pageSize) {
        if (source == null) throw new IllegalArgumentException("source must not be null");
        if (!CONNECTOR_TYPE.equals(source.connectorType())) {
            throw new SourceConnectorException("SOURCE_CONNECTOR_TYPE_UNSUPPORTED",
                    "PostgreSQL connector cannot read connector type " + source.connectorType());
        }
        if (source.status() != SourceDefinition.Status.ACTIVE) {
            throw new SourceConnectorException("SOURCE_DISABLED",
                    "source " + source.sourceKey() + " is not active");
        }
        if (datasets == null || datasets.isEmpty()) {
            throw new IllegalArgumentException("datasets must not be null or empty");
        }
        if (cursors == null) throw new IllegalArgumentException("committedCursors must not be null");
        if (mode == null) throw new IllegalArgumentException("mode must not be null");
        if (pageSize <= 0 || pageSize > MAX_PAGE_SIZE) {
            throw new IllegalArgumentException("pageSize must be between 1 and " + MAX_PAGE_SIZE);
        }
        if (datasets.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException("datasets must not contain null");
        }
        if (cursors.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException("committedCursors must not contain null");
        }
    }

    private static List<DatasetPlan> planDatasets(SourceDefinition source,
                                                  List<DatasetDefinition> datasets,
                                                  List<IngestionCursor> committedCursors,
                                                  IngestionRun.Mode mode) {
        Map<String, IngestionCursor> cursorByDataset = new HashMap<>();
        for (IngestionCursor cursor : committedCursors) {
            if (cursorByDataset.putIfAbsent(cursor.datasetKey(), cursor) != null) {
                throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                        "more than one committed cursor was supplied for dataset "
                                + cursor.datasetKey());
            }
        }

        Set<String> datasetKeys = new HashSet<>();
        Map<String, DatasetPlan> plans = new LinkedHashMap<>();
        for (DatasetDefinition dataset : datasets) {
            if (!datasetKeys.add(dataset.datasetKey())) {
                throw new SourceConnectorException("SOURCE_DATASET_CONTRACT_INVALID",
                        "dataset was supplied more than once: " + dataset.datasetKey());
            }
            if (!source.sourceKey().equals(dataset.sourceKey())) {
                throw new SourceConnectorException("SOURCE_DATASET_SOURCE_MISMATCH",
                        "dataset " + dataset.datasetKey() + " belongs to source "
                                + dataset.sourceKey() + ", not " + source.sourceKey());
            }
            if (dataset.status() != DatasetDefinition.Status.ACTIVE) {
                throw new SourceConnectorException("SOURCE_DATASET_DISABLED",
                        "dataset " + dataset.datasetKey() + " is not active");
            }
            IngestionCursor cursor = cursorByDataset.get(dataset.datasetKey());
            if (cursor == null && mode == IngestionRun.Mode.INCREMENTAL) {
                throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                        "incremental mode requires a committed cursor for dataset "
                                + dataset.datasetKey());
            }
            DatasetPlan plan = DatasetPlan.create(dataset,
                    cursor == null ? Map.of() : cursor.committedCursor(), mode);
            plans.put(dataset.datasetKey(), plan);
        }
        if (!plans.keySet().containsAll(cursorByDataset.keySet())) {
            Set<String> extra = new HashSet<>(cursorByDataset.keySet());
            extra.removeAll(plans.keySet());
            throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                    "committed cursor supplied for unknown dataset(s): " + extra);
        }
        return List.copyOf(plans.values());
    }

    private static void rollbackQuietly(PlatformTransactionManager manager,
                                        TransactionStatus status) {
        if (manager == null || status == null || status.isCompleted()) return;
        try {
            manager.rollback(status);
        } catch (RuntimeException ignored) {
            // Preserve the original source-transaction failure.
        }
    }

    private static void releaseQuietly(Connection connection, DataSource dataSource) {
        if (connection == null) return;
        try {
            DataSourceUtils.releaseConnection(connection, dataSource);
        } catch (RuntimeException ignored) {
            // The transaction manager owns cleanup; an earlier error is more useful.
        }
    }

    private static final class DatasetPlan {
        private final DatasetDefinition definition;
        private final List<DatasetDefinition.SourceColumn> columns;
        private final Map<String, DatasetDefinition.SourceColumn> columnsByName;
        private final List<String> orderColumns;
        private final Map<String, Object> initialCursor;
        private final boolean watermarkCursor;

        private DatasetPlan(DatasetDefinition definition,
                            List<DatasetDefinition.SourceColumn> columns,
                            Map<String, DatasetDefinition.SourceColumn> columnsByName,
                            List<String> orderColumns,
                            Map<String, Object> initialCursor,
                            boolean watermarkCursor) {
            this.definition = definition;
            this.columns = columns;
            this.columnsByName = columnsByName;
            this.orderColumns = orderColumns;
            this.initialCursor = initialCursor;
            this.watermarkCursor = watermarkCursor;
        }

        static DatasetPlan create(DatasetDefinition definition,
                                  Map<String, Object> committedCursor,
                                  IngestionRun.Mode mode) {
            if (definition.deletePolicy() == DatasetDefinition.DeletePolicy.CDC) {
                throw new SourceConnectorException("SOURCE_CURSOR_STRATEGY_UNSUPPORTED",
                        "CDC is not supported by the PostgreSQL source connector for dataset "
                                + definition.datasetKey());
            }
            List<DatasetDefinition.SourceColumn> columns = definition.columnContract();
            Map<String, DatasetDefinition.SourceColumn> columnsByName = new LinkedHashMap<>();
            for (DatasetDefinition.SourceColumn column : columns) {
                if (!IDENTIFIER.matcher(column.name()).matches()) {
                    throw new SourceConnectorException("SOURCE_IDENTIFIER_INVALID",
                            "invalid source column identifier " + column.name());
                }
                columnsByName.put(column.name(), column);
            }
            if (!IDENTIFIER.matcher(definition.sourceNamespace()).matches()
                    || !IDENTIFIER.matcher(definition.sourceRelation()).matches()) {
                throw new SourceConnectorException("SOURCE_IDENTIFIER_INVALID",
                        "invalid source relation identifier for dataset " + definition.datasetKey());
            }

            boolean watermarkCursor = definition.cursorSpec().strategy()
                    == DatasetDefinition.CursorSpec.Strategy.WATERMARK;
            if (mode == IngestionRun.Mode.INCREMENTAL && !watermarkCursor) {
                throw new SourceConnectorException("SOURCE_CURSOR_STRATEGY_UNSUPPORTED",
                        "incremental dataset " + definition.datasetKey()
                                + " must declare a WATERMARK cursor strategy");
            }
            if (watermarkCursor) {
                validateWatermarkContract(definition, columnsByName);
            }
            List<String> orderColumns = watermarkCursor
                    ? List.of(definition.cursorSpec().watermarkColumn(),
                    definition.cursorSpec().tieBreakerColumn())
                    : definition.primaryKeyColumns();
            Map<String, Object> initialCursor = mode == IngestionRun.Mode.INCREMENTAL
                    ? normalizeCursor(definition, committedCursor, orderColumns, watermarkCursor)
                    : Map.of();
            return new DatasetPlan(definition, columns, Collections.unmodifiableMap(columnsByName),
                    List.copyOf(orderColumns), initialCursor, watermarkCursor);
        }

        private static void validateWatermarkContract(DatasetDefinition definition,
                                                       Map<String, DatasetDefinition.SourceColumn> columnsByName) {
            if (definition.primaryKeyColumns().size() != 1) {
                throw new SourceConnectorException("SOURCE_CURSOR_STRATEGY_UNSUPPORTED",
                        "incremental dataset " + definition.datasetKey()
                                + " must have a single-column primary key");
            }
            String watermark = definition.cursorSpec().watermarkColumn();
            String tieBreaker = definition.cursorSpec().tieBreakerColumn();
            if (watermark == null || tieBreaker == null) {
                throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                        "incremental dataset " + definition.datasetKey()
                                + " requires watermark and tie-breaker columns");
            }
            if (watermark.equals(tieBreaker)
                    || !tieBreaker.equals(definition.primaryKeyColumns().getFirst())) {
                throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                        "watermark and tie-breaker must be distinct and tie-breaker must be the "
                                + "single primary key for dataset " + definition.datasetKey());
            }
            DatasetDefinition.SourceColumn watermarkColumn = columnsByName.get(watermark);
            DatasetDefinition.SourceColumn tieColumn = columnsByName.get(tieBreaker);
            if (watermarkColumn == null || tieColumn == null
                    || watermarkColumn.nullable() || tieColumn.nullable()) {
                throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                        "incremental cursor columns must be declared and non-null for dataset "
                                + definition.datasetKey());
            }
            if (!isOrderable(watermarkColumn.type()) || !isOrderable(tieColumn.type())) {
                throw new SourceConnectorException("SOURCE_CURSOR_STRATEGY_UNSUPPORTED",
                        "incremental cursor columns must be PostgreSQL-orderable for dataset "
                                + definition.datasetKey());
            }
        }

        private static boolean isOrderable(DatasetDefinition.ColumnType type) {
            return type != DatasetDefinition.ColumnType.JSON;
        }

        private static Map<String, Object> normalizeCursor(DatasetDefinition definition,
                                                            Map<String, Object> cursor,
                                                            List<String> orderColumns,
                                                            boolean watermarkMode) {
            if (cursor == null) {
                throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                        "committed cursor is null for dataset " + definition.datasetKey());
            }
            if (cursor.isEmpty()) return Map.of();

            Map<String, Object> normalized = new LinkedHashMap<>();
            if (watermarkMode && cursor.keySet().equals(Set.of("watermark", "tieBreaker"))) {
                normalized.put(orderColumns.get(0), cursor.get("watermark"));
                normalized.put(orderColumns.get(1), cursor.get("tieBreaker"));
            } else {
                if (!cursor.keySet().equals(new HashSet<>(orderColumns))) {
                    throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                            "cursor for dataset " + definition.datasetKey()
                                    + " must contain exactly " + orderColumns);
                }
                for (String column : orderColumns) {
                    normalized.put(column, cursor.get(column));
                }
            }
            if (normalized.values().stream().anyMatch(Objects::isNull)) {
                throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                        "cursor values must be non-null for dataset " + definition.datasetKey());
            }
            return Collections.unmodifiableMap(normalized);
        }
    }

    private static final class PostgresSourceSnapshot implements SourceSnapshot {
        private final SourceDefinition source;
        private final Map<String, DatasetPlan> plans;
        private final int pageSize;
        private final DataSource dataSource;
        private final PlatformTransactionManager transactionManager;
        private final TransactionStatus transaction;
        private final Connection connection;
        private final Map<String, Object> snapshotContext;
        private final int queryTimeoutSeconds;
        private final Thread owner;
        private boolean closed;

        private PostgresSourceSnapshot(SourceDefinition source,
                                       List<DatasetPlan> plans,
                                       int pageSize,
                                       DataSource dataSource,
                                       PlatformTransactionManager transactionManager,
                                       TransactionStatus transaction,
                                       Connection connection,
                                       Map<String, Object> snapshotContext,
                                       int queryTimeoutSeconds) {
            this.source = source;
            this.plans = new LinkedHashMap<>();
            for (DatasetPlan plan : plans) {
                this.plans.put(plan.definition.datasetKey(), plan);
            }
            this.pageSize = pageSize;
            this.dataSource = dataSource;
            this.transactionManager = transactionManager;
            this.transaction = transaction;
            this.connection = connection;
            this.snapshotContext = Map.copyOf(snapshotContext);
            this.queryTimeoutSeconds = queryTimeoutSeconds;
            this.owner = Thread.currentThread();
        }

        @Override
        public Map<String, Object> snapshotContext() {
            ensureUsable();
            return snapshotContext;
        }

        @Override
        public SourcePage readPage(String datasetKey) {
            DatasetPlan plan = requirePlan(datasetKey);
            return readPage(plan, plan.initialCursor);
        }

        @Override
        public SourcePage readPage(String datasetKey, Map<String, Object> afterCursor) {
            DatasetPlan plan = requirePlan(datasetKey);
            Map<String, Object> normalized = DatasetPlan.normalizeCursor(plan.definition,
                    afterCursor, plan.orderColumns, plan.watermarkCursor);
            return readPage(plan, normalized);
        }

        private SourcePage readPage(DatasetPlan plan, Map<String, Object> afterCursor) {
            ensureUsable();
            try {
                String sql = selectSql(plan, afterCursor);
                List<SourceRow> fetched = new ArrayList<>(pageSize + 1);
                try (PreparedStatement statement = connection.prepareStatement(sql)) {
                    statement.setQueryTimeout(queryTimeoutSeconds);
                    statement.setFetchSize(Math.min(pageSize + 1, JDBC_FETCH_SIZE));
                    int parameter = 1;
                    for (String orderColumn : plan.orderColumns) {
                        if (!afterCursor.isEmpty()) {
                            bind(statement, parameter++, afterCursor.get(orderColumn),
                                    plan.columnsByName.get(orderColumn));
                        }
                    }
                    statement.setInt(parameter, pageSize + 1);
                    try (ResultSet result = statement.executeQuery()) {
                        validateResultContract(result.getMetaData(), plan);
                        while (result.next()) {
                            List<Object> values = new ArrayList<>(plan.columns.size());
                            for (int i = 1; i <= plan.columns.size(); i++) {
                                values.add(result.getObject(i));
                            }
                            validateSourceCursorValues(plan, values);
                            fetched.add(new SourceRow(values));
                        }
                    }
                }

                boolean lastPage = fetched.size() <= pageSize;
                List<SourceRow> rows = lastPage
                        ? List.copyOf(fetched)
                        : List.copyOf(fetched.subList(0, pageSize));
                Map<String, Object> nextCursor = rows.isEmpty()
                        ? afterCursor
                        : cursorFromRow(plan, rows.getLast());
                return new SourcePage(plan.definition.datasetKey(), rows, nextCursor, lastPage);
            } catch (SourceConnectorException error) {
                abort();
                throw error;
            } catch (SQLException | RuntimeException error) {
                abort();
                throw new SourceConnectorException("SOURCE_READ_FAILED",
                        "source dataset read failed for " + plan.definition.datasetKey()
                                + " from source " + source.sourceKey(), error);
            }
        }

        private DatasetPlan requirePlan(String datasetKey) {
            ensureUsable();
            if (datasetKey == null) throw new IllegalArgumentException("datasetKey must not be null");
            DatasetPlan plan = plans.get(datasetKey);
            if (plan == null) {
                throw new SourceConnectorException("SOURCE_DATASET_NOT_IN_SNAPSHOT",
                        "dataset " + datasetKey + " was not registered in this source snapshot");
            }
            return plan;
        }

        private void ensureUsable() {
            if (Thread.currentThread() != owner) {
                throw new SourceConnectorException("SOURCE_SNAPSHOT_THREAD_INVALID",
                        "source snapshot must be consumed on its opening thread");
            }
            if (closed || transaction.isCompleted()) {
                throw new SourceConnectorException("SOURCE_SNAPSHOT_CLOSED",
                        "source snapshot is already closed");
            }
        }

        private void abort() {
            if (closed) return;
            closed = true;
            rollbackQuietly(transactionManager, transaction);
            releaseQuietly(connection, dataSource);
        }

        @Override
        public void close() {
            if (closed) return;
            if (Thread.currentThread() != owner) {
                throw new SourceConnectorException("SOURCE_SNAPSHOT_THREAD_INVALID",
                        "source snapshot must be closed on its opening thread");
            }
            closed = true;
            try {
                if (!transaction.isCompleted()) {
                    transactionManager.commit(transaction);
                }
            } catch (RuntimeException error) {
                rollbackQuietly(transactionManager, transaction);
                throw new SourceConnectorException("SOURCE_SNAPSHOT_CLOSE_FAILED",
                        "source snapshot transaction could not be closed", error);
            } finally {
                releaseQuietly(connection, dataSource);
            }
        }

        private static String selectSql(DatasetPlan plan, Map<String, Object> afterCursor) {
            String projection = plan.columns.stream()
                    .map(column -> quote(column.name()))
                    .reduce((left, right) -> left + "," + right)
                    .orElseThrow();
            String relation = quote(plan.definition.sourceNamespace()) + "."
                    + quote(plan.definition.sourceRelation());
            String order = plan.orderColumns.stream()
                    .map(PostgresSourceSnapshot::quote)
                    .map(column -> column + " ASC")
                    .reduce((left, right) -> left + "," + right)
                    .orElseThrow();
            StringBuilder sql = new StringBuilder("SELECT ")
                    .append(projection)
                    .append(" FROM ")
                    .append(relation);
            if (!afterCursor.isEmpty()) {
                if (plan.orderColumns.size() == 1) {
                    sql.append(" WHERE ").append(quote(plan.orderColumns.getFirst())).append(" > ?");
                } else {
                    sql.append(" WHERE (")
                            .append(plan.orderColumns.stream().map(PostgresSourceSnapshot::quote)
                                    .reduce((left, right) -> left + "," + right).orElseThrow())
                            .append(") > (")
                            .append("?,".repeat(plan.orderColumns.size() - 1)).append("?)");
                }
            }
            return sql.append(" ORDER BY ").append(order).append(" LIMIT ?").toString();
        }

        private static void bind(PreparedStatement statement, int parameter, Object value,
                                 DatasetDefinition.SourceColumn column) throws SQLException {
            if (column == null) {
                throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                        "cursor column was not declared in the dataset contract");
            }
            statement.setObject(parameter, jdbcValue(value, column.type()));
        }

        private static Object jdbcValue(Object value, DatasetDefinition.ColumnType type) {
            if (value == null) return null;
            if (value instanceof Instant instant
                    && (type == DatasetDefinition.ColumnType.TIMESTAMPTZ
                    || type == DatasetDefinition.ColumnType.INSTANT)) {
                return Timestamp.from(instant);
            }
            if (value instanceof OffsetDateTime offsetDateTime
                    && (type == DatasetDefinition.ColumnType.TIMESTAMPTZ
                    || type == DatasetDefinition.ColumnType.INSTANT)) {
                return Timestamp.from(offsetDateTime.toInstant());
            }
            if (value instanceof java.sql.Date || value instanceof Timestamp
                    || value instanceof UUID || value instanceof LocalDate
                    || value instanceof LocalDateTime || value instanceof Instant
                    || value instanceof OffsetDateTime || value instanceof BigDecimal) {
                return value;
            }
            if (value instanceof Number number) {
                return switch (type) {
                    case INTEGER -> number.intValue();
                    case LONG -> number.longValue();
                    case DECIMAL -> new BigDecimal(number.toString());
                    default -> value;
                };
            }
            if (!(value instanceof String text)) return value;
            try {
                return switch (type) {
                    case INTEGER -> Integer.valueOf(text);
                    case LONG -> Long.valueOf(text);
                    case DECIMAL -> new BigDecimal(text);
                    case BOOLEAN -> parseBoolean(text);
                    case DATE -> Date.valueOf(LocalDate.parse(text));
                    case TIMESTAMP_WITHOUT_TIME_ZONE -> Timestamp.valueOf(
                            LocalDateTime.parse(text)).toLocalDateTime();
                    case TIMESTAMPTZ, INSTANT -> Timestamp.from(Instant.parse(text));
                    case UUID -> UUID.fromString(text);
                    default -> text;
                };
            } catch (RuntimeException error) {
                throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                        "cursor value cannot be parsed as " + type, error);
            }
        }

        private static Boolean parseBoolean(String text) {
            if ("true".equalsIgnoreCase(text)) return Boolean.TRUE;
            if ("false".equalsIgnoreCase(text)) return Boolean.FALSE;
            throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                    "cursor value cannot be parsed as BOOLEAN");
        }

        private static void validateSourceCursorValues(DatasetPlan plan, List<Object> values) {
            for (String orderColumn : plan.orderColumns) {
                int index = indexOf(plan.columns, orderColumn);
                if (values.get(index) == null) {
                    throw new SourceConnectorException("SOURCE_CURSOR_CONTRACT_INVALID",
                            "source row has a null keyset value in " + orderColumn
                                    + " for dataset " + plan.definition.datasetKey());
                }
            }
        }

        private static void validateResultContract(ResultSetMetaData metadata,
                                                   DatasetPlan plan) throws SQLException {
            if (metadata.getColumnCount() != plan.columns.size()) {
                throw schemaMismatch(plan, "projection column count changed");
            }
            for (int index = 1; index <= metadata.getColumnCount(); index++) {
                DatasetDefinition.SourceColumn expected = plan.columns.get(index - 1);
                if (!expected.name().equals(metadata.getColumnLabel(index))) {
                    throw schemaMismatch(plan, "expected column " + expected.name()
                            + " at position " + index + " but found "
                            + metadata.getColumnLabel(index));
                }
                int nullable = metadata.isNullable(index);
                if (nullable == ResultSetMetaData.columnNullableUnknown
                        || expected.nullable() != (nullable == ResultSetMetaData.columnNullable)) {
                    throw schemaMismatch(plan, "nullability changed for column " + expected.name());
                }
                if (!compatibleType(expected.type(), metadata.getColumnType(index),
                        metadata.getColumnTypeName(index), metadata.getColumnClassName(index))) {
                    throw schemaMismatch(plan, "type changed for column " + expected.name()
                            + " to " + metadata.getColumnTypeName(index));
                }
            }
        }

        private static boolean compatibleType(DatasetDefinition.ColumnType expected,
                                              int jdbcType, String typeName,
                                              String className) {
            String normalized = typeName == null ? "" : typeName.toLowerCase(Locale.ROOT);
            return switch (expected) {
                case STRING -> jdbcType == Types.CHAR || jdbcType == Types.VARCHAR
                        || jdbcType == Types.LONGVARCHAR
                        || (jdbcType == Types.OTHER && "java.lang.String".equals(className));
                case INTEGER -> jdbcType == Types.TINYINT || jdbcType == Types.SMALLINT
                        || jdbcType == Types.INTEGER;
                case LONG -> jdbcType == Types.BIGINT;
                case DECIMAL -> jdbcType == Types.DECIMAL || jdbcType == Types.NUMERIC;
                case BOOLEAN -> jdbcType == Types.BOOLEAN || jdbcType == Types.BIT;
                case DATE -> jdbcType == Types.DATE;
                case TIMESTAMP_WITHOUT_TIME_ZONE -> jdbcType == Types.TIMESTAMP
                        && !normalized.contains("with time zone") && !normalized.equals("timestamptz");
                case TIMESTAMPTZ, INSTANT -> jdbcType == Types.TIMESTAMP_WITH_TIMEZONE
                        || normalized.equals("timestamptz")
                        || normalized.contains("with time zone");
                case JSON -> jdbcType == Types.OTHER
                        && (normalized.equals("json") || normalized.equals("jsonb"));
                case UUID -> jdbcType == Types.OTHER && normalized.equals("uuid");
            };
        }

        private static SourceConnectorException schemaMismatch(DatasetPlan plan, String detail) {
            return new SourceConnectorException("SOURCE_DATASET_SCHEMA_MISMATCH",
                    "source schema no longer matches dataset "
                            + plan.definition.datasetKey() + ": " + detail);
        }

        private static Map<String, Object> cursorFromRow(DatasetPlan plan, SourceRow row) {
            Map<String, Object> cursor = new LinkedHashMap<>();
            for (String orderColumn : plan.orderColumns) {
                DatasetDefinition.SourceColumn column = plan.columnsByName.get(orderColumn);
                cursor.put(orderColumn, durableCursorValue(
                        row.values().get(indexOf(plan.columns, orderColumn)), column.type()));
            }
            return cursor;
        }

        /** Convert JDBC values to JSON-stable values before the cursor crosses the connector port. */
        private static Object durableCursorValue(Object value,
                                                 DatasetDefinition.ColumnType type) {
            if (value == null) return null;
            return switch (type) {
                case INTEGER -> value instanceof Number number ? number.intValue() : value;
                case LONG -> value instanceof Number number ? number.longValue() : value;
                case DECIMAL -> value instanceof BigDecimal decimal
                        ? decimal : new BigDecimal(value.toString());
                case DATE -> value instanceof java.sql.Date date
                        ? date.toLocalDate().toString() : value.toString();
                case TIMESTAMP_WITHOUT_TIME_ZONE -> value instanceof Timestamp timestamp
                        ? timestamp.toLocalDateTime().toString() : value.toString();
                case TIMESTAMPTZ, INSTANT -> {
                    if (value instanceof Timestamp timestamp) yield timestamp.toInstant().toString();
                    if (value instanceof OffsetDateTime offset) yield offset.toInstant().toString();
                    if (value instanceof Instant instant) yield instant.toString();
                    yield value.toString();
                }
                case UUID -> value.toString();
                default -> value;
            };
        }

        private static int indexOf(List<DatasetDefinition.SourceColumn> columns, String name) {
            for (int i = 0; i < columns.size(); i++) {
                if (columns.get(i).name().equals(name)) return i;
            }
            throw new SourceConnectorException("SOURCE_DATASET_CONTRACT_INVALID",
                    "cursor column was not found in column contract: " + name);
        }

        private static String quote(String identifier) {
            if (identifier == null || !IDENTIFIER.matcher(identifier).matches()) {
                throw new SourceConnectorException("SOURCE_IDENTIFIER_INVALID",
                        "source identifier is not valid");
            }
            return "\"" + identifier.replace("\"", "\"\"") + "\"";
        }
    }
}
