package com.dip3.ontologyagent.capability.api;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.WorkflowResult;

public interface CapabilityRegistry {
  CapabilityId selectInitial(String question);

  CapabilityBinding bind(
      CapabilityId capabilityId, OntologyCatalog ontology, AuthSession principal);

  /**
   * Resolves follow-up behavior from the persisted binding, pinned ontology and trusted principal.
   */
  FollowUpPolicy requireFollowUpPolicy(
      CapabilityBinding binding, OntologyCatalog ontology, AuthSession principal);

  CapabilityDescriptor require(
      CapabilityBinding binding, OntologyCatalog ontology, AuthSession principal);

  CapabilityResult<WorkflowResult, Evidence> execute(
      CapabilityBinding binding, CapabilityExecutionContext context);

  void validateCatalog(OntologyCatalog ontology);

  /** Validates a pinned catalog for one capability without requiring unrelated domain packs. */
  default void validateCatalog(OntologyCatalog ontology, CapabilityId capabilityId) {
    validateCatalog(ontology);
  }
}
