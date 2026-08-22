package com.dip3.ontologyagent.tooling;

import java.util.List;

public interface ConclusionProvider {
    GroundedConclusion conclude(WorkflowRequest request, List<Evidence> evidence);
}
