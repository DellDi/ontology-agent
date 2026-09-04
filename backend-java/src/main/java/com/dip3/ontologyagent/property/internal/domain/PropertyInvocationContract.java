package com.dip3.ontologyagent.property.internal.domain;

import com.dip3.ontologyagent.capability.api.CapabilityInvocationContract;

/** The single compile-time invocation contract for the Property capability. */
public final class PropertyInvocationContract {
    public static final String TOOL_NAME = "analysis_workflow";
    public static final CapabilityInvocationContract CONTRACT = new CapabilityInvocationContract(
            "workflow-tool", TOOL_NAME, 1, "Main Agent", "Workflow Tool", "workflowInvocations");

    private PropertyInvocationContract() {}
}
