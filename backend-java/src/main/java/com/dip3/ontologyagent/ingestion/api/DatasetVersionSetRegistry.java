package com.dip3.ontologyagent.ingestion.api;

import java.util.Optional;
import java.util.Set;

/** Read boundary for complete, frozen canonical product manifests. */
public interface DatasetVersionSetRegistry {
    Optional<DatasetVersionSet> latestFrozen(Set<String> requiredProductKeys);

    DatasetVersionSet requireFrozen(String setId, Set<String> requiredProductKeys);
}
