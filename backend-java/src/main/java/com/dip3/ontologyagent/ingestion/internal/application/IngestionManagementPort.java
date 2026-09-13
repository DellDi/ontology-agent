package com.dip3.ontologyagent.ingestion.internal.application;

import java.time.Instant;
import java.util.List;

/** Read-only platform control-plane metadata. Never includes credentials or source row payloads. */
public interface IngestionManagementPort {
    Overview overview();

    record Overview(String scope, int runLimit, int releaseLimit, List<Source> sources,
                    List<Dataset> datasets, List<Product> products, List<Run> runs, List<Release> releases) {}
    record Source(String key, String connectorType, String status) {}
    record Dataset(String key, String sourceKey, String status, int schemaVersion) {}
    record Product(String key, String domainKey, String status, List<String> datasetKeys) {}
    record Run(String id, String kind, String targetKey, String mode, String status,
               String errorCode, String correlationId, Instant createdAt, Instant startedAt, Instant finishedAt) {}
    record Release(String id, String status, Instant capturedAt, List<ReleaseProduct> products) {}
    record ReleaseProduct(String key, String versionId, String status, long rowCount,
                          String runId, List<SourceVersion> sources) {}
    record SourceVersion(String datasetKey, String versionId, String runId) {}
}
