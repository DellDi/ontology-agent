package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.followup.AnalysisFollowUp;
import com.dip3.ontologyagent.followup.AnalysisFollowUpRepository;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.List;

@Service
public class AnalysisSessionReadService {
    private final AnalysisSessionReadMapper mapper;
    private final AnalysisFollowUpRepository followUps;

    public AnalysisSessionReadService(AnalysisSessionReadMapper mapper, AnalysisFollowUpRepository followUps) {
        this.mapper = mapper;
        this.followUps = followUps;
    }

    @Transactional(readOnly = true)
    public AnalysisSessionAggregate load(String sessionId, String executionId, AuthSession viewer) {
        String requestedExecutionId = requestedExecutionId(executionId);
        AnalysisSessionReadMapper.SessionRow session = mapper.findSession(sessionId, viewer.userId(),
                viewer.scope().organizationId(), viewer.scope().projectIds().toArray(String[]::new),
                viewer.scope().areaIds().toArray(String[]::new));
        if (session == null) throw new BackendException("SESSION_NOT_FOUND", "会话不存在或无权访问。");

        AnalysisSessionReadMapper.ExecutionRow execution = mapper.findExecution(sessionId, viewer.userId(),
                viewer.scope().organizationId(), requestedExecutionId);
        if (requestedExecutionId != null && execution == null) {
            throw new BackendException("EXECUTION_NOT_FOUND", "执行不存在或无权访问。");
        }
        List<AnalysisSessionAggregate.EventView> events = execution == null ? List.of()
                : mapper.listEvents(sessionId, execution.resolvedExecutionId, viewer.userId()).stream()
                .map(AnalysisSessionReadService::event).toList();
        long resumeAfterSequence = events.isEmpty() ? 0 : events.getLast().sequence();
        boolean terminal = execution != null && (terminal(execution.jobStatus)
                || terminal(execution.snapshotStatus) || events.stream().anyMatch(AnalysisSessionReadService::terminal));
        String status = execution == null ? null : status(execution, events);
        List<AnalysisFollowUp> followUpViews = followUps.listOwned(sessionId, viewer.userId());
        List<AnalysisSessionAggregate.HistoryRoundView> history = history(session, followUpViews,
                mapper.findRootHistory(sessionId, viewer.userId()),
                mapper.listFollowUpHistory(sessionId, viewer.userId()));
        boolean javaInitialSession = session.savedContext != null
                && com.dip3.ontologyagent.execution.ExecutionRepository.EXECUTION_CONTRACT.equals(
                session.savedContext.get("_executionContract"));
        AnalysisSessionAggregate.RuntimeFacts runtime = new AnalysisSessionAggregate.RuntimeFacts(
                requestedExecutionId, execution == null ? null : execution.resolvedExecutionId, status,
                execution == null && javaInitialSession, execution != null && !terminal, terminal,
                resumeAfterSequence);
        return new AnalysisSessionAggregate(session(session), followUpViews, history,
                execution == null ? null : job(execution), events,
                execution == null ? null : snapshot(sessionId, execution), runtime);
    }

    private static List<AnalysisSessionAggregate.HistoryRoundView> history(
            AnalysisSessionReadMapper.SessionRow session, List<AnalysisFollowUp> followUps,
            AnalysisSessionReadMapper.HistoryRow root, List<AnalysisSessionReadMapper.HistoryRow> rounds) {
        List<AnalysisSessionAggregate.HistoryRoundView> result = new java.util.ArrayList<>();
        result.add(new AnalysisSessionAggregate.HistoryRoundView("session-root", "initial", session.questionText,
                null, root == null ? null : root.executionId, root == null ? null : root.status,
                root == null ? null : root.ontologyVersionId,
                root == null ? null : root.ontologyVersionBindingSource,
                root == null ? null : root.planSnapshot, root == null ? null : root.conclusionState,
                session.createdAt));
        java.util.Map<String, AnalysisSessionReadMapper.HistoryRow> byId = rounds.stream()
                .collect(java.util.stream.Collectors.toMap(row -> row.id, row -> row));
        for (AnalysisFollowUp followUp : followUps) {
            AnalysisSessionReadMapper.HistoryRow row = byId.get(followUp.id());
            result.add(new AnalysisSessionAggregate.HistoryRoundView(followUp.id(), "follow-up",
                    followUp.questionText(), followUp.id(), row == null ? null : row.executionId,
                    row == null ? null : row.status,
                    row == null ? followUp.ontologyVersionId() : row.ontologyVersionId,
                    row == null ? String.valueOf(followUp.ontologyVersionBinding().get("source"))
                            : row.ontologyVersionBindingSource,
                    row == null ? null : row.planSnapshot, row == null ? null : row.conclusionState,
                    followUp.createdAt()));
        }
        return List.copyOf(result);
    }

    private static String requestedExecutionId(String executionId) {
        if (executionId == null) return null;
        String normalized = executionId.trim();
        if (normalized.isEmpty()) {
            throw new BackendException("EXECUTION_ID_REQUIRED", "executionId 不能为空。");
        }
        if (normalized.length() > 200) {
            throw new BackendException("EXECUTION_ID_INVALID", "executionId 不能超过 200 个字符。");
        }
        return normalized;
    }

    private static AnalysisSessionAggregate.SessionView session(AnalysisSessionReadMapper.SessionRow row) {
        return new AnalysisSessionAggregate.SessionView(row.id, row.questionText, row.status,
                new AnalysisSessionAggregate.SessionScope(row.organizationId, Arrays.asList(row.projectIds),
                        Arrays.asList(row.areaIds)), row.savedContext, row.createdAt, row.updatedAt);
    }

    private static AnalysisSessionAggregate.JobView job(AnalysisSessionReadMapper.ExecutionRow row) {
        if (row.jobStatus == null) return null;
        return new AnalysisSessionAggregate.JobView(row.resolvedExecutionId, row.jobStatus, row.jobResult,
                row.jobError, row.attemptCount, row.maxAttempts, row.dispatchStatus, row.jobTraceId,
                row.jobCreatedAt, row.jobUpdatedAt, row.startedAt, row.completedAt, row.failedAt);
    }

    private static AnalysisSessionAggregate.SnapshotView snapshot(String sessionId,
                                                                  AnalysisSessionReadMapper.ExecutionRow row) {
        if (row.snapshotStatus == null) return null;
        return new AnalysisSessionAggregate.SnapshotView(row.resolvedExecutionId, sessionId, row.followUpId,
                row.ontologyVersionId, row.ontologyVersionBindingSource, row.snapshotStatus, row.capabilityBinding,
                row.planSnapshot,
                row.stepResults, row.conclusionState, row.resultBlocks, row.mobileProjection, row.failurePoint,
                row.snapshotErrorCode, row.snapshotTraceId, row.snapshotCreatedAt, row.snapshotUpdatedAt);
    }

    private static AnalysisSessionAggregate.EventView event(AnalysisSessionReadMapper.EventRow row) {
        return new AnalysisSessionAggregate.EventView(row.id, row.sessionId, row.executionId, row.sequence,
                row.kind, row.timestamp, row.status, row.message, row.renderBlocks, row.metadata,
                row.errorCode, row.traceId);
    }

    private static boolean terminal(AnalysisSessionAggregate.EventView event) {
        return "execution-status".equals(event.kind()) && terminal(event.status());
    }

    private static boolean terminal(String status) {
        return "completed".equals(status) || "failed".equals(status) || "dead_letter".equals(status)
                || "cancelled".equals(status);
    }

    private static String status(AnalysisSessionReadMapper.ExecutionRow row,
                                 List<AnalysisSessionAggregate.EventView> events) {
        if (terminal(row.jobStatus)) return row.jobStatus;
        if (terminal(row.snapshotStatus)) return row.snapshotStatus;
        for (int index = events.size() - 1; index >= 0; index--) {
            String eventStatus = events.get(index).status();
            if (eventStatus != null && !eventStatus.isBlank()) return eventStatus;
        }
        return row.jobStatus == null ? row.snapshotStatus : row.jobStatus;
    }
}
