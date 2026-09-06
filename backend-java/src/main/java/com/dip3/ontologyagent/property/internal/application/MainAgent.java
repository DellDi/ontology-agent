package com.dip3.ontologyagent.property.internal.application;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.tooling.WorkflowResult;

import java.util.Map;

public interface MainAgent {
    WorkflowResult execute(AuthSession owner, AgentTurn turn, String executionId,
                           OntologyCatalog ontology, String datasetVersionSetId,
                           String traceId, String leaseOwner);

    default WorkflowResult execute(AuthSession owner, AgentTurn turn, String executionId,
                                   OntologyCatalog ontology, String traceId, String leaseOwner) {
        return execute(owner, turn, executionId, ontology, null, traceId, leaseOwner);
    }

    default WorkflowResult execute(AuthSession owner, AnalysisSession session, String executionId,
                                   OntologyCatalog ontology, String traceId, String leaseOwner) {
        return execute(owner, new AgentTurn(
                com.dip3.ontologyagent.execution.ExecutionRepository.EXECUTION_CONTRACT,
                session.id(), session.questionText(), null, null, Map.of(), Map.of(), session.createdAt()),
                executionId, ontology, null, traceId, leaseOwner);
    }
}
