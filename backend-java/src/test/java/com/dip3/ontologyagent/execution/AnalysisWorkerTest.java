package com.dip3.ontologyagent.execution;

import com.dip3.ontologyagent.agent.MainAgent;
import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.analysis.AnalysisSessionRepository;
import com.dip3.ontologyagent.auth.AccessScope;
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

class AnalysisWorkerTest {
    private final ExecutionRepository executions = mock(ExecutionRepository.class);
    private final AnalysisSessionRepository sessions = mock(AnalysisSessionRepository.class);
    private final OntologyRepository ontologies = mock(OntologyRepository.class);
    private final MainAgent mainAgent = mock(MainAgent.class);
    private final AgentInvocationRepository invocations = mock(AgentInvocationRepository.class);
    private final InvocationEventRecorder recorder = mock(InvocationEventRecorder.class);
    private final ExecutionJob job = new ExecutionJob("execution-1", "session-1", "user-1", "org-1",
            List.of("project-1"), List.of(), "分析收缴率", "trace-1", "ontology-1", "worker-1", 1, 2);
    private final AnalysisSession session = new AnalysisSession("session-1", "user-1",
            new AccessScope("org-1", List.of("project-1"), List.of(), List.of()), "分析收缴率",
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
        worker = new AnalysisWorker(executions, sessions, ontologies, mainAgent, invocations, recorder);
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
        ArgumentCaptor<ExecutionSnapshot> snapshot = ArgumentCaptor.forClass(ExecutionSnapshot.class);
        @SuppressWarnings("rawtypes")
        ArgumentCaptor<Map> result = ArgumentCaptor.forClass(Map.class);
        verify(executions).completeAtomically(anyString(), anyString(), any(), snapshot.capture(),
                result.capture());
        assertEquals("completed", snapshot.getValue().status());
        assertEquals("grounded-context", snapshot.getValue().ontologyVersionBinding().get("source"));
        assertEquals(3, ((List<?>) snapshot.getValue().conclusionState().get("evidence")).size());
        assertEquals(1L, result.getValue().get("workflowInvocations"));
        assertEquals("ontology-1", result.getValue().get("ontologyVersionId"));
        assertEquals(List.of("erp-staging", "cube", "neo4j"), result.getValue().get("evidenceSources"));
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
    }

    @Test
    void providerFailureIsPersistedAndNeverMarkedCompleted() {
        when(mainAgent.execute(any(), any(AgentTurn.class), anyString(), any(), anyString(), anyString()))
                .thenThrow(new BackendException("CUBE_PROVIDER_FAILURE", "Cube failed"));

        assertTrue(worker.runOne("worker-1"));

        verify(executions, never()).completeAtomically(anyString(), anyString(), any(), any(), anyMap());
        ArgumentCaptor<ExecutionEvent> terminal = ArgumentCaptor.forClass(ExecutionEvent.class);
        verify(executions).failAtomically(anyString(), anyString(), terminal.capture(), any(),
                org.mockito.ArgumentMatchers.eq("CUBE_PROVIDER_FAILURE"),
                org.mockito.ArgumentMatchers.eq("Cube failed"), org.mockito.ArgumentMatchers.eq("trace-1"));
        assertEquals("CUBE_PROVIDER_FAILURE", terminal.getValue().errorCode());
        assertEquals("trace-1", terminal.getValue().traceId());
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
        ExecutionJob retry = new ExecutionJob("execution-1", "session-1", "user-1", "org-1",
                List.of("project-1"), List.of(), "分析收缴率", "trace-1", "ontology-1", "worker-2", 2, 2);
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
    void followUpContractCarriesTheEffectiveTurnIntoAgentAndSnapshot() {
        Map<String, Object> context = Map.of("timeRange",
                Map.of("label", "时间范围", "value", "2026年", "state", "confirmed"));
        ExecutionJob followUp = new ExecutionJob("execution-2",
                ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, "session-1", "user-1", "org-1",
                List.of("project-1"), List.of(), "为什么下降", "trace-2", "ontology-1",
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
        return List.of(new com.dip3.ontologyagent.tooling.GroundedConclusion.Claim("真实结论", List.of(
                new com.dip3.ontologyagent.tooling.GroundedConclusion.EvidenceReference("cube", 0, "value", 1))));
    }
}
