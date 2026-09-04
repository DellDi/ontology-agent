package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.followup.AnalysisFollowUp;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record AnalysisSessionAggregate(SessionView session, List<AnalysisFollowUp> followUps,
                                       List<HistoryRoundView> history, JobView job, List<EventView> events,
                                       SnapshotView snapshot, RuntimeFacts runtime) {
    public AnalysisSessionAggregate(SessionView session, JobView job, List<EventView> events,
                                    SnapshotView snapshot, RuntimeFacts runtime) {
        this(session, List.of(), List.of(new HistoryRoundView("session-root", "initial", session.questionText(),
                null, snapshot == null ? null : snapshot.executionId(), snapshot == null ? null : snapshot.status(),
                snapshot == null ? null : snapshot.ontologyVersionId(),
                snapshot == null ? null : snapshot.ontologyVersionBindingSource(),
                snapshot == null ? null : snapshot.planSnapshot(),
                snapshot == null ? null : snapshot.conclusionState(), session.createdAt())),
                job, events, snapshot, runtime);
    }
    public record SessionView(String id, String questionText, String status, SessionScope scope,
                              Map<String, Object> savedContext, Instant createdAt, Instant updatedAt) {}

    public record SessionScope(String organizationId, List<String> projectIds, List<String> areaIds) {}

    public record JobView(String executionId, String status, Map<String, Object> result, String error,
                          int attemptCount, int maxAttempts, String dispatchStatus, String traceId,
                          Instant createdAt, Instant updatedAt, Instant startedAt, Instant completedAt,
                          Instant failedAt) {}

    public record EventView(String id, String sessionId, String executionId, long sequence, String kind,
                            Instant timestamp, String status, String message,
                            List<Map<String, Object>> renderBlocks, Map<String, Object> metadata,
                            String errorCode, String traceId) {}

    public record SnapshotView(String executionId, String sessionId, String followUpId,
                               String ontologyVersionId, String ontologyVersionBindingSource, String status,
                               Map<String, Object> capabilityBinding,
                               Map<String, Object> planSnapshot, List<Map<String, Object>> stepResults,
                               Map<String, Object> conclusionState, List<Map<String, Object>> resultBlocks,
                               Map<String, Object> mobileProjection, Map<String, Object> failurePoint,
                               String errorCode, String traceId, Instant createdAt, Instant updatedAt) {}

    public record HistoryRoundView(String id, String kind, String questionText, String followUpId,
                                   String executionId, String status, String ontologyVersionId,
                                   String ontologyVersionBindingSource, Map<String, Object> planSnapshot,
                                   Map<String, Object> conclusionState, Instant createdAt) {}

    public record RuntimeFacts(String requestedExecutionId, String resolvedExecutionId, String status,
                               boolean autoExecute, boolean streamEnabled, boolean terminal,
                               long resumeAfterSequence) {}
}
