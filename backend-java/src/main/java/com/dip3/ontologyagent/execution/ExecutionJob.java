package com.dip3.ontologyagent.execution;

import com.dip3.ontologyagent.capability.api.CapabilityBinding;

import java.util.Map;
import java.util.List;

public record ExecutionJob(String executionId, String contract, String sessionId, String ownerUserId, String organizationId,
                           List<String> projectIds, List<String> areaIds, String questionText, String traceId,
                           String ontologyVersionId, CapabilityBinding capabilityBinding,
                           String datasetVersionSetId,
                           String followUpId, String referencedExecutionId,
                           Map<String, Object> referencedConclusion, Map<String, Object> effectiveContext, String workerId,
                           int attemptCount, int maxAttempts) {
    public ExecutionJob(String executionId, String contract, String sessionId, String ownerUserId,
                        String organizationId, List<String> projectIds, List<String> areaIds,
                        String questionText, String traceId, String ontologyVersionId,
                        CapabilityBinding capabilityBinding, String followUpId,
                        String referencedExecutionId, Map<String, Object> referencedConclusion,
                        Map<String, Object> effectiveContext, String workerId,
                        int attemptCount, int maxAttempts) {
        this(executionId, contract, sessionId, ownerUserId, organizationId, projectIds, areaIds,
                questionText, traceId, ontologyVersionId, capabilityBinding, null, followUpId,
                referencedExecutionId, referencedConclusion, effectiveContext, workerId,
                attemptCount, maxAttempts);
    }
}
