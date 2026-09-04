package com.dip3.ontologyagent.execution;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record ExecutionSnapshot(String executionId, String sessionId, String ownerUserId, String followUpId,
                                String ontologyVersionId, Map<String, Object> ontologyVersionBinding,
                                Map<String, Object> capabilityBinding,
                                String status, Map<String, Object> planSnapshot,
                                List<ExecutionEvent> stepResults, Map<String, Object> conclusionState,
                                List<Map<String, Object>> resultBlocks, Map<String, Object> mobileProjection,
                                Map<String, Object> failurePoint,
                                String errorCode, String traceId, Instant createdAt, Instant updatedAt) {
    public ExecutionSnapshot {
        capabilityBinding = capabilityBinding == null
                ? com.dip3.ontologyagent.capability.api.CapabilityBinding.legacySnapshot()
                : Map.copyOf(capabilityBinding);
    }
}
