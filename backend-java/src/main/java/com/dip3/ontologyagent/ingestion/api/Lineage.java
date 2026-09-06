package com.dip3.ontologyagent.ingestion.api;

import java.time.Instant;
import java.util.Map;

/** An auditable edge from one source dataset version to a product input. */
public record Lineage(String id, String productVersionId, String productKey,
                      String inputKey, String sourceDatasetVersionId,
                      String sourceDatasetKey, String transformRef,
                      Map<String, Object> metadata, Instant createdAt) {
    public Lineage {
        id = ValueChecks.opaqueId(id, "id");
        productVersionId = ValueChecks.opaqueId(productVersionId, "productVersionId");
        productKey = ValueChecks.catalogKey(productKey, "productKey");
        inputKey = ValueChecks.catalogKey(inputKey, "inputKey");
        sourceDatasetVersionId = ValueChecks.opaqueId(sourceDatasetVersionId,
                "sourceDatasetVersionId");
        sourceDatasetKey = ValueChecks.catalogKey(sourceDatasetKey, "sourceDatasetKey");
        transformRef = ValueChecks.catalogKey(transformRef, "transformRef");
        metadata = ValueChecks.objectMap(metadata, "metadata");
        if (createdAt == null) throw new IllegalArgumentException("createdAt must not be null");
    }
}
