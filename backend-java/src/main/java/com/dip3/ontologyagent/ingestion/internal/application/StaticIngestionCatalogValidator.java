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

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Validates a complete two-stage registration without a database or source
 * connector. Source ingestion and product materialization remain separate
 * audit chains, and every published artifact must resolve through both.
 */
public final class StaticIngestionCatalogValidator {
    private StaticIngestionCatalogValidator() {}

    public static void validate(IngestionCatalog catalog) {
        if (catalog == null) throw new IllegalArgumentException("catalog must not be null");

        Map<String, SourceDefinition> sources = index(catalog.sources(), SourceDefinition::sourceKey,
                "source");
        Map<String, DatasetDefinition> datasets = index(catalog.datasets(), DatasetDefinition::datasetKey,
                "dataset");
        Map<String, DataProductDefinition> products = index(catalog.products(),
                DataProductDefinition::productKey, "product");
        Map<String, IngestionRun> ingestionRuns = index(catalog.ingestionRuns(), IngestionRun::id,
                "ingestion run");
        Map<String, DatasetVersion> datasetVersions = index(catalog.datasetVersions(), DatasetVersion::id,
                "dataset version");
        Map<String, IngestionCursor> cursors = index(catalog.cursors(), IngestionCursor::datasetKey,
                "ingestion cursor");
        Map<String, ProductMaterializationRun> materializationRuns = index(
                catalog.materializationRuns(), ProductMaterializationRun::id,
                "materialization run");
        Map<String, DataProductVersion> productVersions = index(catalog.productVersions(),
                DataProductVersion::id, "product version");
        Map<String, Lineage> lineages = index(catalog.lineages(), Lineage::id, "lineage");
        Map<String, DatasetVersionSet> versionSets = index(catalog.versionSets(),
                DatasetVersionSet::publicationId, "dataset version set");

        validateDatasets(datasets.values(), sources);
        validateProducts(products.values(), datasets);
        validateIngestionRuns(ingestionRuns.values(), sources);
        validateDatasetVersions(datasetVersions, datasets, ingestionRuns);
        validateCursors(cursors.values(), datasets, datasetVersions);
        validateMaterializationRuns(materializationRuns.values(), products, datasetVersions);
        validateProductVersions(productVersions.values(), products, materializationRuns);
        validateLineage(lineages.values(), datasets, products, datasetVersions,
                productVersions, materializationRuns);
        validateVersionSets(versionSets.values(), products, productVersions);
    }

    private static void validateDatasets(Iterable<DatasetDefinition> datasets,
                                         Map<String, SourceDefinition> sources) {
        Set<String> relations = new HashSet<>();
        for (DatasetDefinition dataset : datasets) {
            if (!sources.containsKey(dataset.sourceKey())) {
                fail("dataset " + dataset.datasetKey() + " references missing source "
                        + dataset.sourceKey());
            }
            String relation = dataset.sourceKey() + "\u0000" + dataset.sourceNamespace()
                    + "\u0000" + dataset.sourceRelation();
            if (!relations.add(relation)) {
                fail("duplicate source relation " + dataset.sourceNamespace() + "."
                        + dataset.sourceRelation());
            }
        }
    }

    private static void validateProducts(Iterable<DataProductDefinition> products,
                                         Map<String, DatasetDefinition> datasets) {
        Set<String> canonicalRelations = new HashSet<>();
        for (DataProductDefinition product : products) {
            if (product.inputs().isEmpty()) {
                fail("product " + product.productKey() + " must declare at least one input");
            }
            String canonicalRelation = product.canonicalSchema() + "\u0000"
                    + product.canonicalRelation();
            if (!canonicalRelations.add(canonicalRelation)) {
                fail("duplicate canonical relation " + product.canonicalSchema() + "."
                        + product.canonicalRelation());
            }
            Set<String> inputKeys = new HashSet<>();
            Set<Integer> ordinals = new HashSet<>();
            for (DataProductInput input : product.inputs()) {
                if (!inputKeys.add(input.inputKey())) {
                    fail("product " + product.productKey() + " contains duplicate input "
                            + input.inputKey());
                }
                if (!ordinals.add(input.ordinal())) {
                    fail("product " + product.productKey() + " contains duplicate input ordinal "
                            + input.ordinal());
                }
                if (!datasets.containsKey(input.datasetKey())) {
                    fail("product " + product.productKey() + " references missing dataset "
                            + input.datasetKey());
                }
            }
        }
    }

    private static void validateIngestionRuns(Iterable<IngestionRun> runs,
                                              Map<String, SourceDefinition> sources) {
        for (IngestionRun run : runs) {
            if (!sources.containsKey(run.sourceKey())) {
                fail("ingestion run " + run.id() + " references missing source "
                        + run.sourceKey());
            }
        }
    }

    private static void validateDatasetVersions(Map<String, DatasetVersion> datasetVersions,
                                                Map<String, DatasetDefinition> datasets,
                                                Map<String, IngestionRun> ingestionRuns) {
        Set<String> versionNumbers = new HashSet<>();
        Set<String> runDatasets = new HashSet<>();
        for (DatasetVersion version : datasetVersions.values()) {
            DatasetDefinition dataset = datasets.get(version.datasetKey());
            if (dataset == null) {
                fail("dataset version " + version.id() + " references missing dataset "
                        + version.datasetKey());
            }
            String number = version.datasetKey() + "\u0000" + version.versionNumber();
            if (!versionNumbers.add(number)) {
                fail("duplicate dataset version number " + version.datasetKey() + "/"
                        + version.versionNumber());
            }
            String runDataset = version.ingestionRunId() + "\u0000" + version.datasetKey();
            if (!runDatasets.add(runDataset)) {
                fail("duplicate dataset version for ingestion run " + version.ingestionRunId()
                        + " and dataset " + version.datasetKey());
            }
            IngestionRun run = ingestionRuns.get(version.ingestionRunId());
            if (run == null) {
                fail("dataset version " + version.id() + " references missing ingestion run "
                        + version.ingestionRunId());
            } else if (!dataset.sourceKey().equals(run.sourceKey())) {
                fail("dataset version " + version.id() + " dataset and ingestion source do not match");
            } else if (run.mode() == IngestionRun.Mode.INCREMENTAL) {
                DatasetVersion parent = datasetVersions.get(version.parentVersionId());
                if (parent == null || !version.datasetKey().equals(parent.datasetKey())
                        || parent.status() != DatasetVersion.Status.PUBLISHED
                        || parent.versionNumber() >= version.versionNumber()) {
                    fail("incremental dataset version " + version.id()
                            + " requires an earlier published parent from the same dataset");
                }
            } else if (version.parentVersionId() != null) {
                fail("full or reconcile dataset version " + version.id()
                        + " cannot reference a parent");
            }
            if (version.schemaVersion() != dataset.schemaVersion()) {
                fail("dataset version " + version.id() + " schema does not match dataset definition");
            }
            if (version.status() == DatasetVersion.Status.PUBLISHED) {
                if (run.status() != IngestionRun.Status.COMPLETED) {
                    fail("published dataset version " + version.id()
                            + " requires a completed ingestion run");
                }
                if (version.sourceWatermark().isEmpty()) {
                    fail("published dataset version " + version.id()
                            + " requires a source watermark");
                }
                if (version.storageRef() == null || version.storageRef().isBlank()) {
                    fail("published dataset version " + version.id() + " requires storageRef");
                }
                if (version.contentHash() == null || version.contentHash().isBlank()) {
                    fail("published dataset version " + version.id() + " requires contentHash");
                }
            }
        }
    }

    private static void validateCursors(Iterable<IngestionCursor> cursors,
                                        Map<String, DatasetDefinition> datasets,
                                        Map<String, DatasetVersion> datasetVersions) {
        for (IngestionCursor cursor : cursors) {
            if (!datasets.containsKey(cursor.datasetKey())) {
                fail("ingestion cursor references missing dataset " + cursor.datasetKey());
            }
            if (cursor.lastSuccessfulVersionId() == null) continue;
            DatasetVersion version = datasetVersions.get(cursor.lastSuccessfulVersionId());
            if (version == null) {
                fail("ingestion cursor " + cursor.datasetKey()
                        + " references missing successful version "
                        + cursor.lastSuccessfulVersionId());
            }
            if (!cursor.datasetKey().equals(version.datasetKey())) {
                fail("ingestion cursor " + cursor.datasetKey()
                        + " successful version dataset does not match cursor");
            }
            if (version.status() != DatasetVersion.Status.PUBLISHED) {
                fail("ingestion cursor " + cursor.datasetKey()
                        + " must reference a published version");
            }
        }
    }

    private static void validateMaterializationRuns(
            Iterable<ProductMaterializationRun> runs,
            Map<String, DataProductDefinition> products,
            Map<String, DatasetVersion> datasetVersions) {
        for (ProductMaterializationRun run : runs) {
            DataProductDefinition product = products.get(run.productKey());
            if (product == null) {
                fail("materialization run " + run.id() + " references missing product "
                        + run.productKey());
            }
            for (Map.Entry<String, String> entry : run.sourceDatasetVersionIds().entrySet()) {
                DataProductInput input = findInput(product, entry.getKey());
                if (input == null) {
                    fail("materialization run " + run.id() + " references missing product input "
                            + entry.getKey());
                }
                DatasetVersion version = datasetVersions.get(entry.getValue());
                if (version == null) {
                    fail("materialization run " + run.id()
                            + " references missing source dataset version " + entry.getValue());
                }
                if (!input.datasetKey().equals(version.datasetKey())) {
                    fail("materialization run " + run.id() + " input and source version do not match");
                }
                if (version.status() != DatasetVersion.Status.PUBLISHED) {
                    fail("materialization run " + run.id()
                            + " can only consume published source dataset versions");
                }
            }
            if (run.status() == ProductMaterializationRun.Status.COMPLETED) {
                for (DataProductInput input : product.inputs()) {
                    if (input.required() && !run.sourceDatasetVersionIds().containsKey(input.inputKey())) {
                        fail("completed materialization run " + run.id()
                                + " is missing required input " + input.inputKey());
                    }
                }
            }
        }
    }

    private static void validateProductVersions(Iterable<DataProductVersion> versions,
                                                Map<String, DataProductDefinition> products,
                                                Map<String, ProductMaterializationRun> runs) {
        Set<String> versionNumbers = new HashSet<>();
        Set<String> materializationRuns = new HashSet<>();
        for (DataProductVersion version : versions) {
            DataProductDefinition product = products.get(version.productKey());
            if (product == null) {
                fail("product version " + version.id() + " references missing product "
                        + version.productKey());
            }
            String number = version.productKey() + "\u0000" + version.versionNumber();
            if (!versionNumbers.add(number)) {
                fail("duplicate product version number " + version.productKey() + "/"
                        + version.versionNumber());
            }
            if (!materializationRuns.add(version.materializationRunId())) {
                fail("duplicate product version for materialization run "
                        + version.materializationRunId());
            }
            ProductMaterializationRun run = runs.get(version.materializationRunId());
            if (run == null) {
                fail("product version " + version.id()
                        + " references missing materialization run "
                        + version.materializationRunId());
            } else if (!version.productKey().equals(run.productKey())) {
                fail("product version " + version.id()
                        + " product and materialization run do not match");
            }
            if (version.schemaVersion() != product.schemaVersion()) {
                fail("product version " + version.id()
                        + " schema does not match product definition");
            }
            if (version.status() == DataProductVersion.Status.PUBLISHED) {
                if (run.status() != ProductMaterializationRun.Status.COMPLETED) {
                    fail("published product version " + version.id()
                            + " requires a completed materialization run");
                }
                if (version.storageRef() == null || version.storageRef().isBlank()) {
                    fail("published product version " + version.id() + " requires storageRef");
                }
                if (version.contentHash() == null || version.contentHash().isBlank()) {
                    fail("published product version " + version.id() + " requires contentHash");
                }
            }
        }
    }

    private static void validateLineage(Iterable<Lineage> lineages,
                                        Map<String, DatasetDefinition> datasets,
                                        Map<String, DataProductDefinition> products,
                                        Map<String, DatasetVersion> datasetVersions,
                                        Map<String, DataProductVersion> productVersions,
                                        Map<String, ProductMaterializationRun> materializationRuns) {
        Set<String> targetInputs = new HashSet<>();
        for (Lineage lineage : lineages) {
            DataProductVersion productVersion = productVersions.get(lineage.productVersionId());
            if (productVersion == null) {
                fail("lineage " + lineage.id() + " references missing product version "
                        + lineage.productVersionId());
            }
            if (!productVersion.productKey().equals(lineage.productKey())) {
                fail("lineage " + lineage.id() + " product does not match product version");
            }
            DataProductDefinition product = products.get(lineage.productKey());
            if (product == null) {
                fail("lineage " + lineage.id() + " references missing product "
                        + lineage.productKey());
            }
            DataProductInput input = findInput(product, lineage.inputKey());
            if (input == null) {
                fail("lineage " + lineage.id() + " references missing product input "
                        + lineage.inputKey());
            }
            DatasetDefinition sourceDataset = datasets.get(lineage.sourceDatasetKey());
            if (sourceDataset == null) {
                fail("lineage " + lineage.id() + " references missing source dataset "
                        + lineage.sourceDatasetKey());
            }
            if (!input.datasetKey().equals(lineage.sourceDatasetKey())) {
                fail("lineage " + lineage.id() + " source dataset does not match product input");
            }
            DatasetVersion sourceVersion = datasetVersions.get(lineage.sourceDatasetVersionId());
            if (sourceVersion == null) {
                fail("lineage " + lineage.id()
                        + " references missing source dataset version "
                        + lineage.sourceDatasetVersionId());
            }
            if (!sourceVersion.datasetKey().equals(lineage.sourceDatasetKey())) {
                fail("lineage " + lineage.id()
                        + " source dataset version does not match source dataset");
            }
            if (sourceVersion.status() != DatasetVersion.Status.PUBLISHED) {
                fail("lineage " + lineage.id() + " must reference a published source version");
            }
            if (!product.transformRef().equals(lineage.transformRef())) {
                fail("lineage " + lineage.id() + " transform does not match product definition");
            }
            ProductMaterializationRun run = materializationRuns.get(productVersion.materializationRunId());
            if (run == null) {
                fail("lineage " + lineage.id()
                        + " product version references missing materialization run");
            }
            String capturedVersion = run.sourceDatasetVersionIds().get(lineage.inputKey());
            if (!lineage.sourceDatasetVersionId().equals(capturedVersion)) {
                fail("lineage " + lineage.id()
                        + " source version does not match materialization input manifest");
            }
            String targetInput = lineage.productVersionId() + "\u0000" + lineage.inputKey();
            if (!targetInputs.add(targetInput)) {
                fail("duplicate lineage input " + lineage.productVersionId() + "/"
                        + lineage.inputKey());
            }
        }
        for (DataProductVersion version : productVersions.values()) {
            if (version.status() != DataProductVersion.Status.PUBLISHED) continue;
            DataProductDefinition product = products.get(version.productKey());
            for (DataProductInput input : product.inputs()) {
                if (input.required()
                        && !targetInputs.contains(version.id() + "\u0000" + input.inputKey())) {
                    fail("published product version " + version.id()
                            + " is missing lineage for required input " + input.inputKey());
                }
            }
        }
    }

    private static void validateVersionSets(Iterable<DatasetVersionSet> versionSets,
                                            Map<String, DataProductDefinition> products,
                                            Map<String, DataProductVersion> productVersions) {
        for (DatasetVersionSet versionSet : versionSets) {
            for (Map.Entry<String, String> entry : versionSet.productVersionIds().entrySet()) {
                if (!products.containsKey(entry.getKey())) {
                    fail("dataset version set " + versionSet.publicationId()
                            + " references missing product " + entry.getKey());
                }
                DataProductVersion version = productVersions.get(entry.getValue());
                if (version == null) {
                    fail("dataset version set " + versionSet.publicationId()
                            + " references missing product version " + entry.getValue());
                }
                if (!entry.getKey().equals(version.productKey())) {
                    fail("dataset version set " + versionSet.publicationId()
                            + " maps product " + entry.getKey() + " to a version of "
                            + version.productKey());
                }
                if (versionSet.status() == DatasetVersionSet.Status.FROZEN) {
                    if (version.status() != DataProductVersion.Status.PUBLISHED) {
                        fail("frozen dataset version set " + versionSet.publicationId()
                                + " can only pin PUBLISHED product versions");
                    }
                    if (version.publishedAt() != null
                            && versionSet.capturedAt().isBefore(version.publishedAt())) {
                        fail("frozen dataset version set " + versionSet.publicationId()
                                + " was captured before a pinned version was published");
                    }
                }
            }
            if (versionSet.status() == DatasetVersionSet.Status.FROZEN
                    && versionSet.productVersionIds().isEmpty()) {
                fail("frozen dataset version set " + versionSet.publicationId()
                        + " must not be empty");
            }
        }
    }

    private static DataProductInput findInput(DataProductDefinition product, String inputKey) {
        return product.inputs().stream()
                .filter(candidate -> candidate.inputKey().equals(inputKey))
                .findFirst()
                .orElse(null);
    }

    private static <T> Map<String, T> index(List<T> values, Function<T, String> key,
                                             String kind) {
        Map<String, T> indexed = new HashMap<>();
        for (T value : values) {
            if (value == null) fail(kind + " must not contain null");
            String identifier = key.apply(value);
            if (identifier == null || identifier.isBlank()) {
                fail(kind + " key must not be blank");
            }
            if (indexed.putIfAbsent(identifier, value) != null) {
                fail("duplicate " + kind + " key " + identifier);
            }
        }
        return indexed;
    }

    private static void fail(String message) {
        throw new IllegalArgumentException(message);
    }
}
