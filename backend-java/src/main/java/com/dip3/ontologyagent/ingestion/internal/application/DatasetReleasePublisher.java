package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DataProductDefinition;
import com.dip3.ontologyagent.ingestion.api.DataProductInput;
import com.dip3.ontologyagent.ingestion.api.DataProductVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** Publishes one complete source-to-canonical release and freezes its product manifest. */
public final class DatasetReleasePublisher {
    private final SourceIngestionOrchestrator sourceIngestion;
    private final SourceCatalogPort sourceCatalog;
    private final ProductCatalogPort productCatalog;
    private final ProductMaterializer productMaterializer;
    private final IngestionPersistencePort persistence;

    public DatasetReleasePublisher(SourceIngestionOrchestrator sourceIngestion,
                                   SourceCatalogPort sourceCatalog,
                                   ProductCatalogPort productCatalog,
                                   ProductMaterializer productMaterializer,
                                   IngestionPersistencePort persistence) {
        this.sourceIngestion = Objects.requireNonNull(sourceIngestion, "sourceIngestion must not be null");
        this.sourceCatalog = Objects.requireNonNull(sourceCatalog, "sourceCatalog must not be null");
        this.productCatalog = Objects.requireNonNull(productCatalog, "productCatalog must not be null");
        this.productMaterializer = Objects.requireNonNull(productMaterializer,
                "productMaterializer must not be null");
        this.persistence = Objects.requireNonNull(persistence, "persistence must not be null");
    }

    public Result publish(Command command) {
        Objects.requireNonNull(command, "command must not be null");
        Map<String, ProductCatalogPort.ProductCatalog> registrations = new LinkedHashMap<>();
        for (String productKey : command.productKeys().stream().sorted().toList()) {
            registrations.put(productKey, productCatalog.loadActiveProduct(productKey));
        }
        String sourceRunId = id("source-run", command.publicationId(), command.sourceKey());
        SourceIngestionOrchestrator.Result source = sourceIngestion.ingest(
                new SourceIngestionOrchestrator.Command(sourceRunId, command.sourceKey(), command.mode(),
                        command.triggerType(), command.triggeredBy(), command.correlationId(),
                        command.pageSize()));
        Map<String, DatasetVersion> sourceVersions = indexSourceVersions(source.versions());
        Map<String, String> sourceHeads = new LinkedHashMap<>();
        sourceCatalog.loadActiveSource(command.sourceKey()).committedCursors().forEach(cursor -> {
            if (cursor.lastSuccessfulVersionId() != null) {
                sourceHeads.put(cursor.datasetKey(), cursor.lastSuccessfulVersionId());
            }
        });
        sourceVersions.forEach((datasetKey, version) -> sourceHeads.put(datasetKey, version.id()));
        Map<String, Map<String, String>> productInputs = new LinkedHashMap<>();
        registrations.forEach((productKey, registration) -> productInputs.put(
                productKey, resolveInputs(registration.product(), sourceHeads)));
        Map<String, DataProductVersion> products = new LinkedHashMap<>();
        ProductMaterializationRun.Mode productMode = ProductMaterializationRun.Mode.valueOf(
                command.mode().name());
        ProductMaterializationRun.TriggerType productTrigger =
                ProductMaterializationRun.TriggerType.valueOf(command.triggerType().name());
        for (String productKey : registrations.keySet()) {
            DataProductVersion product = productMaterializer.materialize(
                    new ProductMaterializer.Command(
                            id("product-run", command.publicationId(), productKey),
                            productKey,
                            id("product-version", command.publicationId(), productKey),
                            productMode,
                            productTrigger,
                            command.triggeredBy(),
                            command.correlationId(),
                            productInputs.get(productKey)));
            products.put(productKey, product);
        }
        Instant capturedAt = Instant.now();
        DatasetVersionSet versionSet = persistence.freezeVersionSet(
                new IngestionPersistencePort.VersionSetPublication(
                        command.publicationId(), products.entrySet().stream().collect(
                        LinkedHashMap::new,
                        (values, entry) -> values.put(entry.getKey(), entry.getValue().id()),
                        LinkedHashMap::putAll),
                        capturedAt,
                        command.triggeredBy() == null ? "system" : command.triggeredBy()));
        return new Result(source.runId(), sourceVersions, Map.copyOf(products), versionSet);
    }

    private static Map<String, DatasetVersion> indexSourceVersions(List<DatasetVersion> versions) {
        Map<String, DatasetVersion> indexed = new LinkedHashMap<>();
        for (DatasetVersion version : versions) {
            if (indexed.putIfAbsent(version.datasetKey(), version) != null) {
                throw new IllegalStateException("source release contains duplicate dataset version: "
                        + version.datasetKey());
            }
        }
        return Map.copyOf(indexed);
    }

    private static Map<String, String> resolveInputs(DataProductDefinition product,
                                                      Map<String, String> sourceVersionIds) {
        Map<String, String> inputs = new LinkedHashMap<>();
        for (DataProductInput input : product.inputs()) {
            String versionId = sourceVersionIds.get(input.datasetKey());
            if (versionId == null) {
                if (input.required()) {
                    throw new IllegalArgumentException("source release is missing required dataset: "
                            + input.datasetKey());
                }
                continue;
            }
            inputs.put(input.inputKey(), versionId);
        }
        return Map.copyOf(inputs);
    }

    private static String id(String kind, String publicationId, String key) {
        return UUID.nameUUIDFromBytes((kind + ":" + publicationId + ":" + key)
                .getBytes(StandardCharsets.UTF_8)).toString();
    }

    public record Command(String publicationId, String sourceKey, Set<String> productKeys,
                          IngestionRun.Mode mode, IngestionRun.TriggerType triggerType,
                          String triggeredBy, String correlationId, int pageSize) {
        public Command {
            if (publicationId == null || !publicationId.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) {
                throw new IllegalArgumentException("publicationId must be a restricted opaque id");
            }
            if (sourceKey == null || !sourceKey.matches("[a-z][a-z0-9_-]*")) {
                throw new IllegalArgumentException("sourceKey must be a restricted catalog key");
            }
            if (productKeys == null || productKeys.isEmpty() || productKeys.stream().anyMatch(key ->
                    key == null || !key.matches("[a-z][a-z0-9_-]*"))) {
                throw new IllegalArgumentException("productKeys must contain catalog keys");
            }
            productKeys = Set.copyOf(productKeys);
            if (mode == null) throw new IllegalArgumentException("mode must not be null");
            if (triggerType == null) throw new IllegalArgumentException("triggerType must not be null");
            if (triggeredBy != null && triggeredBy.isBlank()) {
                throw new IllegalArgumentException("triggeredBy must not be blank");
            }
            if (correlationId != null && correlationId.isBlank()) {
                throw new IllegalArgumentException("correlationId must not be blank");
            }
            if (pageSize <= 0 || pageSize > 10_000) {
                throw new IllegalArgumentException("pageSize must be between 1 and 10000");
            }
        }
    }

    public record Result(String sourceRunId, Map<String, DatasetVersion> sourceVersions,
                         Map<String, DataProductVersion> productVersions,
                         DatasetVersionSet versionSet) {
        public Result {
            sourceRunId = Objects.requireNonNull(sourceRunId, "sourceRunId must not be null");
            sourceVersions = Map.copyOf(sourceVersions);
            productVersions = Map.copyOf(productVersions);
            versionSet = Objects.requireNonNull(versionSet, "versionSet must not be null");
        }
    }
}
