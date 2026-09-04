package com.dip3.ontologyagent.easyv.internal.domain;

import com.dip3.ontologyagent.capability.api.CapabilityInvocationContract;

/** The single compile-time invocation contract for the EasyV read-only capability. */
public final class EasyVInvocationContract {
  public static final String TOOL_NAME = "easyv_generation_quality_analysis";
  public static final CapabilityInvocationContract CONTRACT =
      new CapabilityInvocationContract(
          "easyv-generation-quality-analysis",
          TOOL_NAME,
          1,
          "EasyV Main Agent",
          "EasyV Generation Quality Tool",
          "easyvWorkflowInvocations");

  private EasyVInvocationContract() {}
}
