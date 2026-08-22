package com.dip3.ontologyagent.graphsync;

import java.time.Instant;
import java.util.Map;

public record GraphSyncRun(String id, String mode, String status, String scopeType, String scopeKey,
                           String triggerType, String triggeredBy, Map<String, Object> cursorSnapshot,
                           int nodesWritten, int edgesWritten, String errorSummary,
                           Map<String, Object> errorDetail, Instant startedAt, Instant finishedAt,
                           Instant createdAt, Instant updatedAt) {}
