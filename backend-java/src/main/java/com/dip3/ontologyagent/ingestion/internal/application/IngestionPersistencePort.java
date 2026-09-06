package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DataProductVersion;
import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.DatasetVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Transaction boundary for the ingestion control plane.
 *
 * <p>The port exposes complete lifecycle operations rather than table-level
 * CRUD so callers cannot publish a version without its cursor or lineage.</p>
 */
public interface IngestionPersistencePort {
    /** The only durable source-batch codec supported by the P2 staging contract. */
    String ROW_PACK_CODEC = "row-pack-v1";

    /** Placeholder persisted before a source transaction snapshot is observed. */
    Map<String, Object> PLANNED_SOURCE_SNAPSHOT_CONTEXT = Map.of("phase", "planned");

    /**
     * Logical locator for a source version's immutable row-pack batches. The
     * adapter derives the value from the version id; callers never choose an
     * arbitrary table, URL, or filesystem path.
     */
    String SOURCE_VERSION_STORAGE_PREFIX = "ingestion://source-dataset-version/";

    IngestionRun createSourceRun(SourceRunRequest request);

    IngestionRun startSourceRun(String runId);

    /** Record the source transaction context after a running snapshot has been observed. */
    IngestionRun recordSourceSnapshotContext(String runId, Map<String, Object> snapshotContext);

    List<DatasetVersion> reserveSourceVersions(SourceVersionReservation reservation);

    SourceBatchReceipt appendSourceBatch(SourceBatchAppend batch);

    /** Read the immutable row-pack batches belonging to a published source version. */
    List<SourceBatch> readPublishedSourceBatches(String versionId);

    /**
     * Read the complete ancestry needed to reconstruct a published source snapshot.
     * The list is ordered from the full/reconcile base to the requested head version.
     */
    List<SourceVersionArtifact> readPublishedSourceVersionChain(String versionId);

    List<DatasetVersion> publishSourceSnapshot(SourcePublication publication);

    IngestionRun failSourceRun(String runId, String errorCode, Map<String, Object> errorDetail);

    ProductMaterializationRun createProductRun(ProductRunRequest request);

    ProductMaterializationRun startProductRun(String runId);

    DataProductVersion publishProduct(ProductPublication publication,
                                      CanonicalProductTransform.CanonicalWrite canonicalWrite);

    ProductMaterializationRun failProductRun(
            String runId, String errorCode, Map<String, Object> errorDetail);

    DatasetVersionSet freezeVersionSet(VersionSetPublication publication);

    record SourceRunRequest(String id, String sourceKey, IngestionRun.Mode mode,
                            IngestionRun.TriggerType triggerType, String triggeredBy,
                            String correlationId, Map<String, Object> snapshotContext) {
        public SourceRunRequest {
            snapshotContext = immutableObjectMap(snapshotContext, "snapshotContext");
        }
    }

    record SourceVersionReservation(String runId, List<SourceDatasetReservation> datasets) {
        public SourceVersionReservation {
            runId = opaqueId(runId, "runId");
            datasets = immutableList(datasets, "datasets");
            if (datasets.isEmpty()) throw new IllegalArgumentException("datasets must not be empty");
        }
    }

    record SourceDatasetReservation(String id, String datasetKey, String parentVersionId,
                                    Map<String, Object> sourceWatermark, int schemaVersion) {
        public SourceDatasetReservation {
            id = opaqueId(id, "id");
            datasetKey = catalogKey(datasetKey, "datasetKey");
            parentVersionId = parentVersionId == null ? null
                    : opaqueId(parentVersionId, "parentVersionId");
            if (id.equals(parentVersionId)) {
                throw new IllegalArgumentException("parentVersionId must not equal id");
            }
            sourceWatermark = immutableObjectMap(sourceWatermark, "sourceWatermark");
            if (sourceWatermark.isEmpty()) {
                throw new IllegalArgumentException("sourceWatermark must not be empty");
            }
            if (schemaVersion <= 0) {
                throw new IllegalArgumentException("schemaVersion must be positive");
            }
        }
    }

    /** One immutable row-pack append, keyed by (versionId, batchNumber) for retry. */
    record SourceBatchAppend(String versionId, long batchNumber, long rowCount, byte[] payload) {
        public SourceBatchAppend {
            versionId = opaqueId(versionId, "versionId");
            if (batchNumber <= 0) throw new IllegalArgumentException("batchNumber must be positive");
            if (rowCount < 0) throw new IllegalArgumentException("rowCount must not be negative");
            if (payload == null || payload.length == 0) {
                throw new IllegalArgumentException("payload must not be empty");
            }
            payload = payload.clone();
        }

        @Override
        public byte[] payload() {
            return payload.clone();
        }
    }

    record SourceBatchReceipt(String id, String versionId, long batchNumber, long rowCount,
                              String contentHash, String codec, Instant createdAt) {
        public SourceBatchReceipt {
            id = opaqueId(id, "id");
            versionId = opaqueId(versionId, "versionId");
            if (batchNumber <= 0) throw new IllegalArgumentException("batchNumber must be positive");
            if (rowCount < 0) throw new IllegalArgumentException("rowCount must not be negative");
            contentHash = sha256(contentHash, "contentHash");
            if (!ROW_PACK_CODEC.equals(codec)) {
                throw new IllegalArgumentException("codec must be " + ROW_PACK_CODEC);
            }
            if (createdAt == null) throw new IllegalArgumentException("createdAt must not be null");
        }
    }

    record SourcePublication(String runId, List<SourceDatasetPublication> datasets) {
        public SourcePublication {
            runId = opaqueId(runId, "runId");
            datasets = immutableList(datasets, "datasets");
            if (datasets.isEmpty()) throw new IllegalArgumentException("datasets must not be empty");
        }
    }

    /** One persisted source batch with a defensive copy of its row-pack bytes. */
    record SourceBatch(SourceBatchReceipt receipt, byte[] payload) {
        public SourceBatch {
            if (receipt == null) throw new IllegalArgumentException("receipt must not be null");
            if (payload == null || payload.length == 0) {
                throw new IllegalArgumentException("payload must not be empty");
            }
            payload = payload.clone();
        }

        @Override
        public byte[] payload() {
            return payload.clone();
        }
    }

    record SourceVersionArtifact(DatasetVersion version, IngestionRun.Mode mode,
                                 List<SourceBatch> batches) {
        public SourceVersionArtifact {
            if (version == null || version.status() != DatasetVersion.Status.PUBLISHED) {
                throw new IllegalArgumentException("version must be published");
            }
            if (mode == null) throw new IllegalArgumentException("mode must not be null");
            batches = immutableList(batches, "batches");
        }
    }

    record SourceDatasetPublication(String datasetKey, long expectedBatchCount,
                                    long expectedRowCount, String contentHash,
                                    Map<String, Object> committedCursor) {
        public SourceDatasetPublication {
            datasetKey = catalogKey(datasetKey, "datasetKey");
            if (expectedBatchCount < 0) {
                throw new IllegalArgumentException("expectedBatchCount must not be negative");
            }
            if (expectedRowCount < 0) {
                throw new IllegalArgumentException("expectedRowCount must not be negative");
            }
            contentHash = sha256(contentHash, "contentHash");
            committedCursor = immutableObjectMap(committedCursor, "committedCursor");
        }
    }

    /**
     * Keep source publication contracts strict at the port boundary. The
     * adapter uses this exact lowercase hexadecimal SHA-256 shape for both
     * batch hashes and the ordered aggregate hash.
     */
    private static String sha256(String value, String field) {
        if (value == null || !value.matches("[0-9a-f]{64}")) {
            throw new IllegalArgumentException(field + " must be a lowercase SHA-256 hex digest");
        }
        return value;
    }

    private static String opaqueId(String value, String field) {
        if (value == null || value.isBlank() || !value.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) {
            throw new IllegalArgumentException(field + " must be a restricted opaque id");
        }
        return value;
    }

    private static String catalogKey(String value, String field) {
        if (value == null || value.isBlank() || !value.matches("[a-z][a-z0-9_-]*")) {
            throw new IllegalArgumentException(field + " must be a restricted catalog key");
        }
        return value;
    }

    /* The remaining records describe product publication and frozen manifests. */
    record ProductRunRequest(String id, String productKey,
                             ProductMaterializationRun.Mode mode,
                             ProductMaterializationRun.TriggerType triggerType,
                             String triggeredBy, String correlationId,
                             Map<String, String> sourceDatasetVersionIds) {
        public ProductRunRequest {
            sourceDatasetVersionIds = immutableStringMap(
                    sourceDatasetVersionIds, "sourceDatasetVersionIds");
        }
    }

    record ProductPublication(String runId, String versionId, String storageRef,
                              long rowCount, String contentHash, int schemaVersion) {}

    record VersionSetPublication(String setId, Map<String, String> productVersionIds,
                                 Instant capturedAt, String createdBy) {
        public VersionSetPublication {
            productVersionIds = immutableStringMap(productVersionIds, "productVersionIds");
        }
    }

    private static Map<String, Object> immutableObjectMap(Map<String, Object> values, String field) {
        if (values == null || values.entrySet().stream().anyMatch(entry ->
                entry.getKey() == null || entry.getKey().isBlank() || entry.getValue() == null)) {
            throw new IllegalArgumentException(field + " must contain non-null entries");
        }
        return Map.copyOf(values);
    }

    private static Map<String, String> immutableStringMap(Map<String, String> values, String field) {
        if (values == null || values.entrySet().stream().anyMatch(entry ->
                entry.getKey() == null || entry.getKey().isBlank()
                        || entry.getValue() == null || entry.getValue().isBlank())) {
            throw new IllegalArgumentException(field + " must contain non-blank entries");
        }
        return Map.copyOf(values);
    }

    private static <T> List<T> immutableList(List<T> values, String field) {
        if (values == null || values.stream().anyMatch(value -> value == null)) {
            throw new IllegalArgumentException(field + " must not contain null");
        }
        return List.copyOf(values);
    }
}
