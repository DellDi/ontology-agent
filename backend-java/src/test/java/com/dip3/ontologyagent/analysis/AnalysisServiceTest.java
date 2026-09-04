package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityBinding;
import com.dip3.ontologyagent.capability.api.CapabilityRegistry;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.ExecutionSubmission;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.property.internal.domain.AnalysisCapabilityPolicy;
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
import static com.dip3.ontologyagent.support.CapabilityTestFixtures.propertyBinding;
import static com.dip3.ontologyagent.support.CapabilityTestFixtures.PROPERTY_ID;
import static com.dip3.ontologyagent.support.CapabilityTestFixtures.EASYV_ID;
import static com.dip3.ontologyagent.support.CapabilityTestFixtures.easyvBinding;

class AnalysisServiceTest {
    private final AnalysisSessionRepository sessions = mock(AnalysisSessionRepository.class);
    private final ExecutionRepository executions = mock(ExecutionRepository.class);
    private final WakeupPublisher wakeups = mock(WakeupPublisher.class);
    private final OntologyRepository ontologies = mock(OntologyRepository.class);
    private final CapabilityRegistry capabilities = mock(CapabilityRegistry.class);
    private final AuthSession owner = new AuthSession("auth-1", "user-1", "用户",
            new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")), Instant.MAX);
    private final AnalysisSession session = new AnalysisSession("session-1", "user-1", owner.scope(), "分析收缴率",
            contextWithCapability(PROPERTY_ID),
            "pending", Instant.now(), Instant.now());
    private AnalysisService service;
    private CapabilityBinding binding;

    @BeforeEach
    void setUp() {
        when(sessions.findOwned("session-1", owner)).thenReturn(Optional.of(session));
        OntologyCatalog ontology = new OntologyCatalog("ontology-1", "1.0.0",
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        when(ontologies.currentPublished()).thenReturn(ontology);
        binding = propertyBinding(owner, "ontology-1");
        when(capabilities.selectInitial(org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> {
            String question = invocation.getArgument(0);
            if (AnalysisCapabilityPolicy.unsupportedBusinessScope(question)) {
                throw new BackendException("UNSUPPORTED_ANALYSIS_SCOPE", "unsupported business scope");
            }
            if (!AnalysisCapabilityPolicy.supportsInitialCollectionRate(question)) {
                throw new BackendException("ANALYSIS_CAPABILITY_UNSUPPORTED", "unsupported property capability");
            }
            return PROPERTY_ID;
        });
        when(capabilities.bind(PROPERTY_ID, ontology, owner)).thenReturn(binding);
        service = new AnalysisService(sessions, executions, wakeups, ontologies, capabilities);
    }

    @Test
    void redisWakeupFailureRemainsObservableWithoutDestroyingThePostgresQueue() {
        when(executions.submit(session, "request-1", "trace-1", binding))
                .thenReturn(new ExecutionSubmission("execution-1", true));
        org.mockito.Mockito.doThrow(new IllegalStateException("redis unavailable"))
                .when(wakeups).publish("execution-1");

    assertEquals("execution-1", service.submit("session-1", owner, "request-1", "trace-1"));

        verify(capabilities, never()).selectInitial(any());
        verify(executions).markDispatchFailed("execution-1");
        verify(executions, never()).fail(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void idempotentReplayDoesNotPublishOrMutateTheCompletedExecution() {
        when(executions.submit(session, "request-1", "trace-2", binding))
                .thenReturn(new ExecutionSubmission("execution-1", false));

        assertEquals("execution-1", service.submit("session-1", owner, "request-1", "trace-2"));

        verify(wakeups, never()).publish(org.mockito.ArgumentMatchers.anyString());
        verify(executions, never()).markDispatchPublished(org.mockito.ArgumentMatchers.anyString());
        verify(executions, never()).markDispatchFailed(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void browserFormSubmissionUsesAStableInitialIdempotencyKey() {
        when(executions.submit(session, "initial", "trace-3", binding))
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
        assertEquals(Map.of("domainKey", "property", "capabilityKey", "collection-rate-analysis"),
                context.getValue().get("_capabilityId"));
    }

    @Test
    void sessionCreationDoesNotRequirePropertyProjectOrAreaScope() {
        AuthSession easyvOwner = new AuthSession("auth-2", "user-2", "用户",
                new AccessScope("org-1", List.of(), List.of(), List.of("EASYV_ANALYST")), Instant.MAX);
        AnalysisSession created = new AnalysisSession("created-2", "user-2", easyvOwner.scope(),
                "分析大屏生成质量", contextWithCapability(EASYV_ID), "pending", Instant.now(), Instant.now());
        org.mockito.Mockito.doReturn(EASYV_ID)
                .when(capabilities).selectInitial("分析大屏生成质量");
        when(sessions.create(eq(easyvOwner), eq("分析大屏生成质量"), any())).thenReturn(created);

        assertEquals(created, service.createSession(easyvOwner, "分析大屏生成质量"));
        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<Map<String, Object>> context = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(sessions).create(eq(easyvOwner), eq("分析大屏生成质量"), context.capture());
        assertEquals(Map.of("domainKey", "easyv", "capabilityKey", "generation-quality-analysis"),
                context.getValue().get("_capabilityId"));
    }

    @Test
    void easyVSubmitPinsTheCurrentCatalogAndPersistsTheEasyVBinding() {
        AuthSession easyvOwner = new AuthSession("auth-2", "123", "用户",
                new AccessScope("org-1", List.of(), List.of(), List.of("EASYV_ANALYST")), Instant.MAX);
        AnalysisSession easyvSession = new AnalysisSession("easyv-session", "123", easyvOwner.scope(),
                "分析大屏生成质量", contextWithCapability(EASYV_ID), "pending", Instant.now(), Instant.now());
        OntologyCatalog v2 = catalog("ontology-v2", "2.0.0");
        OntologyCatalog v3 = catalog("ontology-v3", "3.0.0");
        CapabilityBinding easyvBinding = easyvBinding(easyvOwner, v2.versionId());
        when(sessions.findOwned("easyv-session", easyvOwner)).thenReturn(Optional.of(easyvSession));
        when(ontologies.currentPublished()).thenReturn(v2);
        when(capabilities.bind(EASYV_ID, v2, easyvOwner)).thenReturn(easyvBinding);
        when(executions.submit(easyvSession, "initial", "trace-easyv", easyvBinding))
                .thenReturn(new ExecutionSubmission("easyv-execution", true));

        assertEquals("easyv-execution", service.submit("easyv-session", easyvOwner, null, "trace-easyv"));

        verify(capabilities, never()).selectInitial(any());
        verify(capabilities).bind(EASYV_ID, v2, easyvOwner);
        verify(executions).submit(easyvSession, "initial", "trace-easyv", easyvBinding);
        assertEquals("ontology-v2", easyvBinding.ontologyVersionId());

        when(ontologies.currentPublished()).thenReturn(v3);
        assertEquals("ontology-v2", easyvBinding.ontologyVersionId());
        assertEquals(EASYV_ID, easyvBinding.id());
    }

    @Test
    void legacySessionWithoutCapabilitySelectionFailsBeforeSubmission() {
        AnalysisSession legacy = new AnalysisSession("legacy-1", "user-1", owner.scope(), "分析收缴率",
                Map.of("_executionContract", ExecutionRepository.EXECUTION_CONTRACT),
                "pending", Instant.now(), Instant.now());
        when(sessions.findOwned("legacy-1", owner)).thenReturn(Optional.of(legacy));

        BackendException error = assertThrows(BackendException.class,
                () -> service.submit("legacy-1", owner, "request-legacy", "trace-legacy"));

        assertEquals("CAPABILITY_SELECTION_MISSING", error.code());
        verify(executions, never()).submit(any(), any(), any(), any());
    }

    @Test
    void tamperedCapabilitySelectionIsRejectedBeforeBinding() {
        AnalysisSession tampered = new AnalysisSession("tampered-1", "user-1", owner.scope(), "分析收缴率",
                Map.of("_executionContract", ExecutionRepository.EXECUTION_CONTRACT,
                        "_capabilityId", Map.of("domainKey", "unknown", "capabilityKey", "unknown")),
                "pending", Instant.now(), Instant.now());
        when(sessions.findOwned("tampered-1", owner)).thenReturn(Optional.of(tampered));
        org.mockito.Mockito.doThrow(new BackendException("CAPABILITY_NOT_REGISTERED", "unknown capability"))
                .when(capabilities).bind(eq(new com.dip3.ontologyagent.capability.api.CapabilityId("unknown", "unknown")),
                        any(), eq(owner));

        BackendException error = assertThrows(BackendException.class,
                () -> service.submit("tampered-1", owner, "request-tampered", "trace-tampered"));

        assertEquals("CAPABILITY_NOT_REGISTERED", error.code());
        verify(capabilities, never()).selectInitial(any());
        verify(executions, never()).submit(any(), any(), any(), any());
    }

    private static Map<String, Object> contextWithCapability(com.dip3.ontologyagent.capability.api.CapabilityId id) {
        return Map.of("_executionContract", ExecutionRepository.EXECUTION_CONTRACT,
                "_capabilityId", Map.of("domainKey", id.domainKey(), "capabilityKey", id.capabilityKey()));
    }

    private static OntologyCatalog catalog(String versionId, String semver) {
        return new OntologyCatalog(versionId, semver,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
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
