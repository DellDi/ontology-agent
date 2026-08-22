package com.dip3.ontologyagent.tooling;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

public record WorkflowRequest(String executionId, String sessionId, String ontologyVersionId,
                              String questionText,
                              String entityKey, String metricDefinitionKey, String metricVariantKey,
                              String timeSemanticKey, List<String> projectIds,
                              LocalDate from, LocalDate to, String leaseOwner,
                              String executionContract, String followUpId, String referencedExecutionId,
                              Map<String, Object> referencedConclusion, Map<String, Object> effectiveContext) {
    public WorkflowRequest(String executionId, String sessionId, String ontologyVersionId,
                           String entityKey, String metricDefinitionKey, String metricVariantKey,
                           String timeSemanticKey, List<String> projectIds,
                           LocalDate from, LocalDate to, String leaseOwner) {
        this(executionId, sessionId, ontologyVersionId, "兼容构造的分析问题", entityKey,
                metricDefinitionKey, metricVariantKey,
                timeSemanticKey, projectIds, from, to, leaseOwner,
                com.dip3.ontologyagent.execution.ExecutionRepository.EXECUTION_CONTRACT,
                null, null, Map.of(), Map.of());
    }

    public WorkflowRequest {
        effectiveContext = effectiveContext == null ? Map.of() : Map.copyOf(effectiveContext);
        referencedConclusion = referencedConclusion == null ? Map.of() : Map.copyOf(referencedConclusion);
        if (questionText == null || questionText.isBlank()) {
            throw new com.dip3.ontologyagent.support.BackendException(
                    "WORKFLOW_REQUEST_INVALID", "Workflow 缺少本轮问题。");
        }
        boolean followUp = com.dip3.ontologyagent.execution.ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT
                .equals(executionContract);
        if (!followUp && !referencedConclusion.isEmpty()
                || followUp && (!referencedConclusion.keySet().equals(java.util.Set.of("title", "summary"))
                || !(referencedConclusion.get("title") instanceof String title)
                || !(referencedConclusion.get("summary") instanceof String summary)
                || title.isBlank() && summary.isBlank())) {
            throw new com.dip3.ontologyagent.support.BackendException(
                    "WORKFLOW_REQUEST_INVALID", "Workflow 追问缺少受控的来源结论。");
        }
    }
}
