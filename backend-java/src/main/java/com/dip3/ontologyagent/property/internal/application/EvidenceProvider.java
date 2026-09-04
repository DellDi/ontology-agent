package com.dip3.ontologyagent.property.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import com.dip3.ontologyagent.tooling.Evidence;

public interface EvidenceProvider {
    Evidence collect(AuthSession owner, WorkflowRequest request);
}
