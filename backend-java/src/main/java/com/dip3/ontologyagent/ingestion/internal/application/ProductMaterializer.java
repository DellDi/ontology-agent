package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DataProductInput;
import com.dip3.ontologyagent.ingestion.api.DataProductVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import com.dip3.ontologyagent.support.BackendException;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Materializes immutable source versions into one typed canonical data product version. */
public final class ProductMaterializer {
    private final ProductCatalogPort catalog;
    private final CanonicalProductTransformRegistry transforms;
    private final SourceBatchCodec codec;
    private final IngestionPersistencePort persistence;

    public ProductMaterializer(ProductCatalogPort catalog,
                               CanonicalProductTransformRegistry transforms,
                               SourceBatchCodec codec,
                               IngestionPersistencePort persistence) {
        this.catalog = Objects.requireNonNull(catalog, "catalog must not be null");
        this.transforms = Objects.requireNonNull(transforms, "transforms must not be null");
        this.codec = Objects.requireNonNull(codec, "codec must not be null");
        this.persistence = Objects.requireNonNull(persistence, "persistence must not be null");
        if (!IngestionPersistencePort.ROW_PACK_CODEC.equals(codec.codec())) {
            throw new IllegalArgumentException("source batch codec must be row-pack-v1");
        }
    }

    public DataProductVersion materialize(Command command) {
        Objects.requireNonNull(command, "command must not be null");
        ProductCatalogPort.ProductCatalog registration =
                catalog.loadActiveProduct(command.productKey());
        boolean runExists = false;
        String stage = "create-product-run";
        String currentInput = null;
        try {
            ProductMaterializationRun run = persistence.createProductRun(
                    new IngestionPersistencePort.ProductRunRequest(
                            command.runId(), command.productKey(), command.mode(),
                            command.triggerType(), command.triggeredBy(), command.correlationId(),
                            command.sourceVersionIds()));
            runExists = true;
            stage = "start-product-run";
            persistence.startProductRun(run.id());

            Map<String, CanonicalProductTransform.SourceInput> decoded = new LinkedHashMap<>();
            for (DataProductInput input : registration.product().inputs().stream()
                    .sorted(Comparator.comparingInt(DataProductInput::ordinal)).toList()) {
                currentInput = input.inputKey();
                String sourceVersionId = command.sourceVersionIds().get(input.inputKey());
                if (sourceVersionId == null) continue;
                DatasetDefinition dataset = registration.inputDatasets().get(input.inputKey());
                stage = "reconstruct-source-snapshot";
                List<SourceRow> rows = reconstruct(dataset, sourceVersionId);
                decoded.put(input.inputKey(), new CanonicalProductTransform.SourceInput(
                        input, dataset, sourceVersionId, rows));
            }

            currentInput = null;
            stage = "prepare-canonical-product";
            CanonicalProductTransform transform = transforms.require(
                    registration.product().transformRef());
            CanonicalProductTransform.PreparedProduct prepared = transform.prepare(
                    new CanonicalProductTransform.Context(registration.product(),
                            command.productVersionId(), decoded));
            stage = "publish-canonical-product";
            return persistence.publishProduct(new IngestionPersistencePort.ProductPublication(
                    command.runId(), command.productVersionId(), prepared.storageRef(),
                    prepared.rowCount(), prepared.contentHash(),
                    registration.product().schemaVersion()), prepared.canonicalWrite());
        } catch (RuntimeException error) {
            if (runExists) {
                try {
                    Map<String, Object> detail = new LinkedHashMap<>();
                    detail.put("stage", stage);
                    detail.put("productKey", command.productKey());
                    if (currentInput != null) detail.put("inputKey", currentInput);
                    persistence.failProductRun(command.runId(), failureCode(error), detail);
                } catch (RuntimeException auditError) {
                    error.addSuppressed(auditError);
                }
            }
            throw error;
        }
    }

    private List<SourceRow> reconstruct(DatasetDefinition dataset, String headVersionId) {
        List<IngestionPersistencePort.SourceVersionArtifact> chain =
                persistence.readPublishedSourceVersionChain(headVersionId);
        Map<List<Object>, SourceRow> rowsByPrimaryKey = new LinkedHashMap<>();
        Map<String, Integer> columnIndexes = new LinkedHashMap<>();
        for (int index = 0; index < dataset.columnContract().size(); index++) {
            columnIndexes.put(dataset.columnContract().get(index).name(), index);
        }
        List<Integer> primaryKeyIndexes = dataset.primaryKeyColumns().stream()
                .map(column -> {
                    Integer index = columnIndexes.get(column);
                    if (index == null) {
                        throw new IllegalArgumentException("primary key column is not declared: " + column);
                    }
                    return index;
                }).toList();

        for (IngestionPersistencePort.SourceVersionArtifact artifact : chain) {
            if (!dataset.datasetKey().equals(artifact.version().datasetKey())
                    || dataset.schemaVersion() != artifact.version().schemaVersion()) {
                throw new IllegalArgumentException(
                        "source version chain does not match dataset contract");
            }
            if (artifact.mode() != com.dip3.ontologyagent.ingestion.api.IngestionRun.Mode.INCREMENTAL) {
                rowsByPrimaryKey.clear();
            }
            java.util.Set<List<Object>> keysInVersion = new java.util.HashSet<>();
            for (IngestionPersistencePort.SourceBatch batch : artifact.batches()) {
                List<SourceRow> decodedBatch = codec.decode(dataset, batch.payload());
                if (decodedBatch.size() != batch.receipt().rowCount()) {
                    throw new IllegalArgumentException(
                            "decoded row count does not match batch receipt");
                }
                for (SourceRow row : decodedBatch) {
                    List<Object> key = primaryKeyIndexes.stream()
                            .map(index -> row.values().get(index)).toList();
                    if (key.stream().anyMatch(Objects::isNull) || !keysInVersion.add(key)) {
                        throw new IllegalArgumentException(
                                "source version contains a null or duplicate primary key");
                    }
                    rowsByPrimaryKey.put(key, row);
                }
            }
        }
        return List.copyOf(rowsByPrimaryKey.values());
    }

    private static String failureCode(RuntimeException error) {
        if (error instanceof BackendException backendError) return backendError.code();
        if (error instanceof IllegalArgumentException) return "PRODUCT_CONTRACT_INVALID";
        return "PRODUCT_MATERIALIZATION_FAILED";
    }

    public record Command(String runId, String productKey, String productVersionId,
                          ProductMaterializationRun.Mode mode,
                          ProductMaterializationRun.TriggerType triggerType,
                          String triggeredBy, String correlationId,
                          Map<String, String> sourceVersionIds) {
        public Command {
            requireId(runId, "runId");
            requireKey(productKey, "productKey");
            requireId(productVersionId, "productVersionId");
            if (mode == null) throw new IllegalArgumentException("mode must not be null");
            if (triggerType == null) throw new IllegalArgumentException("triggerType must not be null");
            if (triggeredBy != null && triggeredBy.isBlank()) {
                throw new IllegalArgumentException("triggeredBy must not be blank");
            }
            if (correlationId != null && correlationId.isBlank()) {
                throw new IllegalArgumentException("correlationId must not be blank");
            }
            if (sourceVersionIds == null || sourceVersionIds.entrySet().stream().anyMatch(entry ->
                    entry.getKey() == null || !entry.getKey().matches("[a-z][a-z0-9_-]*")
                            || entry.getValue() == null
                            || !entry.getValue().matches("[A-Za-z0-9][A-Za-z0-9._-]*"))) {
                throw new IllegalArgumentException("sourceVersionIds must contain valid entries");
            }
            sourceVersionIds = Map.copyOf(sourceVersionIds);
        }

        private static void requireId(String value, String field) {
            if (value == null || !value.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) {
                throw new IllegalArgumentException(field + " must be a restricted opaque id");
            }
        }

        private static void requireKey(String value, String field) {
            if (value == null || !value.matches("[a-z][a-z0-9_-]*")) {
                throw new IllegalArgumentException(field + " must be a restricted catalog key");
            }
        }
    }
}
