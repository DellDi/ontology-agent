package com.dip3.ontologyagent.tooling;

import java.util.List;
import java.util.Map;

public record WorkflowResult(Map<String, Object> plan, List<Evidence> evidence,
                             String conclusion, List<GroundedConclusion.Claim> claims,
                             List<Map<String, Object>> renderBlocks) {}
