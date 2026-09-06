package com.dip3.ontologyagent.ingestion.api;

import java.time.Instant;
import java.util.Map;

/** One committed cursor per source dataset. */
public record IngestionCursor(String datasetKey, Map<String, Object> committedCursor,
                              String lastSuccessfulVersionId, Instant updatedAt) {
    public IngestionCursor {
        datasetKey = ValueChecks.catalogKey(datasetKey, "datasetKey");
        committedCursor = ValueChecks.objectMap(committedCursor, "committedCursor");
        lastSuccessfulVersionId = lastSuccessfulVersionId == null ? null
                : ValueChecks.opaqueId(lastSuccessfulVersionId,
                "lastSuccessfulVersionId");
        if (updatedAt == null) throw new IllegalArgumentException("updatedAt must not be null");
    }
}
