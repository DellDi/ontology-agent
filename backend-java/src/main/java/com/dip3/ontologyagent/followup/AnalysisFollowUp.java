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
        Map<String, Object> capabilityBinding,
        Map<String, Object> inheritedContext,
        Map<String, Object> mergedContext,
        Integer planVersion,
        Map<String, Object> currentPlanSnapshot,
        Map<String, Object> previousPlanSnapshot,
        Map<String, Object> currentPlanDiff,
        Instant createdAt,
        Instant updatedAt) {
    public AnalysisFollowUp(String id, String sessionId, String ownerUserId, String questionText,
                            String parentFollowUpId, String referencedExecutionId,
                            String referencedConclusionTitle, String referencedConclusionSummary,
                            String resultExecutionId, String ontologyVersionId,
                            Map<String, Object> ontologyVersionBinding,
                            Map<String, Object> inheritedContext, Map<String, Object> mergedContext,
                            Integer planVersion, Map<String, Object> currentPlanSnapshot,
                            Map<String, Object> previousPlanSnapshot, Map<String, Object> currentPlanDiff,
                            Instant createdAt, Instant updatedAt) {
        this(id, sessionId, ownerUserId, questionText, parentFollowUpId, referencedExecutionId,
                referencedConclusionTitle, referencedConclusionSummary, resultExecutionId, ontologyVersionId,
                ontologyVersionBinding,
                com.dip3.ontologyagent.capability.api.CapabilityBinding.legacySnapshot(), inheritedContext,
                mergedContext, planVersion, currentPlanSnapshot, previousPlanSnapshot, currentPlanDiff,
                createdAt, updatedAt);
    }

    public AnalysisFollowUp {
        capabilityBinding = capabilityBinding == null
                ? com.dip3.ontologyagent.capability.api.CapabilityBinding.legacySnapshot()
                : Map.copyOf(capabilityBinding);
    }
}
