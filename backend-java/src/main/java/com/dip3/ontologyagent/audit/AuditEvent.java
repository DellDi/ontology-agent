package com.dip3.ontologyagent.audit;

import java.time.Instant;

public record AuditEvent(String id, String userId, String organizationId, String sessionId,
                         String eventType, String eventResult, String eventSource, String correlationId,
                         Object payload, Instant createdAt, Instant retentionUntil) {}
