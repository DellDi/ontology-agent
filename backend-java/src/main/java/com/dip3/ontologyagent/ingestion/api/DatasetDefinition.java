package com.dip3.ontologyagent.ingestion.api;

import java.time.ZoneId;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The governed contract for one source dataset. It describes the source
 * relation, its actual column contract, cursor, and deletion policy without
 * carrying executable SQL or connector settings.
 */
public record DatasetDefinition(String datasetKey, String sourceKey,
                                String sourceNamespace, String sourceRelation,
                                List<SourceColumn> columnContract,
                                List<String> primaryKeyColumns,
                                CursorSpec cursorSpec, DeletePolicy deletePolicy,
                                DeletionSpec deleteSpec, int schemaVersion,
                                Status status, Map<String, Object> metadata) {
    public DatasetDefinition {
        datasetKey = ValueChecks.catalogKey(datasetKey, "datasetKey");
        sourceKey = ValueChecks.catalogKey(sourceKey, "sourceKey");
        sourceNamespace = ValueChecks.identifier(sourceNamespace, "sourceNamespace");
        sourceRelation = ValueChecks.identifier(sourceRelation, "sourceRelation");
        columnContract = ValueChecks.list(columnContract, "columnContract");
        if (columnContract.isEmpty()) {
            throw new IllegalArgumentException("columnContract must not be empty");
        }
        Map<String, SourceColumn> columnsByName = new HashMap<>();
        for (SourceColumn column : columnContract) {
            if (columnsByName.putIfAbsent(column.name(), column) != null) {
                throw new IllegalArgumentException("columnContract must be unique");
            }
            if (column.timeSemantics() != null
                    && !column.name().equals(column.timeSemantics().column())) {
                throw new IllegalArgumentException("time semantic column does not match source column: "
                        + column.name());
            }
            if (column.type() == ColumnType.TIMESTAMP_WITHOUT_TIME_ZONE
                    && (column.timeSemantics() == null
                    || column.timeSemantics().kind() != TimeSemantics.Kind.TIMESTAMP_WITHOUT_TIME_ZONE
                    || column.timeSemantics().zoneId() == null)) {
                throw new IllegalArgumentException(
                        "timestamp without time zone column requires ZoneId: " + column.name());
            }
            if (column.timeSemantics() != null
                    && !column.timeSemantics().accepts(column.type())) {
                throw new IllegalArgumentException("time semantic does not match source column type: "
                        + column.name());
            }
        }
        primaryKeyColumns = ValueChecks.uniqueIdentifierList(primaryKeyColumns, "primaryKeyColumns");
        if (primaryKeyColumns.isEmpty()) {
            throw new IllegalArgumentException("primaryKeyColumns must not be empty");
        }
        for (String primaryKeyColumn : primaryKeyColumns) {
            SourceColumn column = columnsByName.get(primaryKeyColumn);
            if (column == null) {
                throw new IllegalArgumentException("primary key column is not declared: " + primaryKeyColumn);
            }
            if (column.nullable()) {
                throw new IllegalArgumentException("primary key column must be non-nullable: " + primaryKeyColumn);
            }
        }
        if (cursorSpec == null) throw new IllegalArgumentException("cursorSpec must not be null");
        if (deletePolicy == null) throw new IllegalArgumentException("deletePolicy must not be null");
        if (deleteSpec == null) throw new IllegalArgumentException("deleteSpec must not be null");
        validateCursorColumns(cursorSpec, columnsByName);
        validateDeleteSpec(deletePolicy, deleteSpec, columnsByName);
        if (schemaVersion <= 0) throw new IllegalArgumentException("schemaVersion must be positive");
        if (status == null) throw new IllegalArgumentException("status must not be null");
        metadata = ValueChecks.objectMap(metadata, "metadata");
    }

    private static void validateCursorColumns(CursorSpec cursorSpec,
                                              Map<String, SourceColumn> columnsByName) {
        if (cursorSpec.watermarkColumn() != null
                && !columnsByName.containsKey(cursorSpec.watermarkColumn())) {
            throw new IllegalArgumentException("cursor watermark column is not declared: "
                    + cursorSpec.watermarkColumn());
        }
        if (cursorSpec.tieBreakerColumn() != null
                && !columnsByName.containsKey(cursorSpec.tieBreakerColumn())) {
            throw new IllegalArgumentException("cursor tie breaker column is not declared: "
                    + cursorSpec.tieBreakerColumn());
        }
    }

    private static void validateDeleteSpec(DeletePolicy policy, DeletionSpec spec,
                                           Map<String, SourceColumn> columnsByName) {
        if (spec.column() != null && !columnsByName.containsKey(spec.column())) {
            throw new IllegalArgumentException("deletion column is not declared: " + spec.column());
        }
        if (policy == DeletePolicy.SOFT_DELETE) {
            if (spec.column() == null) {
                throw new IllegalArgumentException("deletion column is required for SOFT_DELETE");
            }
            if (spec.deletedValues().isEmpty()) {
                throw new IllegalArgumentException("deletedValues are required for SOFT_DELETE");
            }
        } else if (spec.column() != null || !spec.deletedValues().isEmpty()) {
            throw new IllegalArgumentException(
                    "only SOFT_DELETE may declare a deletion column or deleted values");
        }
    }

    /** One column in the actual source relation contract. */
    public record SourceColumn(String name, ColumnType type, boolean nullable,
                               TimeSemantics timeSemantics) {
        public SourceColumn {
            name = ValueChecks.identifier(name, "sourceColumn.name");
            if (type == null) throw new IllegalArgumentException("sourceColumn.type must not be null");
        }

        public SourceColumn(String name, ColumnType type, boolean nullable) {
            this(name, type, nullable, null);
        }
    }

    /** Types needed to validate source time semantics without leaking JDBC details. */
    public enum ColumnType {
        STRING,
        INTEGER,
        LONG,
        DECIMAL,
        BOOLEAN,
        DATE,
        TIMESTAMP_WITHOUT_TIME_ZONE,
        TIMESTAMPTZ,
        INSTANT,
        JSON,
        UUID
    }

    /** Declarative cursor shape persisted as the dataset's cursor_spec object. */
    public record CursorSpec(Strategy strategy, String watermarkColumn,
                             String tieBreakerColumn) {
        public CursorSpec {
            if (strategy == null) throw new IllegalArgumentException("cursor strategy must not be null");
            watermarkColumn = ValueChecks.nullableIdentifier(watermarkColumn, "watermarkColumn");
            tieBreakerColumn = ValueChecks.nullableIdentifier(tieBreakerColumn, "tieBreakerColumn");
            if (strategy == Strategy.WATERMARK && watermarkColumn == null) {
                throw new IllegalArgumentException("watermarkColumn is required for WATERMARK cursor");
            }
        }

        public enum Strategy {
            NONE,
            WATERMARK,
            SNAPSHOT,
            RECONCILE
        }
    }

    /** Values correspond to the V5 delete_policy values. */
    public enum DeletePolicy {
        NONE,
        SOFT_DELETE,
        SNAPSHOT_DIFF,
        CDC
    }

    /** Declarative details stored with the delete policy's delete_spec object. */
    public record DeletionSpec(String column, List<String> deletedValues) {
        public DeletionSpec {
            column = ValueChecks.nullableIdentifier(column, "deletion column");
            deletedValues = ValueChecks.list(deletedValues, "deletedValues");
            Set<String> uniqueValues = new HashSet<>();
            for (String deletedValue : deletedValues) {
                ValueChecks.text(deletedValue, "deletedValues value");
                if (!uniqueValues.add(deletedValue)) {
                    throw new IllegalArgumentException("deletedValues must be unique");
                }
            }
        }

        public static DeletionSpec none() {
            return new DeletionSpec(null, List.of());
        }

        public static DeletionSpec softDelete(String column, List<String> deletedValues) {
            return new DeletionSpec(column, deletedValues);
        }
    }

    /**
     * Time interpretation for a source column. A timestamp without time zone
     * must name the zone used to interpret it; TIMESTAMPTZ/INSTANT represents
     * an absolute instant and therefore has no ZoneId.
     */
    public record TimeSemantics(String column, Kind kind, ZoneId zoneId) {
        public TimeSemantics {
            column = ValueChecks.identifier(column, "timeSemantics.column");
            if (kind == null) throw new IllegalArgumentException("timeSemantics.kind must not be null");
            if (kind == Kind.TIMESTAMP_WITHOUT_TIME_ZONE && zoneId == null) {
                throw new IllegalArgumentException(
                        "zoneId is required for TIMESTAMP_WITHOUT_TIME_ZONE");
            }
            if (kind != Kind.TIMESTAMP_WITHOUT_TIME_ZONE && zoneId != null) {
                throw new IllegalArgumentException("zoneId is only valid for timestamp without time zone");
            }
        }

        boolean accepts(ColumnType columnType) {
            return switch (kind) {
                case TIMESTAMP_WITHOUT_TIME_ZONE -> columnType == ColumnType.TIMESTAMP_WITHOUT_TIME_ZONE;
                case TIMESTAMPTZ, INSTANT -> columnType == ColumnType.TIMESTAMPTZ
                        || columnType == ColumnType.INSTANT;
            };
        }

        public static TimeSemantics timestampWithoutTimeZone(String column, ZoneId zoneId) {
            return new TimeSemantics(column, Kind.TIMESTAMP_WITHOUT_TIME_ZONE, zoneId);
        }

        public static TimeSemantics timestamptz(String column) {
            return new TimeSemantics(column, Kind.TIMESTAMPTZ, null);
        }

        public static TimeSemantics instant(String column) {
            return new TimeSemantics(column, Kind.INSTANT, null);
        }

        public enum Kind {
            TIMESTAMP_WITHOUT_TIME_ZONE,
            TIMESTAMPTZ,
            INSTANT
        }
    }

    public enum Status {
        ACTIVE,
        DISABLED
    }
}
