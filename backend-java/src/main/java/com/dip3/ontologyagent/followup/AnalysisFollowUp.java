package com.dip3.ontologyagent.followup;

import java.time.Instant;
import java.util.Map;

public record AnalysisFollowUp(
        String id,
        String sessionId,
        String ownerUserId,
        String questionText,
        String parentFollowUpId,
        String referencedExecutionId,
        String referencedConclusionTitle,
        String referencedConclusionSummary,
        String resultExecutionId,
        String ontologyVersionId,
        Map<String, Object> ontologyVersionBinding,
        Map<String, Object> inheritedContext,
        Map<String, Object> mergedContext,
        Integer planVersion,
        Map<String, Object> currentPlanSnapshot,
        Map<String, Object> previousPlanSnapshot,
        Map<String, Object> currentPlanDiff,
        Instant createdAt,
        Instant updatedAt) {}
