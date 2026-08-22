package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.ExecutionSubmission;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AnalysisServiceTest {
    private final AnalysisSessionRepository sessions = mock(AnalysisSessionRepository.class);
    private final ExecutionRepository executions = mock(ExecutionRepository.class);
    private final WakeupPublisher wakeups = mock(WakeupPublisher.class);
    private final OntologyRepository ontologies = mock(OntologyRepository.class);
    private final AuthSession owner = new AuthSession("auth-1", "user-1", "用户",
            new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")), Instant.MAX);
    private final AnalysisSession session = new AnalysisSession("session-1", "user-1", owner.scope(), "分析收缴率",
            Map.of("_executionContract", ExecutionRepository.EXECUTION_CONTRACT),
            "pending", Instant.now(), Instant.now());
    private AnalysisService service;

    @BeforeEach
    void setUp() {
        when(sessions.findOwned("session-1", owner)).thenReturn(Optional.of(session));
        when(ontologies.currentPublished()).thenReturn(new OntologyCatalog("ontology-1", "1.0.0",
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()));
        service = new AnalysisService(sessions, executions, wakeups, ontologies);
    }

    @Test
    void redisWakeupFailureRemainsObservableWithoutDestroyingThePostgresQueue() {
        when(executions.submit(session, "request-1", "trace-1", "ontology-1"))
                .thenReturn(new ExecutionSubmission("execution-1", true));
        org.mockito.Mockito.doThrow(new IllegalStateException("redis unavailable"))
                .when(wakeups).publish("execution-1");

        assertEquals("execution-1", service.submit("session-1", owner, "request-1", "trace-1"));

        verify(executions).markDispatchFailed("execution-1");
        verify(executions, never()).fail(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void idempotentReplayDoesNotPublishOrMutateTheCompletedExecution() {
        when(executions.submit(session, "request-1", "trace-2", "ontology-1"))
                .thenReturn(new ExecutionSubmission("execution-1", false));

        assertEquals("execution-1", service.submit("session-1", owner, "request-1", "trace-2"));

        verify(wakeups, never()).publish(org.mockito.ArgumentMatchers.anyString());
        verify(executions, never()).markDispatchPublished(org.mockito.ArgumentMatchers.anyString());
        verify(executions, never()).markDispatchFailed(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void browserFormSubmissionUsesAStableInitialIdempotencyKey() {
        when(executions.submit(session, "initial", "trace-3", "ontology-1"))
                .thenReturn(new ExecutionSubmission("execution-1", false));

        assertEquals("execution-1", service.submit("session-1", owner, null, "trace-3"));

        verify(wakeups, never()).publish(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void newSessionIsMarkedForTheJavaInitialExecutionContract() {
        AnalysisSession created = new AnalysisSession("created-1", "user-1", owner.scope(), "分析项目收缴率",
                Map.of("_executionContract", ExecutionRepository.EXECUTION_CONTRACT),
                "pending", Instant.now(), Instant.now());
        when(sessions.create(eq(owner), eq("分析项目收缴率"), any())).thenReturn(created);

        assertEquals(created, service.createSession(owner, "  分析项目收缴率  "));

        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<Map<String, Object>> context = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(sessions).create(eq(owner), eq("分析项目收缴率"), context.capture());
        assertEquals(ExecutionRepository.EXECUTION_CONTRACT,
                context.getValue().get("_executionContract"));
    }

    @Test
    void unsupportedBusinessBoundaryFailsBeforeSessionCreation() {
        BackendException error = assertThrows(BackendException.class,
                () -> service.createSession(owner, "分析 CRM 客服转化率"));

        assertEquals("UNSUPPORTED_ANALYSIS_SCOPE", error.code());
        verify(sessions, never()).create(any(), any(), any());
    }

    @Test
    void unsupportedMetricFailsBeforeTheFixedCollectionRateAgentCanAnalyzeTheWrongThing() {
        for (String question : List.of("分析 2026 年 1 月投诉量", "分析工单满意度", "分析应收金额",
                "分析 2026 年 1 月尾欠收缴率", "按缴款日期分析 2026 年 1 月收缴率",
                "按账单截止日期分析 2026 年 1 月回款率", "分析 2026 年历史欠费收缴率",
                "分析 2026 年陈欠收缴率", "按实收日期分析 2026 年 1 月收缴率",
                "按缴费日期分析 2026 年 1 月收缴率", "按收款日期分析 2026 年 1 月收缴率",
                "按到账日期分析 2026 年 1 月收缴率", "按实收账期分析 2026 年 1 月收缴率")) {
            BackendException error = assertThrows(BackendException.class,
                    () -> service.createSession(owner, question));
            assertEquals("ANALYSIS_CAPABILITY_UNSUPPORTED", error.code());
        }
        verify(sessions, never()).create(any(), any(), any());
    }
}
