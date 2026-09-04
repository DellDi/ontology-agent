package com.dip3.ontologyagent.property.internal.application;

import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import java.util.List;

public interface ConclusionProvider {
    GroundedConclusion conclude(WorkflowRequest request, List<Evidence> evidence);
}
