package com.dip3.ontologyagent.execution;

import java.util.List;
import java.util.Map;

public record ExecutionJob(String executionId, String contract, String sessionId, String ownerUserId, String organizationId,
                           List<String> projectIds, List<String> areaIds, String questionText, String traceId,
                           String ontologyVersionId, String followUpId, String referencedExecutionId,
                           Map<String, Object> referencedConclusion, Map<String, Object> effectiveContext, String workerId,
                           int attemptCount, int maxAttempts) {
    public ExecutionJob(String executionId, String sessionId, String ownerUserId, String organizationId,
                        List<String> projectIds, List<String> areaIds, String questionText, String traceId,
                        String ontologyVersionId, String workerId, int attemptCount, int maxAttempts) {
        this(executionId, ExecutionRepository.EXECUTION_CONTRACT, sessionId, ownerUserId, organizationId,
                projectIds, areaIds, questionText, traceId, ontologyVersionId, null, null, Map.of(),
                Map.of(), workerId, attemptCount, maxAttempts);
    }
}
