package com.dip3.ontologyagent.tooling;

import com.dip3.ontologyagent.auth.AuthSession;

public interface EvidenceProvider {
    Evidence collect(AuthSession owner, WorkflowRequest request);
}
