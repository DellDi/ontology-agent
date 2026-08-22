package com.dip3.ontologyagent.execution;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record ExecutionEvent(String id, String sessionId, String executionId, long sequence, String kind,
                             Instant timestamp, String status, String message,
                             List<Map<String, Object>> renderBlocks, Map<String, Object> metadata,
                             String errorCode, String traceId) {
    public boolean terminal() {
        return "execution-status".equals(kind) && ("completed".equals(status) || "failed".equals(status));
    }
}
