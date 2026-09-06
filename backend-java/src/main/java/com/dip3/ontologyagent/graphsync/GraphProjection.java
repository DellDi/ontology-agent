package com.dip3.ontologyagent.graphsync;

import java.util.Map;

/** Immutable canonical version binding for one rebuildable graph projection. */
public record GraphProjection(String datasetVersionSetId, Map<String, String> productVersionIds) {
    public GraphProjection {
        if (datasetVersionSetId == null || datasetVersionSetId.isBlank()) {
            throw new IllegalArgumentException("datasetVersionSetId must not be blank");
        }
        if (productVersionIds == null || productVersionIds.isEmpty()) {
            throw new IllegalArgumentException("productVersionIds must not be empty");
        }
        productVersionIds = Map.copyOf(productVersionIds);
    }
}
