package com.dip3.ontologyagent.ingestion.api;

import java.util.Map;

/** One named source dataset input to a canonical data product. */
public record DataProductInput(String inputKey, String datasetKey, int ordinal,
                               boolean required, Map<String, Object> mappingSpec,
                               Map<String, Object> metadata) {
    public DataProductInput {
        inputKey = ValueChecks.catalogKey(inputKey, "inputKey");
        datasetKey = ValueChecks.catalogKey(datasetKey, "datasetKey");
        if (ordinal < 0) throw new IllegalArgumentException("ordinal must not be negative");
        mappingSpec = ValueChecks.objectMap(mappingSpec, "mappingSpec");
        metadata = ValueChecks.objectMap(metadata, "metadata");
    }
}
