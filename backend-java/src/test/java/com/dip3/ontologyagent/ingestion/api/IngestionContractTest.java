package com.dip3.ontologyagent.ingestion.api;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IngestionContractTest {
    private static final Instant AT = Instant.parse("2026-09-04T00:00:00Z");

    @Test
    void sourceReferencesAreRestrictedKeysRatherThanConnectionStrings() {
        assertThrows(IllegalArgumentException.class,
                () -> new SourceDefinition("source-a", "postgres",
                        "jdbc:postgresql://db/app", SourceDefinition.Status.ACTIVE));
        assertThrows(IllegalArgumentException.class,
                () -> new SourceDefinition("source-a", "postgres",
                        "select * from secrets", SourceDefinition.Status.ACTIVE));
    }

    @Test
    void datasetDefinitionRequiresColumnsPrimaryKeyCursorAndTimeSemantics() {
        assertThrows(IllegalArgumentException.class,
                () -> dataset("dataset-a", List.of()));
        assertThrows(IllegalArgumentException.class,
                () -> new DatasetDefinition("dataset-a", "source-a", "public", "source_table",
                        columns(), List.of(), new DatasetDefinition.CursorSpec(
                                DatasetDefinition.CursorSpec.Strategy.SNAPSHOT, null, null),
                        DatasetDefinition.DeletePolicy.NONE, DatasetDefinition.DeletionSpec.none(), 1,
                        DatasetDefinition.Status.ACTIVE, Map.of()));
        assertThrows(IllegalArgumentException.class,
                () -> new DatasetDefinition("dataset-a", "source-a", "public", "source_table",
                        columnsWithoutTimeZoneSemantics(), List.of("id"), new DatasetDefinition.CursorSpec(
                                DatasetDefinition.CursorSpec.Strategy.WATERMARK, null, "id"),
                        DatasetDefinition.DeletePolicy.NONE, DatasetDefinition.DeletionSpec.none(), 1,
                        DatasetDefinition.Status.ACTIVE, Map.of()));
    }

    @Test
    void allTimestampWithoutTimeZoneColumnsCarryTheirOwnZoneId() {
        assertDoesNotThrow(() -> dataset("dataset-a", List.of("id")));
        DatasetDefinition.SourceColumn noZone = new DatasetDefinition.SourceColumn("created_at",
                DatasetDefinition.ColumnType.TIMESTAMP_WITHOUT_TIME_ZONE, false,
                new DatasetDefinition.TimeSemantics("created_at",
                        DatasetDefinition.TimeSemantics.Kind.TIMESTAMP_WITHOUT_TIME_ZONE,
                        ZoneId.of("UTC")));
        assertTrue(noZone.timeSemantics().zoneId().equals(ZoneId.of("UTC")));
        assertThrows(IllegalArgumentException.class, () -> new DatasetDefinition(
                "dataset-a", "source-a", "public", "source_table", List.of(
                        new DatasetDefinition.SourceColumn("created_at",
                                DatasetDefinition.ColumnType.TIMESTAMP_WITHOUT_TIME_ZONE, false,
                                DatasetDefinition.TimeSemantics.timestampWithoutTimeZone(
                                        "updated_at", ZoneId.of("UTC")))),
                List.of("created_at"), new DatasetDefinition.CursorSpec(
                        DatasetDefinition.CursorSpec.Strategy.SNAPSHOT, null, null),
                DatasetDefinition.DeletePolicy.NONE, DatasetDefinition.DeletionSpec.none(), 1,
                DatasetDefinition.Status.ACTIVE, Map.of()));
    }

    @Test
    void softDeleteRequiresAColumnAndDeletedValues() {
        assertThrows(IllegalArgumentException.class,
                () -> new DatasetDefinition("dataset-a", "source-a", "public",
                        "source_table", columns(), List.of("id"),
                        new DatasetDefinition.CursorSpec(
                                DatasetDefinition.CursorSpec.Strategy.SNAPSHOT, null, null),
                        DatasetDefinition.DeletePolicy.SOFT_DELETE,
                        DatasetDefinition.DeletionSpec.none(), 1,
                        DatasetDefinition.Status.ACTIVE, Map.of()));
        assertThrows(IllegalArgumentException.class,
                () -> new DatasetDefinition.DeletionSpec("deleted", List.of("true", "true")));
    }

    @Test
    void definitionsCopyCollectionValues() {
        List<String> keys = new ArrayList<>(List.of("id"));
        DatasetDefinition definition = new DatasetDefinition("dataset-a", "source-a", "public",
                "source_table", columns(), keys,
                new DatasetDefinition.CursorSpec(DatasetDefinition.CursorSpec.Strategy.SNAPSHOT,
                        null, null), DatasetDefinition.DeletePolicy.NONE,
                DatasetDefinition.DeletionSpec.none(), 1, DatasetDefinition.Status.ACTIVE, Map.of());

        keys.add("other");

        assertTrue(definition.primaryKeyColumns().equals(List.of("id")));
        assertThrows(UnsupportedOperationException.class,
                () -> definition.primaryKeyColumns().add("other"));
        assertThrows(UnsupportedOperationException.class,
                () -> definition.columnContract().add(new DatasetDefinition.SourceColumn(
                        "other", DatasetDefinition.ColumnType.STRING, true)));
    }

    @Test
    void buildingAndFailedVersionsMayWaitForStorage() {
        assertDoesNotThrow(() -> new DatasetVersion("source-version-a", "dataset-a", 1,
                DatasetVersion.Status.BUILDING, "run-a", null, Map.of(), Map.of(), null, 0,
                null, 1, null, AT));
        assertDoesNotThrow(() -> new DatasetVersion("0f9a2c", "dataset-a", 2,
                DatasetVersion.Status.BUILDING, "1f9a2c", null, Map.of(), Map.of(), null, 0,
                null, 1, null, AT));
        assertDoesNotThrow(() -> new DataProductVersion("product-version-a", "product-a", 1,
                DataProductVersion.Status.FAILED, "materialization-a", 1, null, 0,
                null, null, AT));
        assertThrows(IllegalArgumentException.class,
                () -> new DatasetVersion("source-version-a", "dataset-a", 1,
                        DatasetVersion.Status.PUBLISHED, "run-a", null, Map.of(), Map.of(), null, 0,
                        null, 1, AT.plusSeconds(1), AT));
        assertDoesNotThrow(() -> new DatasetVersion("source-version-a", "dataset-a", 1,
                DatasetVersion.Status.REVOKED, "run-a", null, Map.of("watermark", "1"),
                Map.of("position", "1"), "storage-a", 0, "hash-a", 1, AT.plusSeconds(1), AT));
        assertDoesNotThrow(() -> new DataProductVersion("product-version-a", "product-a", 1,
                DataProductVersion.Status.REVOKED, "materialization-a", 1,
                "storage-a", 0, "hash-a", AT.plusSeconds(1), AT));
        assertThrows(IllegalArgumentException.class, () -> new DatasetVersion(
                "source-version-a", "dataset-a", 1, DatasetVersion.Status.REVOKED, "run-a", null,
                Map.of("watermark", "1"), Map.of("position", "1"), null, 0, null, 1,
                AT.plusSeconds(1), AT));
        assertThrows(IllegalArgumentException.class, () -> new DataProductVersion(
                "product-version-a", "product-a", 1, DataProductVersion.Status.REVOKED,
                "materialization-a", 1, null, 0, null, AT.plusSeconds(1), AT));
        assertThrows(IllegalArgumentException.class,
                () -> new DataProductVersion("product-version-a", "product-a", 1,
                        DataProductVersion.Status.REVOKED, "materialization-a", 1,
                        null, 0, null, null, AT));
    }

    @Test
    void terminalRunAndCursorStateMustBeCoherent() {
        assertThrows(IllegalArgumentException.class,
                () -> new IngestionRun("run-a", "source-a", IngestionRun.Mode.FULL,
                        IngestionRun.Status.COMPLETED, IngestionRun.TriggerType.MANUAL,
                        null, null, Map.of(), Map.of(), null, Map.of(), AT, null, AT, AT));
        assertThrows(IllegalArgumentException.class,
                () -> new IngestionRun("run-a", "source-a", IngestionRun.Mode.FULL,
                        IngestionRun.Status.RUNNING, IngestionRun.TriggerType.MANUAL,
                        null, null, Map.of(), Map.of(), null, Map.of(), null, null, AT, AT));
        assertThrows(IllegalArgumentException.class,
                () -> new IngestionRun("run-a", "source-a", IngestionRun.Mode.FULL,
                        IngestionRun.Status.FAILED, IngestionRun.TriggerType.MANUAL,
                        null, null, Map.of(), Map.of(), null, Map.of(), AT,
                        AT.plusSeconds(1), AT, AT));
        assertThrows(IllegalArgumentException.class,
                () -> new IngestionCursor("dataset-a", Map.of("position", "1"), "", AT));
    }

    @Test
    void frozenManifestCarriesAuditTimesAndCreator() {
        assertDoesNotThrow(() -> new DatasetVersionSet("set-a", Map.of(),
                AT.plusSeconds(1), DatasetVersionSet.Status.DRAFT, null, AT, "operator-a"));
        assertThrows(IllegalArgumentException.class,
                () -> new DatasetVersionSet("set-a", Map.of(), AT,
                        DatasetVersionSet.Status.FROZEN, AT, AT.plusSeconds(1), "operator-a"));
        assertThrows(IllegalArgumentException.class,
                () -> new DatasetVersionSet("set-a", Map.of(), AT,
                        DatasetVersionSet.Status.DRAFT, null, AT.plusSeconds(1), "operator-a"));
    }

    private static DatasetDefinition dataset(String key, List<String> primaryKeyColumns) {
        return new DatasetDefinition(key, "source-a", "public", "source_table_" + key.replace('-', '_'),
                columns(), primaryKeyColumns,
                new DatasetDefinition.CursorSpec(DatasetDefinition.CursorSpec.Strategy.SNAPSHOT,
                        null, null), DatasetDefinition.DeletePolicy.NONE,
                DatasetDefinition.DeletionSpec.none(), 1, DatasetDefinition.Status.ACTIVE, Map.of());
    }

    private static List<DatasetDefinition.SourceColumn> columns() {
        return List.of(
                new DatasetDefinition.SourceColumn("id", DatasetDefinition.ColumnType.LONG, false),
                new DatasetDefinition.SourceColumn("created_at",
                        DatasetDefinition.ColumnType.TIMESTAMP_WITHOUT_TIME_ZONE, false,
                        DatasetDefinition.TimeSemantics.timestampWithoutTimeZone(
                                "created_at", ZoneId.of("Asia/Shanghai"))),
                new DatasetDefinition.SourceColumn("updated_at",
                        DatasetDefinition.ColumnType.TIMESTAMP_WITHOUT_TIME_ZONE, true,
                        DatasetDefinition.TimeSemantics.timestampWithoutTimeZone(
                                "updated_at", ZoneId.of("Asia/Shanghai"))),
                new DatasetDefinition.SourceColumn("observed_at",
                        DatasetDefinition.ColumnType.TIMESTAMPTZ, true,
                        DatasetDefinition.TimeSemantics.instant("observed_at")));
    }

    private static List<DatasetDefinition.SourceColumn> columnsWithoutTimeZoneSemantics() {
        return List.of(
                new DatasetDefinition.SourceColumn("id", DatasetDefinition.ColumnType.LONG, false),
                new DatasetDefinition.SourceColumn("created_at",
                        DatasetDefinition.ColumnType.TIMESTAMP_WITHOUT_TIME_ZONE, false),
                new DatasetDefinition.SourceColumn("updated_at",
                        DatasetDefinition.ColumnType.TIMESTAMP_WITHOUT_TIME_ZONE, true));
    }
}
