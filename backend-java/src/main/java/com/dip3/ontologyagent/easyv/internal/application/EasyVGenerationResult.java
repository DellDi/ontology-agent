package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.util.List;
import java.util.Map;

public record EasyVGenerationResult(
    Map<String, Object> plan,
    List<Evidence> evidence,
    List<GroundedConclusion.Claim> claims,
    List<Map<String, Object>> renderBlocks) {
  public EasyVGenerationResult {
    plan = Map.copyOf(plan);
    evidence = List.copyOf(evidence);
    claims = List.copyOf(claims);
    renderBlocks = List.copyOf(renderBlocks);
  }

  public WorkflowResult toWorkflowResult() {
    String conclusion = claims.stream().map(GroundedConclusion.Claim::text).reduce((left, right) -> left + "\n\n" + right).orElse("");
    return new WorkflowResult(plan, evidence, conclusion, claims, renderBlocks);
  }
}
