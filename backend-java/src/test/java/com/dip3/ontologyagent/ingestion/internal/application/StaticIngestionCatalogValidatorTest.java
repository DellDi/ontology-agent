package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DataProductDefinition;
import com.dip3.ontologyagent.ingestion.api.DataProductInput;
import com.dip3.ontologyagent.ingestion.api.DataProductVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.DatasetVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.IngestionCursor;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.Lineage;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;
import com.dip3.ontologyagent.ingestion.api.SourceDefinition;
import com.dip3.ontologyagent.ingestion.internal.domain.IngestionCatalog;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class StaticIngestionCatalogValidatorTest {
    private static final Instant AT = Instant.parse("2026-09-04T00:00:00Z");

    @Test
    void acceptsACompleteTwoStageCatalog() {
        assertDoesNotThrow(() -> StaticIngestionCatalogValidator.validate(validCatalog()));
    }

    @Test
    void reusesTheSameContractAcrossIndependentDomains() {
        SourceDefinition sourceA = source("source-a");
        SourceDefinition sourceB = source("source-b");
        DatasetDefinition datasetA = dataset("dataset-a", "source-a");
        DatasetDefinition datasetB = dataset("dataset-b", "source-b");
        DataProductDefinition productA = product("product-a", "domain-a", "dataset-a");
        DataProductDefinition productB = product("product-b", "domain-b", "dataset-b");
        IngestionRun sourceRunA = sourceRun("source-run-a", "source-a");
        IngestionRun sourceRunB = sourceRun("source-run-b", "source-b");
        DatasetVersion sourceVersionA = sourceVersion("source-version-a", "dataset-a",
                "source-run-a", "storage-a", AT.plusSeconds(2));
        DatasetVersion sourceVersionB = sourceVersion("source-version-b", "dataset-b",
                "source-run-b", "storage-b", AT.plusSeconds(2));
        ProductMaterializationRun materializationA = materializationRun("materialization-a",
                "product-a", "input-a", "source-version-a");
        ProductMaterializationRun materializationB = materializationRun("materialization-b",
                "product-b", "input-a", "source-version-b");
        DataProductVersion productVersionA = productVersion("product-version-a", "product-a",
                "materialization-a", AT.plusSeconds(4));
        DataProductVersion productVersionB = productVersion("product-version-b", "product-b",
                "materialization-b", AT.plusSeconds(4));
        Lineage lineageA = lineage("lineage-a", "product-version-a", "product-a",
                "source-version-a", "dataset-a", "transform-product-a");
        Lineage lineageB = lineage("lineage-b", "product-version-b", "product-b",
                "source-version-b", "dataset-b", "transform-product-b");

        IngestionCatalog catalog = new IngestionCatalog(
                List.of(sourceA, sourceB), List.of(datasetA, datasetB), List.of(productA, productB),
                List.of(sourceRunA, sourceRunB), List.of(sourceVersionA, sourceVersionB),
                List.of(new IngestionCursor("dataset-a", Map.of("position", "a"),
                                "source-version-a", AT.plusSeconds(2)),
                        new IngestionCursor("dataset-b", Map.of("position", "b"),
                                "source-version-b", AT.plusSeconds(2))),
                List.of(materializationA, materializationB), List.of(productVersionA, productVersionB),
                List.of(lineageA, lineageB),
                List.of(new DatasetVersionSet("set-ab",
                        Map.of("product-a", "product-version-a", "product-b", "product-version-b"),
                        AT.plusSeconds(4), DatasetVersionSet.Status.FROZEN, AT.plusSeconds(5),
                        AT, "operator-a")));

        assertDoesNotThrow(() -> StaticIngestionCatalogValidator.validate(catalog));
    }

    @Test
    void rejectsDuplicateKeysAndSourceRunDatasetPairs() {
        IngestionCatalog base = validCatalog();
        List<SourceDefinition> sources = new ArrayList<>(base.sources());
        sources.add(source("source-a"));
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(new IngestionCatalog(
                        sources, base.datasets(), base.products(), base.ingestionRuns(),
                        base.datasetVersions(), base.cursors(), base.materializationRuns(),
                        base.productVersions(), base.lineages(), base.versionSets())));

        DatasetVersion duplicateDataset = sourceVersion("source-version-b", "dataset-a",
                "source-run-a", "storage-b", AT.plusSeconds(3));
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(new IngestionCatalog(
                        base.sources(), base.datasets(), base.products(), base.ingestionRuns(),
                        List.of(base.datasetVersions().getFirst(), duplicateDataset), base.cursors(),
                        base.materializationRuns(), base.productVersions(), base.lineages(),
                        base.versionSets())));
    }

    @Test
    void rejectsMissingDefinitionReferences() {
        DatasetDefinition missingSource = dataset("dataset-a", "source-missing");
        IngestionCatalog invalidSource = new IngestionCatalog(
                List.of(source("source-a")), List.of(missingSource), List.of(), List.of(),
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(invalidSource));

        IngestionCatalog invalidDataset = new IngestionCatalog(
                List.of(source("source-a")), List.of(dataset("dataset-a", "source-a")),
                List.of(product("product-a", "domain-a", "dataset-missing")), List.of(), List.of(),
                List.of(), List.of(), List.of(), List.of(), List.of());
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(invalidDataset));
    }

    @Test
    void rejectsProductsWithoutInputs() {
        DataProductDefinition product = new DataProductDefinition(
                "product-a", "domain-a", "canonical", "product_a", "transform-a", 1,
                Map.of(), DataProductDefinition.Status.ACTIVE, List.of(), Map.of());
        IngestionCatalog invalid = new IngestionCatalog(
                List.of(source("source-a")), List.of(dataset("dataset-a", "source-a")),
                List.of(product), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());

        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(invalid));
    }

    @Test
    void publishedSourceVersionRequiresCompletedRunAndCompleteArtifact() {
        IngestionCatalog base = validCatalog();
        IngestionRun running = new IngestionRun("source-run-a", "source-a", IngestionRun.Mode.FULL,
                IngestionRun.Status.RUNNING, IngestionRun.TriggerType.BOOTSTRAP,
                "operator-a", "trace-a", Map.of(), Map.of(), null, Map.of(), AT, null, AT, AT);
        IngestionCatalog invalidRun = replace(base, List.of(running), base.datasetVersions(),
                base.cursors(), base.materializationRuns(), base.productVersions(), base.lineages(),
                base.versionSets());
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(invalidRun));

        assertThrows(IllegalArgumentException.class,
                () -> new DatasetVersion("source-version-a", "dataset-a", 1,
                        DatasetVersion.Status.PUBLISHED, "source-run-a", null,
                        Map.of(), Map.of(), "storage-a", 1,
                        "hash-a", 1, AT.plusSeconds(2), AT));
    }

    @Test
    void publishedProductVersionRequiresCompletedMaterializationAndMatchingSchema() {
        IngestionCatalog base = validCatalog();
        ProductMaterializationRun running = new ProductMaterializationRun(
                "materialization-a", "product-a", ProductMaterializationRun.Mode.FULL,
                ProductMaterializationRun.Status.RUNNING,
                ProductMaterializationRun.TriggerType.MANUAL, "operator-a", "trace-a",
                Map.of("input-a", "source-version-a"), Map.of(), null, Map.of(), AT.plusSeconds(2),
                null, AT.plusSeconds(2), AT.plusSeconds(2));
        DataProductVersion version = productVersion("product-version-a", "product-a",
                "materialization-a", AT.plusSeconds(4));
        IngestionCatalog invalidRun = replace(base, base.ingestionRuns(), base.datasetVersions(),
                base.cursors(), List.of(running), List.of(version), base.lineages(), base.versionSets());
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(invalidRun));

        DataProductVersion wrongSchema = new DataProductVersion(
                "product-version-a", "product-a", 1, DataProductVersion.Status.PUBLISHED,
                "materialization-a", 2, "product-storage-a", 1, "product-hash-a",
                AT.plusSeconds(4), AT.plusSeconds(3));
        IngestionCatalog invalidSchema = replace(base, base.ingestionRuns(), base.datasetVersions(),
                base.cursors(), base.materializationRuns(), List.of(wrongSchema), base.lineages(),
                base.versionSets());
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(invalidSchema));
    }

    @Test
    void publishedProductVersionRequiresRequiredLineageAndMatchingInputManifest() {
        IngestionCatalog base = validCatalog();
        IngestionCatalog missingLineage = replace(base, base.ingestionRuns(), base.datasetVersions(),
                base.cursors(), base.materializationRuns(), base.productVersions(), List.of(),
                base.versionSets());
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(missingLineage));

        Lineage wrongTransform = lineage("lineage-a", "product-version-a", "product-a",
                "source-version-a", "dataset-a", "transform-other");
        IngestionCatalog invalidLineage = replace(base, base.ingestionRuns(), base.datasetVersions(),
                base.cursors(), base.materializationRuns(), base.productVersions(),
                List.of(wrongTransform), base.versionSets());
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(invalidLineage));
    }

    @Test
    void cursorMustReferenceTheSameDatasetPublishedVersion() {
        IngestionCatalog base = validCatalog();
        IngestionCatalog invalid = replace(base, base.ingestionRuns(), base.datasetVersions(),
                List.of(new IngestionCursor("dataset-b", Map.of(), "source-version-a", AT)),
                base.materializationRuns(), base.productVersions(), base.lineages(), base.versionSets());
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(invalid));
    }

    @Test
    void frozenManifestMustBeNonEmptyAndPinPublishedProductVersionsAfterPublication() {
        IngestionCatalog base = validCatalog();
        DatasetVersionSet empty = new DatasetVersionSet("set-empty", Map.of(), AT.plusSeconds(4),
                DatasetVersionSet.Status.FROZEN, AT.plusSeconds(5), AT, "operator-a");
        IngestionCatalog emptySet = replace(base, base.ingestionRuns(), base.datasetVersions(),
                base.cursors(), base.materializationRuns(), base.productVersions(), base.lineages(),
                List.of(empty));
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(emptySet));

        DataProductVersion building = new DataProductVersion(
                "product-version-a", "product-a", 1, DataProductVersion.Status.BUILDING,
                "materialization-a", 1, null, 0, null, null, AT.plusSeconds(3));
        DatasetVersionSet pinsBuilding = new DatasetVersionSet("set-building",
                Map.of("product-a", "product-version-a"), AT.plusSeconds(4),
                DatasetVersionSet.Status.FROZEN, AT.plusSeconds(5), AT, "operator-a");
        IngestionCatalog buildingSet = replace(base, base.ingestionRuns(), base.datasetVersions(),
                base.cursors(), base.materializationRuns(), List.of(building), base.lineages(),
                List.of(pinsBuilding));
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(buildingSet));

        DatasetVersionSet beforePublication = new DatasetVersionSet("set-before", Map.of(
                "product-a", "product-version-a"), AT.plusSeconds(3), DatasetVersionSet.Status.FROZEN,
                AT.plusSeconds(3), AT, "operator-a");
        IngestionCatalog timeInverted = replace(base, base.ingestionRuns(), base.datasetVersions(),
                base.cursors(), base.materializationRuns(), base.productVersions(), base.lineages(),
                List.of(beforePublication));
        assertThrows(IllegalArgumentException.class,
                () -> StaticIngestionCatalogValidator.validate(timeInverted));
    }

    private static IngestionCatalog validCatalog() {
        return new IngestionCatalog(
                List.of(source("source-a")), List.of(dataset("dataset-a", "source-a")),
                List.of(product("product-a", "domain-a", "dataset-a")),
                List.of(sourceRun("source-run-a", "source-a")),
                List.of(sourceVersion("source-version-a", "dataset-a", "source-run-a",
                        "storage-source-a", AT.plusSeconds(2))),
                List.of(new IngestionCursor("dataset-a", Map.of("position", "1"),
                        "source-version-a", AT.plusSeconds(2))),
                List.of(materializationRun("materialization-a", "product-a", "input-a",
                        "source-version-a")),
                List.of(productVersion("product-version-a", "product-a", "materialization-a",
                        AT.plusSeconds(4))),
                List.of(lineage("lineage-a", "product-version-a", "product-a",
                        "source-version-a", "dataset-a", "transform-product-a")),
                List.of(new DatasetVersionSet("set-a", Map.of("product-a", "product-version-a"),
                        AT.plusSeconds(4), DatasetVersionSet.Status.FROZEN, AT.plusSeconds(5),
                        AT, "operator-a")));
    }

    private static SourceDefinition source(String key) {
        return new SourceDefinition(key, "postgres", "connection-" + key, SourceDefinition.Status.ACTIVE);
    }

    private static DatasetDefinition dataset(String key, String sourceKey) {
        return new DatasetDefinition(key, sourceKey, "public", "source_table_" + key.replace('-', '_'),
                List.of(new DatasetDefinition.SourceColumn("id", DatasetDefinition.ColumnType.LONG, false),
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
                                DatasetDefinition.TimeSemantics.instant("observed_at"))),
                List.of("id"),
                new DatasetDefinition.CursorSpec(DatasetDefinition.CursorSpec.Strategy.WATERMARK,
                        "updated_at", "id"), DatasetDefinition.DeletePolicy.CDC,
                DatasetDefinition.DeletionSpec.none(),
                1, DatasetDefinition.Status.ACTIVE, Map.of());
    }

    private static DataProductDefinition product(String productKey, String domainKey,
                                                 String datasetKey) {
        return new DataProductDefinition(productKey, domainKey, "canonical",
                "product_" + productKey.replace('-', '_'), "transform-" + productKey, 1,
                Map.of(), DataProductDefinition.Status.ACTIVE,
                List.of(new DataProductInput("input-a", datasetKey, 0, true, Map.of(), Map.of())),
                Map.of());
    }

    private static IngestionRun sourceRun(String id, String sourceKey) {
        return new IngestionRun(id, sourceKey, IngestionRun.Mode.FULL,
                IngestionRun.Status.COMPLETED, IngestionRun.TriggerType.BOOTSTRAP,
                "operator-a", "trace-" + id, Map.of("snapshot", id),
                Map.of("rows", 1L), null, Map.of(), AT, AT.plusSeconds(1), AT, AT.plusSeconds(1));
    }

    private static DatasetVersion sourceVersion(String id, String datasetKey, String runId,
                                                String storageRef, Instant publishedAt) {
        return new DatasetVersion(id, datasetKey, 1, DatasetVersion.Status.PUBLISHED, runId,
                null, Map.of("watermark", id), Map.of("position", id), storageRef, 1,
                "hash-" + id, 1, publishedAt, AT);
    }

    private static ProductMaterializationRun materializationRun(String id, String productKey,
                                                                 String inputKey,
                                                                 String sourceVersionId) {
        return new ProductMaterializationRun(id, productKey,
                ProductMaterializationRun.Mode.INCREMENTAL,
                ProductMaterializationRun.Status.COMPLETED,
                ProductMaterializationRun.TriggerType.MANUAL, "operator-a", "trace-" + id,
                Map.of(inputKey, sourceVersionId), Map.of("rows", 1L), null, Map.of(),
                AT.plusSeconds(2), AT.plusSeconds(3), AT.plusSeconds(2), AT.plusSeconds(3));
    }

    private static DataProductVersion productVersion(String id, String productKey,
                                                     String materializationRunId,
                                                     Instant publishedAt) {
        return new DataProductVersion(id, productKey, 1, DataProductVersion.Status.PUBLISHED,
                materializationRunId, 1, "storage-" + id, 1, "hash-" + id, publishedAt,
                AT.plusSeconds(3));
    }

    private static Lineage lineage(String id, String productVersionId, String productKey,
                                   String sourceVersionId, String sourceDatasetKey,
                                   String transformRef) {
        return new Lineage(id, productVersionId, productKey, "input-a", sourceVersionId,
                sourceDatasetKey, transformRef, Map.of(), AT.plusSeconds(4));
    }

    private static IngestionCatalog replace(IngestionCatalog base,
                                            List<IngestionRun> ingestionRuns,
                                            List<DatasetVersion> datasetVersions,
                                            List<IngestionCursor> cursors,
                                            List<ProductMaterializationRun> materializationRuns,
                                            List<DataProductVersion> productVersions,
                                            List<Lineage> lineages,
                                            List<DatasetVersionSet> versionSets) {
        return new IngestionCatalog(base.sources(), base.datasets(), base.products(), ingestionRuns,
                datasetVersions, cursors, materializationRuns, productVersions, lineages, versionSets);
    }
}
