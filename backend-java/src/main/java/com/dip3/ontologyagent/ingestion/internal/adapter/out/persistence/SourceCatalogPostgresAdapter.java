package com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence;

import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.IngestionCursor;
import com.dip3.ontologyagent.ingestion.api.SourceDefinition;
import com.dip3.ontologyagent.ingestion.internal.application.SourceCatalogPort;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/** PostgreSQL reader for the governed source catalog owned by this application. */
@Repository
public class SourceCatalogPostgresAdapter implements SourceCatalogPort {
    private static final Pattern CATALOG_KEY = Pattern.compile("[a-z][a-z0-9_-]*");

    private final JdbcTemplate jdbc;
    private final JsonCodec json;

    public SourceCatalogPostgresAdapter(JdbcTemplate jdbc, JsonCodec json) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.json = Objects.requireNonNull(json, "json must not be null");
    }

    @Override
    public SourceCatalog loadActiveSource(String sourceKey) {
        if (sourceKey == null || !CATALOG_KEY.matcher(sourceKey).matches()) {
            throw new IllegalArgumentException("sourceKey must be a restricted catalog key");
        }
        List<CatalogRow> rows = jdbc.query("""
                select s.source_key,s.connector_type,s.connection_ref,s.status as source_status,
                       d.dataset_key,d.source_namespace,d.source_relation,d.primary_key_columns,
                       d.column_contract,d.cursor_spec,d.delete_policy,d.delete_spec,
                       d.schema_version,d.status as dataset_status,d.metadata,
                       c.committed_cursor,c.last_successful_version_id,c.updated_at as cursor_updated_at
                from ingestion.source_definitions s
                left join ingestion.dataset_definitions d
                  on d.source_key=s.source_key and d.status='active'
                left join ingestion.dataset_cursors c on c.dataset_key=d.dataset_key
                where s.source_key=?
                order by d.dataset_key
                """, this::catalogRow, sourceKey);
        if (rows.isEmpty()) {
            throw catalogError("INGESTION_SOURCE_NOT_FOUND", "source 未注册：" + sourceKey, null);
        }

        CatalogRow first = rows.getFirst();
        SourceDefinition source = new SourceDefinition(first.sourceKey(), first.connectorType(),
                first.connectionRef(), status(SourceDefinition.Status.class, first.sourceStatus(),
                "source status"));
        if (source.status() != SourceDefinition.Status.ACTIVE) {
            throw catalogError("INGESTION_SOURCE_NOT_ACTIVE", "source 已禁用：" + sourceKey, null);
        }

        List<DatasetDefinition> datasets = new ArrayList<>();
        List<IngestionCursor> cursors = new ArrayList<>();
        for (CatalogRow row : rows) {
            if (row.datasetKey() == null) continue;
            try {
                datasets.add(dataset(row, sourceKey));
                if (row.cursorUpdatedAt() != null) {
                    cursors.add(new IngestionCursor(row.datasetKey(),
                            json.map(row.committedCursor()), row.lastSuccessfulVersionId(),
                            row.cursorUpdatedAt()));
                }
            } catch (SQLException | RuntimeException error) {
                throw catalogError("INGESTION_CATALOG_INVALID",
                        "dataset 定义无效：" + row.datasetKey(), error);
            }
        }
        if (datasets.isEmpty()) {
            throw catalogError("INGESTION_DATASETS_NOT_FOUND",
                    "source 没有 active dataset：" + sourceKey, null);
        }
        return new SourceCatalog(source, datasets, cursors);
    }

    private DatasetDefinition dataset(CatalogRow row, String sourceKey) throws SQLException {
        List<DatasetDefinition.SourceColumn> columns = json.list(row.columnContract()).stream()
                .map(this::sourceColumn).toList();
        Map<String, Object> cursor = json.map(row.cursorSpec());
        Map<String, Object> deletion = json.map(row.deleteSpec());
        return new DatasetDefinition(row.datasetKey(), sourceKey, row.sourceNamespace(),
                row.sourceRelation(), columns, JsonCodec.strings(row.primaryKeyColumns()),
                new DatasetDefinition.CursorSpec(
                        status(DatasetDefinition.CursorSpec.Strategy.class,
                                requiredText(cursor, "strategy"), "cursor strategy"),
                        optionalText(cursor, "watermarkColumn"),
                        optionalText(cursor, "tieBreakerColumn")),
                status(DatasetDefinition.DeletePolicy.class, row.deletePolicy(), "delete policy"),
                new DatasetDefinition.DeletionSpec(optionalText(deletion, "column"),
                        stringList(deletion.get("deletedValues"), "deletedValues")),
                row.schemaVersion(),
                status(DatasetDefinition.Status.class, row.datasetStatus(), "dataset status"),
                json.map(row.metadata()));
    }

    private DatasetDefinition.SourceColumn sourceColumn(Map<String, Object> value) {
        String name = requiredText(value, "name");
        DatasetDefinition.ColumnType type = status(DatasetDefinition.ColumnType.class,
                requiredText(value, "type"), "column type");
        Object nullableValue = value.get("nullable");
        if (!(nullableValue instanceof Boolean nullable)) {
            throw new IllegalArgumentException("column nullable must be boolean");
        }
        DatasetDefinition.TimeSemantics semantics = null;
        Object semanticsValue = value.get("timeSemantics");
        if (semanticsValue != null) {
            if (!(semanticsValue instanceof Map<?, ?> raw)) {
                throw new IllegalArgumentException("timeSemantics must be an object");
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> map = (Map<String, Object>) raw;
            DatasetDefinition.TimeSemantics.Kind kind = status(
                    DatasetDefinition.TimeSemantics.Kind.class,
                    requiredText(map, "kind"), "time semantics kind");
            String zone = optionalText(map, "zoneId");
            semantics = new DatasetDefinition.TimeSemantics(
                    optionalText(map, "column") == null ? name : optionalText(map, "column"),
                    kind, zone == null ? null : ZoneId.of(zone));
        }
        return new DatasetDefinition.SourceColumn(name, type, nullable, semantics);
    }

    private CatalogRow catalogRow(ResultSet rs, int rowNumber) throws SQLException {
        return new CatalogRow(rs.getString("source_key"), rs.getString("connector_type"),
                rs.getString("connection_ref"), rs.getString("source_status"),
                rs.getString("dataset_key"), rs.getString("source_namespace"),
                rs.getString("source_relation"), rs.getArray("primary_key_columns"),
                rs.getObject("column_contract"), rs.getObject("cursor_spec"),
                rs.getString("delete_policy"), rs.getObject("delete_spec"),
                rs.getInt("schema_version"), rs.getString("dataset_status"),
                rs.getObject("metadata"), rs.getObject("committed_cursor"),
                rs.getString("last_successful_version_id"),
                rs.getTimestamp("cursor_updated_at") == null ? null
                        : rs.getTimestamp("cursor_updated_at").toInstant());
    }

    private static String requiredText(Map<String, Object> values, String key) {
        String value = optionalText(values, key);
        if (value == null) throw new IllegalArgumentException(key + " must not be blank");
        return value;
    }

    private static String optionalText(Map<String, Object> values, String key) {
        Object value = values.get(key);
        if (value == null) return null;
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException(key + " must be text");
        }
        return text;
    }

    private static List<String> stringList(Object value, String field) {
        if (value == null) return List.of();
        if (!(value instanceof List<?> list) || list.stream().anyMatch(item -> !(item instanceof String))) {
            throw new IllegalArgumentException(field + " must be a string array");
        }
        return list.stream().map(String.class::cast).toList();
    }

    private static <E extends Enum<E>> E status(Class<E> type, String value, String field) {
        try {
            return Enum.valueOf(type, value.toUpperCase(Locale.ROOT));
        } catch (RuntimeException error) {
            throw new IllegalArgumentException(field + " is invalid: " + value, error);
        }
    }

    private static BackendException catalogError(String code, String message, Throwable cause) {
        return cause == null ? new BackendException(code, message)
                : new BackendException(code, message, cause);
    }

    private record CatalogRow(String sourceKey, String connectorType, String connectionRef,
                              String sourceStatus, String datasetKey, String sourceNamespace,
                              String sourceRelation, java.sql.Array primaryKeyColumns,
                              Object columnContract, Object cursorSpec, String deletePolicy,
                              Object deleteSpec, int schemaVersion, String datasetStatus,
                              Object metadata, Object committedCursor,
                              String lastSuccessfulVersionId, Instant cursorUpdatedAt) {}
}
