package com.dip3.ontologyagent.ingestion.api;

import java.util.List;
import java.util.Map;

/** A versionable, typed canonical data product definition. */
public record DataProductDefinition(String productKey, String domainKey,
                                    String canonicalSchema, String canonicalRelation,
                                    String transformRef, int schemaVersion,
                                    Map<String, Object> freshnessPolicy, Status status,
                                    List<DataProductInput> inputs,
                                    Map<String, Object> metadata) {
    public DataProductDefinition {
        productKey = ValueChecks.catalogKey(productKey, "productKey");
        domainKey = ValueChecks.catalogKey(domainKey, "domainKey");
        canonicalSchema = ValueChecks.identifier(canonicalSchema, "canonicalSchema");
        canonicalRelation = ValueChecks.identifier(canonicalRelation, "canonicalRelation");
        transformRef = ValueChecks.catalogKey(transformRef, "transformRef");
        if (schemaVersion <= 0) throw new IllegalArgumentException("schemaVersion must be positive");
        freshnessPolicy = ValueChecks.objectMap(freshnessPolicy, "freshnessPolicy");
        if (status == null) throw new IllegalArgumentException("status must not be null");
        inputs = ValueChecks.list(inputs, "inputs");
        metadata = ValueChecks.objectMap(metadata, "metadata");
    }

    public enum Status {
        ACTIVE,
        DISABLED
    }
}
