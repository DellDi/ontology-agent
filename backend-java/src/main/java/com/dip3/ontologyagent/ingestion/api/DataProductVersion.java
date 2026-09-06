package com.dip3.ontologyagent.ingestion.api;

import java.time.Instant;

/** An immutable canonical data product version produced by materialization. */
public record DataProductVersion(String id, String productKey, long versionNumber,
                                 Status status, String materializationRunId,
                                 int schemaVersion, String storageRef,
                                 long rowCount, String contentHash,
                                 Instant publishedAt, Instant createdAt) {
    public DataProductVersion {
        id = ValueChecks.opaqueId(id, "id");
        productKey = ValueChecks.catalogKey(productKey, "productKey");
        if (versionNumber <= 0) throw new IllegalArgumentException("versionNumber must be positive");
        if (status == null) throw new IllegalArgumentException("status must not be null");
        materializationRunId = ValueChecks.opaqueId(materializationRunId, "materializationRunId");
        if (schemaVersion <= 0) throw new IllegalArgumentException("schemaVersion must be positive");
        storageRef = storageRef == null ? null : ValueChecks.text(storageRef, "storageRef");
        if (rowCount < 0) throw new IllegalArgumentException("rowCount must not be negative");
        if (contentHash != null && contentHash.isBlank()) {
            throw new IllegalArgumentException("contentHash must not be blank when supplied");
        }
        if ((status == Status.PUBLISHED || status == Status.REVOKED)
                && publishedAt == null) {
            throw new IllegalArgumentException("publishedAt is required for published or revoked versions");
        }
        if (status == Status.PUBLISHED || status == Status.REVOKED) {
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
