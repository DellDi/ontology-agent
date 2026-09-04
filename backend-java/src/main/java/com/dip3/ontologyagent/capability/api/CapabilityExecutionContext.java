package com.dip3.ontologyagent.capability.api;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ontology.OntologyCatalog;

public record CapabilityExecutionContext(AuthSession principal, AgentTurn turn, String executionId,
                                         OntologyCatalog ontology, String traceId, String leaseOwner) {
    public CapabilityExecutionContext {
        if (principal == null) throw new IllegalArgumentException("principal must not be null");
        if (turn == null) throw new IllegalArgumentException("turn must not be null");
        if (ontology == null) throw new IllegalArgumentException("ontology must not be null");
        executionId = requireText(executionId, "executionId");
        traceId = requireText(traceId, "traceId");
        leaseOwner = requireText(leaseOwner, "leaseOwner");
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " must not be blank");
        return value;
    }
}
