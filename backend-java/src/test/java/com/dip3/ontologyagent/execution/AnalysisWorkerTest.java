package com.dip3.ontologyagent.execution;

import com.dip3.ontologyagent.property.internal.application.MainAgent;
import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.analysis.AnalysisSessionRepository;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityBinding;
import com.dip3.ontologyagent.capability.api.CapabilityDescriptor;
import com.dip3.ontologyagent.capability.api.CapabilityEvidence;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.CapabilityInvocationContract;
import com.dip3.ontologyagent.capability.api.CapabilityRegistry;
import com.dip3.ontologyagent.capability.api.CapabilityResult;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static com.dip3.ontologyagent.support.CapabilityTestFixtures.propertyBinding;
import static com.dip3.ontologyagent.support.CapabilityTestFixtures.propertyDescriptor;
import static com.dip3.ontologyagent.support.CapabilityTestFixtures.easyvBinding;
import static com.dip3.ontologyagent.support.CapabilityTestFixtures.easyvDescriptor;
import static com.dip3.ontologyagent.support.CapabilityTestFixtures.EASYV_ID;

class AnalysisWorkerTest {
    private final ExecutionRepository executions = mock(ExecutionRepository.class);
    private final AnalysisSessionRepository sessions = mock(AnalysisSessionRepository.class);
    private final OntologyRepository ontologies = mock(OntologyRepository.class);
    private final MainAgent mainAgent = mock(MainAgent.class);
    private final AgentInvocationRepository invocations = mock(AgentInvocationRepository.class);
    private final InvocationEventRecorder recorder = mock(InvocationEventRecorder.class);
    private final CapabilityRegistry capabilities = mock(CapabilityRegistry.class);
    private final AuthSession workerOwner = new AuthSession("worker:test", "user-1", "user-1",
            new AccessScope("org-1", List.of("project-1"), List.of(), List.of()), Instant.MAX);
    private final CapabilityBinding binding = propertyBinding(workerOwner, "ontology-1");
    private final ExecutionJob job = new ExecutionJob("execution-1", ExecutionRepository.EXECUTION_CONTRACT,
            "session-1", "user-1", "org-1", List.of("project-1"), List.of(), "分析收缴率", "trace-1",
            "ontology-1", binding, null, null, Map.of(), Map.of(), "worker-1", 1, 2);
    private final AnalysisSession session = new AnalysisSession("session-1", "user-1",
            workerOwner.scope(), "分析收缴率",
            Map.of(), "pending", Instant.now(), Instant.now());
    private AnalysisWorker worker;

    @BeforeEach
    void setUp() {
        when(executions.claim(anyString(), any())).thenReturn(Optional.of(job));
        when(sessions.findOwned(anyString(), any())).thenReturn(Optional.of(session));
        when(ontologies.published("ontology-1")).thenReturn(new OntologyCatalog("ontology-1", "1.0.0",
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()));
        when(recorder.startAgentRun(anyString(), anyString(), anyString(), anyMap(), anyString(), anyString()))
                .thenReturn("agent-run-1");
        when(capabilities.require(any(), any(), any())).thenReturn(propertyDescriptor());
        when(capabilities.execute(any(), any())).thenAnswer(invocation -> {
            CapabilityBinding selected = invocation.getArgument(0);
            CapabilityExecutionContext context = invocation.getArgument(1);
            WorkflowResult value = mainAgent.execute(context.principal(), context.turn(), context.executionId(),
                    context.ontology(), context.traceId(), context.leaseOwner());
            String scopeRef = selected.scopeSnapshotRef(context.executionId());
            List<CapabilityEvidence<Evidence>> evidence = value.evidence().stream()
                    .map(item -> new CapabilityEvidence<>(selected, scopeRef, item.source(), item.source(), item))
                    .toList();
            return new CapabilityResult<>(selected, scopeRef, value, evidence);
        });
        worker = new AnalysisWorker(executions, sessions, ontologies, invocations, recorder, capabilities);
    }

    @AfterEach
    void closeWorker() {
        worker.close();
    }

    @Test
    void completesOnlyWhenExactlyOneWorkflowInvocationWasAudited() {
        when(mainAgent.execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString()))
                .thenReturn(new WorkflowResult(Map.of("steps", List.of(), "_executionContract",
                        ExecutionRepository.EXECUTION_CONTRACT, "_resolvedContext", Map.of()),
                        requiredEvidence(), "真实结论", claims(), List.of()));
        when(invocations.count("execution-1", "workflow-tool", "analysis_workflow")).thenReturn(1L);

        assertTrue(worker.runOne("worker-1"));

        ArgumentCaptor<String> claimOwner = ArgumentCaptor.forClass(String.class);
        verify(executions).claim(claimOwner.capture(), any());
        assertTrue(claimOwner.getValue().startsWith("worker-1:"));
        assertNotEquals("worker-1", claimOwner.getValue());
        ArgumentCaptor<ExecutionEvent> terminal = ArgumentCaptor.forClass(ExecutionEvent.class);
        ArgumentCaptor<ExecutionSnapshot> snapshot = ArgumentCaptor.forClass(ExecutionSnapshot.class);
        @SuppressWarnings("rawtypes")
        ArgumentCaptor<Map> result = ArgumentCaptor.forClass(Map.class);
        verify(executions).completeAtomically(anyString(), anyString(), terminal.capture(), snapshot.capture(),
                result.capture());
        assertEquals("completed", snapshot.getValue().status());
        assertEquals("grounded-context", snapshot.getValue().ontologyVersionBinding().get("source"));
        assertEquals(binding.snapshot(), snapshot.getValue().capabilityBinding());
        assertEquals(3, ((List<?>) snapshot.getValue().conclusionState().get("evidence")).size());
        assertEquals(1L, result.getValue().get("workflowInvocations"));
        assertEquals("ontology-1", result.getValue().get("ontologyVersionId"));
        assertEquals(List.of("erp-staging", "cube", "neo4j"), result.getValue().get("evidenceSources"));
        assertEquals(binding.snapshot(), terminal.getValue().metadata().get("capabilityBinding"));
        assertEquals(binding.snapshot(), result.getValue().get("capabilityBinding"));
    }

    @Test
    void duplicateWorkflowAuditBecomesAPersistedFailureWithoutSuccessFallback() {
        when(mainAgent.execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString()))
                .thenReturn(new WorkflowResult(Map.of(), List.of(), "结论", List.of(), List.of()));
        when(invocations.count("execution-1", "workflow-tool", "analysis_workflow")).thenReturn(2L);

        assertTrue(worker.runOne("worker-1"));

        verify(executions, never()).completeAtomically(anyString(), anyString(), any(), any(), anyMap());
        ArgumentCaptor<ExecutionSnapshot> snapshot = ArgumentCaptor.forClass(ExecutionSnapshot.class);
        verify(executions).failAtomically(anyString(), anyString(), any(), snapshot.capture(),
                org.mockito.ArgumentMatchers.eq("AGENT_TOOL_CONTRACT_VIOLATION"),
                org.mockito.ArgumentMatchers.eq("Main Agent 必须且只能调用一次 analysis_workflow，实际调用 2 次。"),
                org.mockito.ArgumentMatchers.eq("trace-1"));
        assertEquals("failed", snapshot.getValue().status());
        assertEquals("AGENT_TOOL_CONTRACT_VIOLATION", snapshot.getValue().errorCode());
        assertEquals("trace-1", snapshot.getValue().traceId());
        assertEquals(binding.snapshot(), snapshot.getValue().capabilityBinding());
    }

    @Test
    void invocationTypeToolNameAndExactCountComeFromTheCapabilityDescriptor() {
        CapabilityDescriptor custom = new CapabilityDescriptor(binding.id(), "自定义能力",
                java.util.Set.of("project"), java.util.Set.of("erp-staging", "cube", "neo4j"),
                java.util.Set.of("collection-rate", "erp-balance", "charge-structure"),
                new CapabilityInvocationContract("custom-invocation", "custom_workflow", 2,
                        "Custom Agent", "Custom Workflow", "customInvocations"));
        when(capabilities.require(any(), any(), any())).thenReturn(custom);
        when(mainAgent.execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString()))
                .thenReturn(new WorkflowResult(Map.of("steps", List.of(), "_executionContract",
                        ExecutionRepository.EXECUTION_CONTRACT, "_resolvedContext", Map.of()),
                        requiredEvidence(), "真实结论", claims(), List.of()));
        when(invocations.count("execution-1", "custom-invocation", "custom_workflow")).thenReturn(2L);

        assertTrue(worker.runOne("worker-1"));

        verify(invocations).count("execution-1", "custom-invocation", "custom_workflow");
        verify(invocations, never()).count("execution-1", "workflow-tool", "analysis_workflow");
        @SuppressWarnings("rawtypes")
        ArgumentCaptor<Map> result = ArgumentCaptor.forClass(Map.class);
        verify(executions).completeAtomically(anyString(), anyString(), any(), any(), result.capture());
        assertEquals(2L, result.getValue().get("customInvocations"));
        assertTrue(!result.getValue().containsKey("workflowInvocations"));
    }

    @Test
    void resultFromAnotherCapabilityBindingIsRejectedBeforeCompletion() {
        CapabilityBinding anotherBinding = new CapabilityBinding(
                new com.dip3.ontologyagent.capability.api.CapabilityId("another", "analysis"),
                "ontology-1", new com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot(
                        "another", 1, Map.of("scope", "scope-1")));
        WorkflowResult workflowResult = new WorkflowResult(Map.of("steps", List.of(), "_executionContract",
                ExecutionRepository.EXECUTION_CONTRACT, "_resolvedContext", Map.of()),
                requiredEvidence(), "真实结论", claims(), List.of());
        List<CapabilityEvidence<Evidence>> evidence = workflowResult.evidence().stream()
                .map(item -> new CapabilityEvidence<>(anotherBinding, anotherBinding.scopeSnapshotRef("execution-1"),
                        item.source(), item.source(), item))
                .toList();
        org.mockito.Mockito.doReturn(new CapabilityResult<>(anotherBinding,
                anotherBinding.scopeSnapshotRef("execution-1"), workflowResult, evidence))
                .when(capabilities).execute(any(), any());
        when(invocations.count("execution-1", "workflow-tool", "analysis_workflow")).thenReturn(1L);

        assertTrue(worker.runOne("worker-1"));

        verify(executions, never()).completeAtomically(anyString(), anyString(), any(), any(), anyMap());
        verify(executions).failAtomically(anyString(), anyString(), any(), any(),
                org.mockito.ArgumentMatchers.eq("WORKFLOW_RESULT_INVALID"), anyString(),
                org.mockito.ArgumentMatchers.eq("trace-1"));
    }

    @Test
    void retryFenceUsesTheCapabilityInvocationContract() {
        ExecutionJob retry = new ExecutionJob("execution-1", ExecutionRepository.EXECUTION_CONTRACT,
                "session-1", "user-1", "org-1", List.of("project-1"), List.of(), "分析收缴率", "trace-1",
                "ontology-1", binding, null, null, Map.of(), Map.of(), "worker-2", 2, 2);
        CapabilityDescriptor custom = new CapabilityDescriptor(binding.id(), "自定义能力",
                java.util.Set.of("project"), java.util.Set.of("erp-staging", "cube", "neo4j"),
                java.util.Set.of("collection-rate", "erp-balance", "charge-structure"),
                new CapabilityInvocationContract("custom-invocation", "custom_workflow", 2,
                        "Custom Agent", "Custom Workflow", "customInvocations"));
        when(executions.claim(anyString(), any())).thenReturn(Optional.of(retry));
        when(capabilities.require(any(), any(), any())).thenReturn(custom);
        when(invocations.count("execution-1", "custom-invocation", "custom_workflow")).thenReturn(1L);

        assertTrue(worker.runOne("worker-2"));

        verify(recorder).interruptRunningWhileLeased("execution-1", "worker-2");
        verify(mainAgent, never()).execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString());
        verify(executions).failAtomically(anyString(), anyString(), any(), any(),
                org.mockito.ArgumentMatchers.eq("AGENT_EXECUTION_INTERRUPTED"),
                org.mockito.ArgumentMatchers.eq("上一次租约内已开始 Custom Workflow，禁止再次调用 Agent；本次执行显式失败。"),
                org.mockito.ArgumentMatchers.eq("trace-1"));
    }

    @Test
    void providerFailureIsPersistedAndNeverMarkedCompleted() {
        when(mainAgent.execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString()))
                .thenThrow(new BackendException("CUBE_PROVIDER_FAILURE", "Cube failed"));

        assertTrue(worker.runOne("worker-1"));

        verify(executions, never()).completeAtomically(anyString(), anyString(), any(), any(), anyMap());
        ArgumentCaptor<ExecutionEvent> terminal = ArgumentCaptor.forClass(ExecutionEvent.class);
        ArgumentCaptor<ExecutionSnapshot> snapshot = ArgumentCaptor.forClass(ExecutionSnapshot.class);
        verify(executions).failAtomically(anyString(), anyString(), terminal.capture(), snapshot.capture(),
                org.mockito.ArgumentMatchers.eq("CUBE_PROVIDER_FAILURE"),
                org.mockito.ArgumentMatchers.eq("Cube failed"), org.mockito.ArgumentMatchers.eq("trace-1"));
        assertEquals("CUBE_PROVIDER_FAILURE", terminal.getValue().errorCode());
        assertEquals("trace-1", terminal.getValue().traceId());
        assertEquals(binding.snapshot(), terminal.getValue().metadata().get("capabilityBinding"));
        assertEquals(binding.snapshot(), snapshot.getValue().capabilityBinding());
        assertTrue(terminal.getValue().renderBlocks().stream()
                .anyMatch(block -> "失败诊断".equals(block.get("title"))));
    }

    @Test
    void agentRunAuditFailureIsPersistedAsThePrimaryFailure() {
        when(mainAgent.execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString()))
                .thenThrow(new BackendException("CUBE_PROVIDER_FAILURE", "Cube failed"));
        doThrow(new BackendException("INVOCATION_STATE_CONFLICT", "invocation already terminal"))
                .when(recorder).failWhileLeased(anyString(), anyString(), anyString(), anyString(), anyString());

        assertTrue(worker.runOne("worker-1"));

        verify(executions).failAtomically(anyString(), anyString(), any(), any(),
                org.mockito.ArgumentMatchers.eq("INVOCATION_AUDIT_FAILURE"), anyString(),
                org.mockito.ArgumentMatchers.eq("trace-1"));
    }

    @Test
    void expiredLeaseNeverStartsASecondAgentLoopAfterAWorkflowCallWasAudited() {
        ExecutionJob retry = new ExecutionJob("execution-1", ExecutionRepository.EXECUTION_CONTRACT,
                "session-1", "user-1", "org-1", List.of("project-1"), List.of(), "分析收缴率", "trace-1",
                "ontology-1", binding, null, null, Map.of(), Map.of(), "worker-2", 2, 2);
        when(executions.claim(anyString(), any())).thenReturn(Optional.of(retry));
        when(invocations.count("execution-1", "workflow-tool", "analysis_workflow")).thenReturn(1L);

        assertTrue(worker.runOne("worker-2"));

        verify(recorder).interruptRunningWhileLeased("execution-1", "worker-2");
        verify(mainAgent, never()).execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString());
        verify(executions).failAtomically(anyString(), anyString(), any(), any(),
                org.mockito.ArgumentMatchers.eq("AGENT_EXECUTION_INTERRUPTED"), anyString(),
                org.mockito.ArgumentMatchers.eq("trace-1"));
    }

    @Test
    void missingRequiredEvidenceIsPersistedAsAnExplicitFailure() {
        when(mainAgent.execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString()))
                .thenReturn(new WorkflowResult(Map.of("_executionContract", ExecutionRepository.EXECUTION_CONTRACT),
                        List.of(new Evidence("erp-staging", "ERP", List.of(Map.of("value", 1)))),
                        "结论", List.of(), List.of()));
        when(invocations.count("execution-1", "workflow-tool", "analysis_workflow")).thenReturn(1L);

        assertTrue(worker.runOne("worker-1"));

        verify(executions, never()).completeAtomically(anyString(), anyString(), any(), any(), anyMap());
        verify(executions).failAtomically(anyString(), anyString(), any(), any(),
                org.mockito.ArgumentMatchers.eq("WORKFLOW_RESULT_INVALID"), anyString(),
                org.mockito.ArgumentMatchers.eq("trace-1"));
    }

    @Test
    void unsupportedClaimKindIsPersistedAsAnExplicitFailure() {
        var invalidClaims = List.of(new com.dip3.ontologyagent.tooling.GroundedConclusion.Claim(
                "unregistered-claim", "真实结论", List.of(
                new com.dip3.ontologyagent.tooling.GroundedConclusion.EvidenceReference(
                        "cube", 0, "value", 1))));
        when(mainAgent.execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString()))
                .thenReturn(new WorkflowResult(Map.of("_executionContract", ExecutionRepository.EXECUTION_CONTRACT),
                        requiredEvidence(), "结论", invalidClaims, List.of()));
        when(invocations.count("execution-1", "workflow-tool", "analysis_workflow")).thenReturn(1L);

        assertTrue(worker.runOne("worker-1"));

        verify(executions, never()).completeAtomically(anyString(), anyString(), any(), any(), anyMap());
        verify(executions).failAtomically(anyString(), anyString(), any(), any(),
                org.mockito.ArgumentMatchers.eq("WORKFLOW_RESULT_INVALID"), anyString(),
                org.mockito.ArgumentMatchers.eq("trace-1"));
    }

    @Test
    void easyVWorkerUsesThePinnedOntologyAndPersistedBindingScope() {
        AuthSession easyvOwner = new AuthSession("auth-easyv", "123", "用户",
                new AccessScope("org-1", List.of(), List.of(), List.of()), Instant.MAX);
        CapabilityBinding easyv = easyvBinding(easyvOwner, "ontology-v2");
        ExecutionJob easyvJob = new ExecutionJob("easyv-execution", ExecutionRepository.EXECUTION_CONTRACT,
                "session-1", "123", "org-1", List.of(), List.of(), "分析大屏生成质量", "trace-easyv",
                "ontology-v2", easyv, null, null, Map.of(), Map.of(), "worker-easyv", 1, 2);
        OntologyCatalog pinned = new OntologyCatalog("ontology-v2", "2.0.0",
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        CapabilityDescriptor descriptor = easyvDescriptor();
        WorkflowResult workflow = easyvWorkflowResult();
        List<CapabilityEvidence<Evidence>> evidence = workflow.evidence().stream()
                .map(item -> new CapabilityEvidence<>(easyv, easyv.scopeSnapshotRef("easyv-execution"),
                        item.source(), item.source(), item))
                .toList();
        when(executions.claim(anyString(), any())).thenReturn(Optional.of(easyvJob));
        when(ontologies.published("ontology-v2")).thenReturn(pinned);
        when(capabilities.require(any(), any(), any())).thenReturn(descriptor);
        org.mockito.Mockito.doReturn(new CapabilityResult<>(easyv, easyv.scopeSnapshotRef("easyv-execution"), workflow, evidence))
                .when(capabilities).execute(org.mockito.ArgumentMatchers.eq(easyv), any());
        when(invocations.count("easyv-execution", descriptor.invocationContract().invocationType(),
                descriptor.invocationContract().toolName())).thenReturn(1L);

        assertTrue(worker.runOne("worker-easyv"));

        verify(ontologies).published("ontology-v2");
        verify(ontologies, never()).currentPublished();
        verify(capabilities).require(org.mockito.ArgumentMatchers.eq(easyv), org.mockito.ArgumentMatchers.eq(pinned), any());
        ArgumentCaptor<CapabilityExecutionContext> context = ArgumentCaptor.forClass(CapabilityExecutionContext.class);
        verify(capabilities).execute(org.mockito.ArgumentMatchers.eq(easyv), context.capture());
        assertEquals("ontology-v2", context.getValue().ontology().versionId());
        assertEquals("123", context.getValue().principal().userId());
        assertEquals(Map.of("userId", "123", "accessMode", "creator-owned"), easyv.resolvedScope().values());
        assertEquals(EASYV_ID, easyv.id());
        ArgumentCaptor<ExecutionSnapshot> snapshot = ArgumentCaptor.forClass(ExecutionSnapshot.class);
        verify(executions).completeAtomically(anyString(), anyString(), any(), snapshot.capture(), anyMap());
        assertEquals(easyv.snapshot(), snapshot.getValue().capabilityBinding());
    }

    @Test
    void easyVRetryUsesThePinnedBindingAndRetryFenceWithoutRerouting() {
        AuthSession easyvOwner = new AuthSession("auth-easyv", "123", "用户",
                new AccessScope("org-1", List.of(), List.of(), List.of()), Instant.MAX);
        CapabilityBinding easyv = easyvBinding(easyvOwner, "ontology-v2");
        ExecutionJob retry = new ExecutionJob("easyv-execution", ExecutionRepository.EXECUTION_CONTRACT,
                "session-1", "123", "org-1", List.of(), List.of(), "分析大屏生成质量", "trace-easyv",
                "ontology-v2", easyv, null, null, Map.of(), Map.of(), "worker-easyv", 2, 2);
        OntologyCatalog pinned = new OntologyCatalog("ontology-v2", "2.0.0",
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        CapabilityDescriptor descriptor = easyvDescriptor();
        when(executions.claim(anyString(), any())).thenReturn(Optional.of(retry));
        when(ontologies.published("ontology-v2")).thenReturn(pinned);
        when(capabilities.require(any(), any(), any())).thenReturn(descriptor);
        when(invocations.count("easyv-execution", descriptor.invocationContract().invocationType(),
                descriptor.invocationContract().toolName())).thenReturn(1L);

        assertTrue(worker.runOne("worker-easyv"));

        verify(ontologies).published("ontology-v2");
        verify(ontologies, never()).currentPublished();
        verify(capabilities).require(org.mockito.ArgumentMatchers.eq(easyv), org.mockito.ArgumentMatchers.eq(pinned), any());
        verify(capabilities, never()).selectInitial(anyString());
        verify(capabilities, never()).execute(any(), any());
        verify(executions).failAtomically(anyString(), anyString(), any(), any(),
                org.mockito.ArgumentMatchers.eq("AGENT_EXECUTION_INTERRUPTED"), anyString(),
                org.mockito.ArgumentMatchers.eq("trace-easyv"));
    }

    @Test
    void followUpContractCarriesTheEffectiveTurnIntoAgentAndSnapshot() {
        Map<String, Object> context = Map.of("timeRange",
                Map.of("label", "时间范围", "value", "2026年", "state", "confirmed"));
        ExecutionJob followUp = new ExecutionJob("execution-2",
                ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, "session-1", "user-1", "org-1",
                List.of("project-1"), List.of(), "为什么下降", "trace-2", "ontology-1",
                binding,
                "follow-up-1", "execution-1", Map.of("title", "上一轮结论", "summary", "收缴率下降。"),
                context, "worker-2", 1, 2);
        when(executions.claim(anyString(), any())).thenReturn(Optional.of(followUp));
        when(mainAgent.execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString()))
                .thenReturn(new WorkflowResult(Map.of(
                        "steps", List.of(),
                        "_executionContract", ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT,
                        "_followUpId", "follow-up-1",
                        "_referencedExecutionId", "execution-1",
                        "_resolvedContext", context), requiredEvidence(), "追问结论", claims(), List.of()));
        when(invocations.count("execution-2", "workflow-tool", "analysis_workflow")).thenReturn(1L);

        assertTrue(worker.runOne("worker-2"));

        ArgumentCaptor<AgentTurn> turn = ArgumentCaptor.forClass(AgentTurn.class);
        verify(mainAgent).execute(any(), turn.capture(), org.mockito.ArgumentMatchers.eq("execution-2"), any(),
                org.mockito.ArgumentMatchers.eq("trace-2"), anyString());
        assertTrue(turn.getValue().followUp());
        assertEquals("follow-up-1", turn.getValue().followUpId());
        assertEquals("上一轮结论", turn.getValue().referencedConclusion().get("title"));
        assertEquals(context, turn.getValue().effectiveContext());
        @SuppressWarnings("rawtypes")
        ArgumentCaptor<Map> agentAudit = ArgumentCaptor.forClass(Map.class);
        verify(recorder).startAgentRun(anyString(), anyString(), anyString(), agentAudit.capture(), anyString(), anyString());
        assertEquals("为什么下降", agentAudit.getValue().get("questionText"));
        assertEquals("上一轮结论",
                ((Map<?, ?>) agentAudit.getValue().get("referencedConclusion")).get("title"));
        ArgumentCaptor<ExecutionSnapshot> snapshot = ArgumentCaptor.forClass(ExecutionSnapshot.class);
        verify(executions).completeAtomically(anyString(), anyString(), any(), snapshot.capture(), anyMap());
        assertEquals("follow-up-1", snapshot.getValue().followUpId());
        assertEquals(ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT,
                snapshot.getValue().planSnapshot().get("_executionContract"));
        assertEquals("inherited", snapshot.getValue().ontologyVersionBinding().get("source"));
    }

    private static List<Evidence> requiredEvidence() {
        return List.of(
                new Evidence("erp-staging", "ERP", List.of(Map.of("value", 1))),
                new Evidence("cube", "Cube", List.of(Map.of("value", 1))),
                new Evidence("neo4j", "Neo4j", List.of(Map.of("value", 1))));
    }

    private static List<com.dip3.ontologyagent.tooling.GroundedConclusion.Claim> claims() {
        return List.of(
                claim("collection-rate", "cube"),
                claim("erp-balance", "erp-staging"),
                claim("charge-structure", "neo4j"));
    }

    private static com.dip3.ontologyagent.tooling.GroundedConclusion.Claim claim(String kind, String source) {
        return new com.dip3.ontologyagent.tooling.GroundedConclusion.Claim(kind, "真实结论", List.of(
                new com.dip3.ontologyagent.tooling.GroundedConclusion.EvidenceReference(source, 0, "value", 1)));
    }

    private static WorkflowResult easyvWorkflowResult() {
        List<Evidence> evidence = List.of(
                new Evidence("easyv-ai-application", "应用", List.of(Map.of("count", 1))),
                new Evidence("easyv-pipeline-node", "流水线", List.of(Map.of("count", 1))),
                new Evidence("easyv-forge-task", "Forge", List.of(Map.of("count", 1))),
                new Evidence("easyv-generation-feedback", "反馈", List.of(Map.of("count", 1))));
        List<com.dip3.ontologyagent.tooling.GroundedConclusion.Claim> claims = List.of(
                claim("generation-quality", "easyv-forge-task"),
                claim("stage-bottleneck", "easyv-pipeline-node"),
                claim("failure-concentration", "easyv-forge-task"),
                claim("feedback-association", "easyv-generation-feedback"),
                claim("business-success-settlement-distinct", "easyv-generation-feedback"));
        return new WorkflowResult(Map.of("steps", List.of(), "_executionContract",
                ExecutionRepository.EXECUTION_CONTRACT, "_resolvedContext", Map.of()),
                evidence, "EasyV result", claims, List.of());
    }
}
