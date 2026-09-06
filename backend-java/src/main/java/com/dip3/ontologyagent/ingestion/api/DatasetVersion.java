package com.dip3.ontologyagent.ingestion.api;

import java.time.Instant;
import java.util.Map;

/** An immutable version of one source dataset produced by source ingestion. */
public record DatasetVersion(String id, String datasetKey, long versionNumber,
                             Status status, String ingestionRunId,
                             String parentVersionId,
                             Map<String, Object> sourceWatermark,
                             Map<String, Object> committedCursor,
                             String storageRef, long rowCount, String contentHash,
                             int schemaVersion, Instant publishedAt, Instant createdAt) {
    public DatasetVersion {
        id = ValueChecks.opaqueId(id, "id");
        datasetKey = ValueChecks.catalogKey(datasetKey, "datasetKey");
        if (versionNumber <= 0) throw new IllegalArgumentException("versionNumber must be positive");
        if (status == null) throw new IllegalArgumentException("status must not be null");
        ingestionRunId = ValueChecks.opaqueId(ingestionRunId, "ingestionRunId");
        parentVersionId = parentVersionId == null ? null
                : ValueChecks.opaqueId(parentVersionId, "parentVersionId");
        if (id.equals(parentVersionId)) {
            throw new IllegalArgumentException("parentVersionId must not equal id");
        }
        sourceWatermark = ValueChecks.objectMap(sourceWatermark, "sourceWatermark");
        committedCursor = ValueChecks.objectMap(committedCursor, "committedCursor");
        storageRef = storageRef == null ? null : ValueChecks.text(storageRef, "storageRef");
        if (rowCount < 0) throw new IllegalArgumentException("rowCount must not be negative");
        if (contentHash != null && contentHash.isBlank()) {
            throw new IllegalArgumentException("contentHash must not be blank when supplied");
        }
        if (schemaVersion <= 0) throw new IllegalArgumentException("schemaVersion must be positive");
        if (status == Status.PUBLISHED || status == Status.REVOKED) {
            if (publishedAt == null) {
                throw new IllegalArgumentException(
                        "publishedAt is required for published or revoked versions");
            }
            if (sourceWatermark.isEmpty()) {
                throw new IllegalArgumentException(
                        "published or revoked versions require a source watermark");
            }
            if (storageRef == null || contentHash == null || contentHash.isBlank()) {
                throw new IllegalArgumentException(
                        "published or revoked versions require storageRef and contentHash");
            }
        }
        if (createdAt == null) throw new IllegalArgumentException("createdAt must not be null");
        if (publishedAt != null && publishedAt.isBefore(createdAt)) {
            throw new IllegalArgumentException("publishedAt must not be before createdAt");
        }
    }

    public enum Status {
        BUILDING,
        PUBLISHED,
        FAILED,
        REVOKED
    }
}
