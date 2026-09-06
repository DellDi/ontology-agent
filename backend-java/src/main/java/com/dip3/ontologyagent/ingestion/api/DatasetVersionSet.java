package com.dip3.ontologyagent.ingestion.api;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** A persisted frozen manifest of canonical product versions. */
public record DatasetVersionSet(String publicationId, Map<String, String> productVersionIds,
                                Instant capturedAt, Status status, Instant frozenAt, Instant createdAt,
                                String createdBy) {
    public DatasetVersionSet {
        publicationId = ValueChecks.opaqueId(publicationId, "publicationId");
        if (productVersionIds == null) {
            throw new IllegalArgumentException("productVersionIds must not be null");
        }
        Map<String, String> copy = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : productVersionIds.entrySet()) {
            ValueChecks.catalogKey(entry.getKey(), "productVersionIds.productKey");
            ValueChecks.opaqueId(entry.getValue(), "productVersionIds.dataProductVersionId");
            copy.put(entry.getKey(), entry.getValue());
        }
        productVersionIds = Collections.unmodifiableMap(copy);
        if (capturedAt == null) throw new IllegalArgumentException("capturedAt must not be null");
        if (status == null) throw new IllegalArgumentException("status must not be null");
        if (status == Status.FROZEN && frozenAt == null) {
            throw new IllegalArgumentException("frozenAt is required for FROZEN manifests");
        }
        if (status == Status.REVOKED && frozenAt == null) {
            throw new IllegalArgumentException("frozenAt is required for REVOKED manifests");
        }
        if (createdAt == null) throw new IllegalArgumentException("createdAt must not be null");
        if (capturedAt.isBefore(createdAt)) {
            throw new IllegalArgumentException("capturedAt must not be before createdAt");
        }
        if (frozenAt != null && frozenAt.isBefore(capturedAt)) {
            throw new IllegalArgumentException("frozenAt must not be before capturedAt");
        }
        if (frozenAt != null && frozenAt.isBefore(createdAt)) {
            throw new IllegalArgumentException("frozenAt must not be before createdAt");
        }
        createdBy = ValueChecks.text(createdBy, "createdBy");
    }

    public enum Status {
        DRAFT,
        FROZEN,
        REVOKED
    }
}
