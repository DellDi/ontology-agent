package com.dip3.ontologyagent.ontology;

import java.util.List;
import java.util.Map;

public record OntologyCatalog(String versionId, String semver, List<Item> entities, List<Item> metrics,
                              List<Item> metricVariants, List<Item> factors, List<Item> timeSemantics,
                              List<Item> planSteps, List<ToolBinding> toolBindings) {
    public record Item(String businessKey, String displayName, Map<String, Object> metadata) {}

    public record ToolBinding(String id, String toolName, String stepTemplateKey, String capabilityTag,
                              List<Map<String, Object>> activationConditions, int priority) {}
}
