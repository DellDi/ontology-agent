package com.dip3.ontologyagent.ontology;

import java.util.List;
import java.util.Map;

public final class OntologyToolBindingEntity {
    public String id;
    public String toolName;
    public String stepTemplateKey;
    public String capabilityTag;
    public List<Map<String, Object>> activationConditions;
    public Integer priority;
}
