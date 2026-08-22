package com.dip3.ontologyagent.graphsync;

import java.time.Instant;
import java.util.Map;

public record GraphSyncDirtyScope(String id, String scopeType, String scopeKey, String reason,
                                  String sourceName, String sourcePk, Map<String, Object> sourceProgress,
                                  Instant firstDetectedAt, Instant lastDetectedAt, String status,
                                  int attemptCount, String lastRunId, String errorSummary) {}
