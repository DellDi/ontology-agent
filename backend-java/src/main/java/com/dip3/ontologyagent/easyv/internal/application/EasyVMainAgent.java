package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.tooling.WorkflowResult;

public interface EasyVMainAgent {
  WorkflowResult execute(
      AuthSession principal,
      AgentTurn turn,
      String executionId,
      OntologyCatalog ontology,
      String traceId,
      String leaseOwner);
}
