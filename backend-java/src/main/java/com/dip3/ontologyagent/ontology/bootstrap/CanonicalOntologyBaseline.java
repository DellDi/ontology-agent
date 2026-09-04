package com.dip3.ontologyagent.ontology.bootstrap;

import java.util.LinkedHashMap;
import java.util.Map;

final class CanonicalOntologyBaseline {
    static final String LEGACY_VERSION_ID = "ontology-java-baseline-v1";
    static final String LEGACY_SEMVER = "1.0.0";
    static final String VERSION_ID = "ontology-java-multidomain-v2";
    static final String SEMVER = "2.0.0";

    private CanonicalOntologyBaseline() {}

    static Map<String, Long> minimumCounts() {
        Map<String, Long> counts = new LinkedHashMap<>();
        counts.put("entities", 6L);
        counts.put("metrics", 11L);
        counts.put("metricVariants", 18L);
        counts.put("factors", 1L);
        counts.put("causalityEdges", 1L);
        counts.put("planStepTemplates", 8L);
        counts.put("toolBindings", 8L);
        counts.put("timeSemantics", 3L);
        counts.put("evidenceTypes", 10L);
        return Map.copyOf(counts);
    }

    static Map<String, Long> legacyMinimumCounts() {
        Map<String, Long> counts = new LinkedHashMap<>();
        counts.put("entities", 1L);
        counts.put("metrics", 1L);
        counts.put("metricVariants", 3L);
        counts.put("factors", 1L);
        counts.put("causalityEdges", 1L);
        counts.put("planStepTemplates", 4L);
        counts.put("toolBindings", 4L);
        counts.put("timeSemantics", 2L);
        counts.put("evidenceTypes", 4L);
        return Map.copyOf(counts);
    }
}
