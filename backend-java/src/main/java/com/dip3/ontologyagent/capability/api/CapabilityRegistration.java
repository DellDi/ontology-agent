package com.dip3.ontologyagent.capability.api;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.tooling.WorkflowResult;

public interface CapabilityRegistration {
  CapabilityDescriptor descriptor();

  InitialCapabilityCandidate initialQuestionCandidate(String question);

  void validateInitialQuestion(String question);

  /**
   * Domain-owned follow-up behavior. Every registered capability declares its support explicitly.
   */
  FollowUpPolicy followUpPolicy();

  void validateCatalog(OntologyCatalog ontology);

  ResolvedScopeSnapshot resolveScope(AuthSession principal);

  void validateScope(ResolvedScopeSnapshot scope, AuthSession principal);

  WorkflowResult execute(CapabilityExecutionContext context);
}
