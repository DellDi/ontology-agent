package com.dip3.ontologyagent.ontology.bootstrap;

import java.util.LinkedHashMap;
import java.util.Map;

final class CanonicalOntologyBaseline {
    static final String VERSION_ID = "ontology-java-baseline-v1";
    static final String SEMVER = "1.0.0";

    private CanonicalOntologyBaseline() {}

    static Map<String, Long> minimumCounts() {
        Map<String, Long> counts = new LinkedHashMap<>();
        counts.put("entities", 1L);
        counts.put("metrics", 1L);
        counts.put("metricVariants", 3L);
        counts.put("factors", 1L);
        counts.put("causalityEdges", 1L);
        counts.put("planStepTemplates", 4L);
        counts.put("toolBindings", 4L);
        counts.put("timeSemantics", 2L);
        counts.put("evidenceTypes", 1L);
        return Map.copyOf(counts);
    }
}
