package com.dip3.ontologyagent.property.internal.adapter.out.llm;

import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.InvocationEventRecorder;
import com.dip3.ontologyagent.integration.erp.ScopedProjectResolver;
import com.dip3.ontologyagent.integration.erp.ScopedProjectTarget;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.OpenCodeSessionHeader;
import com.dip3.ontologyagent.property.internal.application.AnalysisWorkflow;
import com.dip3.ontologyagent.property.internal.application.MainAgent;
import com.dip3.ontologyagent.property.internal.domain.PropertyInvocationContract;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import com.dip3.ontologyagent.property.internal.adapter.out.llm.WorkflowToolInput;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SpringAiMainAgentTest {
    private final ChatClient.Builder builder = mock(ChatClient.Builder.class);
    private final ChatClient chat = mock(ChatClient.class);
    private final ChatClient.ChatClientRequestSpec prompt = mock(ChatClient.ChatClientRequestSpec.class);
    private final ChatClient.CallResponseSpec response = mock(ChatClient.CallResponseSpec.class);
    private final AnalysisWorkflow workflow = mock(AnalysisWorkflow.class);
    private final InvocationEventRecorder recorder = mock(InvocationEventRecorder.class);
    private final ScopedProjectResolver scopedProjects = mock(ScopedProjectResolver.class);
    private final ChatMemory chatMemory = mock(ChatMemory.class);
    private final AuthSession owner = new AuthSession("auth-1", "user-1", "用户",
            new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")), Instant.MAX);
    private final AnalysisSession session = new AnalysisSession("session-1", "user-1", owner.scope(),
            "分析 2026 年 1 月项目收缴率", Map.of(), "pending", Instant.now(), Instant.now());
    private SpringAiMainAgent agent;

    @BeforeEach
    void setUp() {
        when(builder.build()).thenReturn(chat);
        when(chat.prompt()).thenReturn(prompt);
        when(prompt.options(any(OpenAiChatOptions.Builder.class))).thenReturn(prompt);
        when(prompt.system(anyString())).thenReturn(prompt);
        when(prompt.user(anyString())).thenReturn(prompt);
        when(prompt.call()).thenReturn(response);
        when(response.content()).thenReturn("returnDirect tool result");
        when(recorder.start(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(),
                any(), anyMap(), anyString(), anyString())).thenReturn("workflow-invocation-1");
        when(scopedProjects.targets(any())).thenReturn(List.of(new ScopedProjectTarget("project-1", "项目一")));
        agent = new SpringAiMainAgent(builder, workflow, recorder, scopedProjects,
                new JsonCodec(), chatMemory);
    }

    @Test
    void executesExactlyOneStronglyTypedWorkflowToolCall() {
        WorkflowResult expected = new WorkflowResult(Map.of("steps", List.of()),
                List.of(new Evidence("erp", "ERP", List.of(Map.of("value", 1)))), "结论", List.of(), List.of());
        when(workflow.execute(any(), any(), anyString(), anyString())).thenReturn(expected);
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(toolInput());
            return prompt;
        });

        WorkflowResult actual = agent.execute(owner, session, "execution-1", ontology(), "trace-1", "lease-1");

        assertSame(expected, actual);
        verify(workflow).execute(any(), any(), org.mockito.ArgumentMatchers.eq("trace-1"),
                org.mockito.ArgumentMatchers.eq("workflow-invocation-1"));
        ArgumentCaptor<WorkflowRequest> request = ArgumentCaptor.forClass(WorkflowRequest.class);
        verify(workflow).execute(any(), request.capture(), org.mockito.ArgumentMatchers.eq("trace-1"),
                org.mockito.ArgumentMatchers.eq("workflow-invocation-1"));
        assertNull(request.getValue().datasetVersionSetId());
        ArgumentCaptor<String> toolName = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> invocationType = ArgumentCaptor.forClass(String.class);
        verify(recorder).start(anyString(), anyString(), anyString(), anyString(), toolName.capture(),
                invocationType.capture(), any(), anyMap(), anyString(), anyString());
        assertEquals(PropertyInvocationContract.CONTRACT.toolName(), toolName.getValue());
        assertEquals(PropertyInvocationContract.CONTRACT.invocationType(), invocationType.getValue());
        ArgumentCaptor<OpenAiChatOptions.Builder> options = ArgumentCaptor.forClass(OpenAiChatOptions.Builder.class);
        verify(prompt).options(options.capture());
        assertEquals(Map.of(OpenCodeSessionHeader.NAME, "session-1"),
                options.getValue().build().getCustomHeaders());
        verify(recorder).succeedWhileLeased("workflow-invocation-1",
                Map.of("evidenceCount", 1, "renderBlockCount", 0), "execution-1", "lease-1");
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void propagatesTheBoundDatasetVersionSetToWorkflowAndAudit() {
        WorkflowResult expected = new WorkflowResult(Map.of(),
                List.of(new Evidence("erp", "ERP", List.of(Map.of("value", 1)))), "结论", List.of(), List.of());
        when(workflow.execute(any(), any(), anyString(), anyString())).thenReturn(expected);
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(toolInput());
            return prompt;
        });
        AgentTurn turn = new AgentTurn(ExecutionRepository.EXECUTION_CONTRACT, session.id(),
                session.questionText(), null, null, Map.of(), Map.of(), session.createdAt());

        assertSame(expected, agent.execute(owner, turn, "execution-2", ontology(),
                "dataset-set-1", "trace-2", "lease-2"));

        ArgumentCaptor<WorkflowRequest> request = ArgumentCaptor.forClass(WorkflowRequest.class);
        verify(workflow).execute(any(), request.capture(), org.mockito.ArgumentMatchers.eq("trace-2"),
                org.mockito.ArgumentMatchers.eq("workflow-invocation-1"));
        assertEquals("dataset-set-1", request.getValue().datasetVersionSetId());
        ArgumentCaptor<Map> audit = ArgumentCaptor.forClass(Map.class);
        verify(recorder).start(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(),
                any(), audit.capture(), anyString(), anyString());
        assertEquals("dataset-set-1", audit.getValue().get("datasetVersionSetId"));
    }

    @Test
    void returnDirectToolResultIsAMinimalMemoryProjectionWithoutRawEvidence() {
        WorkflowResult expected = new WorkflowResult(Map.of("secretPlan", "do-not-copy"),
                List.of(new Evidence("erp", "ERP", List.of(Map.of("secretRow", "do-not-copy")))),
                "受控小结论", List.of(), List.of(Map.of("secretBlock", "do-not-copy")));
        when(workflow.execute(any(), any(), anyString(), anyString())).thenReturn(expected);
        AtomicReference<String> directResult = new AtomicReference<>();
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            directResult.set(tool.run(toolInput()));
            return prompt;
        });

        assertSame(expected, agent.execute(owner, session, "execution-1", ontology(), "trace-1", "lease-1"));

        Map<String, Object> memoryProjection = new JsonCodec().map(directResult.get());
        assertEquals(Map.of("status", "completed", "executionId", "execution-1", "conclusion", "受控小结论"),
                memoryProjection);
        org.junit.jupiter.api.Assertions.assertFalse(directResult.get().contains("secretRow"));
        org.junit.jupiter.api.Assertions.assertFalse(directResult.get().contains("secretPlan"));
        org.junit.jupiter.api.Assertions.assertFalse(directResult.get().contains("secretBlock"));
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void followUpUsesSpringAiMemoryAndConfirmedEffectiveContext() {
        Map<String, Object> context = Map.of(
                "entity", Map.of("label", "实体对象", "value", "project-1", "state", "confirmed"),
                "timeRange", Map.of("label", "时间范围", "value", "2026-01-01/2026-01-31", "state", "confirmed"),
                "constraints", List.of(
                        Map.of("label", "实体 business key", "value", "property-project"),
                        Map.of("label", "项目 ID", "value", "project-1")),
                "projectIds", List.of("project-1"), "from", "2026-01-01", "to", "2026-01-31");
        AgentTurn turn = new AgentTurn(ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, "session-1",
                "为什么下降", "follow-up-1", "execution-0", referencedConclusion(), context,
                Instant.parse("2026-02-01T00:00:00Z"));
        WorkflowResult expected = new WorkflowResult(Map.of(),
                List.of(new Evidence("erp", "ERP", List.of(Map.of("value", 1)))), "追问结论", List.of(), List.of());
        when(workflow.execute(any(), any(), anyString(), anyString())).thenReturn(expected);
        when(prompt.advisors(any(org.springframework.ai.chat.client.advisor.api.Advisor[].class))).thenReturn(prompt);
        when(prompt.advisors(any(java.util.function.Consumer.class))).thenReturn(prompt);
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(toolInput());
            return prompt;
        });

        assertSame(expected, agent.execute(owner, turn, "execution-1", ontology(), "trace-1", "lease-1"));

        verify(prompt).advisors(any(org.springframework.ai.chat.client.advisor.api.Advisor[].class));
        verify(prompt).advisors(any(java.util.function.Consumer.class));
        org.mockito.ArgumentCaptor<com.dip3.ontologyagent.property.internal.domain.WorkflowRequest> request =
                org.mockito.ArgumentCaptor.forClass(com.dip3.ontologyagent.property.internal.domain.WorkflowRequest.class);
        verify(workflow).execute(any(), request.capture(), anyString(), anyString());
        assertEquals(ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, request.getValue().executionContract());
        assertEquals("follow-up-1", request.getValue().followUpId());
        assertEquals("为什么下降", request.getValue().questionText());
        assertEquals(referencedConclusion(), request.getValue().referencedConclusion());
        assertEquals(context, request.getValue().effectiveContext());
        @SuppressWarnings("rawtypes")
        org.mockito.ArgumentCaptor<Map> audit = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(recorder).start(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(),
                any(), audit.capture(), anyString(), anyString());
        assertEquals("为什么下降", audit.getValue().get("questionText"));
        assertEquals(referencedConclusion(), audit.getValue().get("referencedConclusion"));
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void frozenFollowUpContextTakesPriorityOverTheOriginalQuestionDateAfterReplan() {
        Map<String, Object> context = Map.of(
                "entity", Map.of("label", "实体对象", "value", "project-1", "state", "confirmed"),
                "constraints", List.of(Map.of("label", "项目 ID", "value", "project-1")),
                "projectIds", List.of("project-1"),
                "from", "2026-02-01", "to", "2026-02-28");
        AgentTurn turn = new AgentTurn(ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, "session-1",
                "再分析 2026 年 1 月收缴率", "follow-up-1", "execution-0", referencedConclusion(), context,
                Instant.parse("2026-03-01T00:00:00Z"));
        WorkflowResult expected = new WorkflowResult(Map.of(),
                List.of(new Evidence("erp", "ERP", List.of(Map.of("value", 1)))), "追问结论", List.of(), List.of());
        when(workflow.execute(any(), any(), anyString(), anyString())).thenReturn(expected);
        when(prompt.advisors(any(org.springframework.ai.chat.client.advisor.api.Advisor[].class))).thenReturn(prompt);
        when(prompt.advisors(any(java.util.function.Consumer.class))).thenReturn(prompt);
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(new WorkflowToolInput("project", "collection-rate", "project-collection-rate",
                    "receivable-accounting-period", List.of("project-1"), LocalDate.parse("2026-02-01"),
                    LocalDate.parse("2026-02-28")));
            return prompt;
        });

        assertSame(expected, agent.execute(owner, turn, "execution-1", ontology(), "trace-1", "lease-1"));

        org.mockito.ArgumentCaptor<com.dip3.ontologyagent.property.internal.domain.WorkflowRequest> request =
                org.mockito.ArgumentCaptor.forClass(com.dip3.ontologyagent.property.internal.domain.WorkflowRequest.class);
        verify(workflow).execute(any(), request.capture(), anyString(), anyString());
        assertEquals(LocalDate.parse("2026-02-01"), request.getValue().from());
        assertEquals(LocalDate.parse("2026-02-28"), request.getValue().to());
    }

    @Test
    void inheritedFollowUpDateRejectsReversedBoundaries() {
        Map<String, Object> context = Map.of("from", "2026-02-28", "to", "2026-02-01");
        AgentTurn turn = new AgentTurn(ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, "session-1",
                "为什么下降", "follow-up-1", "execution-0", referencedConclusion(), context,
                Instant.parse("2026-03-01T00:00:00Z"));

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, turn, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("FOLLOW_UP_CONTEXT_INVALID", error.code());
        verify(chat, never()).prompt();
    }

    @Test
    void rejectsASecondAgentToolCallWithoutASecondWorkflowLoop() {
        when(workflow.execute(any(), any(), anyString(), anyString()))
                .thenReturn(new WorkflowResult(Map.of(), List.of(), "结论", List.of(), List.of()));
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(toolInput());
            tool.run(toolInput());
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, session, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_CONTRACT_VIOLATION", error.code());
        verify(workflow).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void failsWhenTheModelDoesNotCallTheWorkflowTool() {
        when(prompt.tools(any(Object[].class))).thenReturn(prompt);
        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, session, "execution-1", ontology(), "trace-1", "lease-1"));
        assertEquals("AGENT_TOOL_NOT_CALLED", error.code());
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void rejectsAndAuditsIncompleteWorkflowArguments() {
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(new WorkflowToolInput(null, "collection-rate", "project-collection-rate",
                    "receivable-accounting-period", List.of("project-1"), null,
                    LocalDate.parse("2026-01-31")));
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, session, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_INPUT_INVALID", error.code());
        verify(recorder).failWhileLeased("workflow-invocation-1", "AGENT_TOOL_INPUT_INVALID",
                "Workflow 必须提供已批准的实体、父指标、口径、项目范围、时间语义和有效日期范围。",
                "execution-1", "lease-1");
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void workflowAuditFailureIsNeverHiddenBehindTheOriginalValidationError() {
        doThrow(new BackendException("INVOCATION_STATE_CONFLICT", "invocation already terminal"))
                .when(recorder).failWhileLeased(anyString(), anyString(), anyString(), anyString(), anyString());
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(new WorkflowToolInput(null, "collection-rate", "project-collection-rate",
                    "receivable-accounting-period", List.of("project-1"), null,
                    LocalDate.parse("2026-01-31")));
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, session, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("INVOCATION_AUDIT_FAILURE", error.code());
        assertEquals(1, error.getSuppressed().length);
    }

    @Test
    void preservesTheBackendCodeWrappedBySpringToolExecution() {
        when(prompt.tools(any(Object[].class))).thenReturn(prompt);
        when(prompt.call()).thenThrow(new RuntimeException(
                new BackendException("AGENT_TOOL_CONTRACT_VIOLATION", "duplicate")));

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, session, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_CONTRACT_VIOLATION", error.code());
    }

    @Test
    void rejectsToolDatesThatDifferFromTheQuestionRange() {
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(new WorkflowToolInput("project", "collection-rate", "project-collection-rate",
                    "receivable-accounting-period", List.of("project-1"),
                    LocalDate.parse("2026-02-01"), LocalDate.parse("2026-02-28")));
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, session, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_TIME_RANGE_INVALID", error.code());
        verify(recorder).failWhileLeased("workflow-invocation-1", "AGENT_TOOL_TIME_RANGE_INVALID",
                "Workflow 日期必须与问题中确定的时间范围完全一致。", "execution-1", "lease-1");
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void genericQuestionCannotSilentlySelectOneProjectFromAMultiProjectScope() {
        AuthSession multiOwner = new AuthSession("auth-2", "user-1", "用户",
                new AccessScope("org-1", List.of("project-1", "project-2"), List.of(), List.of("analyst")),
                Instant.MAX);
        AnalysisSession multiSession = new AnalysisSession("session-2", "user-1", multiOwner.scope(),
                "分析 2026 年 1 月项目收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(scopedProjects.targets(multiOwner)).thenReturn(List.of(
                new ScopedProjectTarget("project-1", "项目一"), new ScopedProjectTarget("project-2", "项目二")));
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(toolInput());
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(multiOwner, multiSession, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_SCOPE_INVALID", error.code());
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void explicitMultiProjectQuestionAcceptsNaturalConnectors() {
        AuthSession multiOwner = new AuthSession("auth-2", "user-1", "用户",
                new AccessScope("org-1", List.of("project-1", "project-2"), List.of(), List.of("analyst")),
                Instant.MAX);
        AnalysisSession multiSession = new AnalysisSession("session-2", "user-1", multiOwner.scope(),
                "分析项目一和项目二 2026 年 1 月收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(scopedProjects.targets(multiOwner)).thenReturn(List.of(
                new ScopedProjectTarget("project-1", "项目一"), new ScopedProjectTarget("project-2", "项目二")));
        WorkflowResult expected = new WorkflowResult(Map.of(),
                List.of(new Evidence("erp", "ERP", List.of(Map.of("value", 1)))), "结论", List.of(), List.of());
        when(workflow.execute(any(), any(), anyString(), anyString())).thenReturn(expected);
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(new WorkflowToolInput("project", "collection-rate", "project-collection-rate",
                    "receivable-accounting-period", List.of("project-1", "project-2"),
                    LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31")));
            return prompt;
        });

        assertSame(expected, agent.execute(multiOwner, multiSession, "execution-1", ontology(),
                "trace-1", "lease-1"));
    }

    @Test
    void fullScopeQuestionCannotBeSilentlyReducedToOneMentionedProject() {
        AuthSession multiOwner = new AuthSession("auth-2", "user-1", "用户",
                new AccessScope("org-1", List.of("project-1", "project-2"), List.of(), List.of("analyst")),
                Instant.MAX);
        AnalysisSession multiSession = new AnalysisSession("session-2", "user-1", multiOwner.scope(),
                "分析全部项目及项目一 2026 年 1 月收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(scopedProjects.targets(multiOwner)).thenReturn(List.of(
                new ScopedProjectTarget("project-1", "项目一"), new ScopedProjectTarget("project-2", "项目二")));
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(new WorkflowToolInput("project", "collection-rate", "project-collection-rate",
                    "receivable-accounting-period", List.of("project-1"),
                    LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31")));
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(multiOwner, multiSession, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_SCOPE_INVALID", error.code());
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void fullScopeQuestionAcceptsTheDocumentedEmptyProjectSelection() {
        AuthSession multiOwner = new AuthSession("auth-2", "user-1", "用户",
                new AccessScope("org-1", List.of("project-1", "project-2"), List.of(), List.of("analyst")),
                Instant.MAX);
        AnalysisSession multiSession = new AnalysisSession("session-2", "user-1", multiOwner.scope(),
                "分析全部项目 2026 年 1 月收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(scopedProjects.targets(multiOwner)).thenReturn(List.of(
                new ScopedProjectTarget("project-1", "项目一"), new ScopedProjectTarget("project-2", "项目二")));
        WorkflowResult expected = new WorkflowResult(Map.of(),
                List.of(new Evidence("erp", "ERP", List.of(Map.of("value", 1)))), "结论", List.of(), List.of());
        when(workflow.execute(any(), any(), anyString(), anyString())).thenReturn(expected);
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(new WorkflowToolInput("project", "collection-rate", "project-collection-rate",
                    "receivable-accounting-period", List.of(), LocalDate.parse("2026-01-01"),
                    LocalDate.parse("2026-01-31")));
            return prompt;
        });

        assertSame(expected, agent.execute(multiOwner, multiSession, "execution-1", ontology(),
                "trace-1", "lease-1"));
    }

    @Test
    void unknownProjectNameCannotSilentlyExpandToTheFullAuthorizedScope() {
        AuthSession multiOwner = new AuthSession("auth-2", "user-1", "用户",
                new AccessScope("org-1", List.of("project-1", "project-2"), List.of(), List.of("analyst")),
                Instant.MAX);
        AnalysisSession multiSession = new AnalysisSession("session-2", "user-1", multiOwner.scope(),
                "分析项目三 2026 年 1 月收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(scopedProjects.targets(multiOwner)).thenReturn(List.of(
                new ScopedProjectTarget("project-1", "项目一"), new ScopedProjectTarget("project-2", "项目二")));
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(new WorkflowToolInput("project", "collection-rate", "project-collection-rate",
                    "receivable-accounting-period", List.of(), LocalDate.parse("2026-01-01"),
                    LocalDate.parse("2026-01-31")));
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(multiOwner, multiSession, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_SCOPE_INVALID", error.code());
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void unknownProjectNameIsRejectedEvenWhenOnlyOneProjectIsAuthorized() {
        AnalysisSession unknownSession = new AnalysisSession("session-2", "user-1", owner.scope(),
                "分析项目三 2026 年 1 月收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(toolInput());
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, unknownSession, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_SCOPE_INVALID", error.code());
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void unknownProperNameCannotBeBoundToTheOnlyAuthorizedProject() {
        AnalysisSession unknownSession = new AnalysisSession("session-2", "user-1", owner.scope(),
                "分析海悦城 2026 年 1 月收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(toolInput());
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, unknownSession, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_SCOPE_INVALID", error.code());
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void unknownNumericProjectCodeCannotBeMistakenForAQuestionDate() {
        AnalysisSession unknownSession = new AnalysisSession("session-2", "user-1", owner.scope(),
                "分析10030 2026 年 1 月收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(toolInput());
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, unknownSession, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_SCOPE_INVALID", error.code());
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void unauthorizedLongerNameCannotBeMistakenForAnAuthorizedSubstring() {
        AnalysisSession unknownSession = new AnalysisSession("session-2", "user-1", owner.scope(),
                "分析五月花园 2026 年 1 月收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(scopedProjects.targets(owner)).thenReturn(List.of(new ScopedProjectTarget("project-1", "花园")));
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(toolInput());
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, unknownSession, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_SCOPE_INVALID", error.code());
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void longerProjectNameDoesNotAlsoSelectItsSubstringProject() {
        AuthSession multiOwner = new AuthSession("auth-2", "user-1", "用户",
                new AccessScope("org-1", List.of("project-1", "project-2"), List.of(), List.of("analyst")),
                Instant.MAX);
        AnalysisSession multiSession = new AnalysisSession("session-2", "user-1", multiOwner.scope(),
                "分析五月花园 2026 年 1 月收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(scopedProjects.targets(multiOwner)).thenReturn(List.of(
                new ScopedProjectTarget("project-1", "花园"), new ScopedProjectTarget("project-2", "五月花园")));
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(new WorkflowToolInput("project", "collection-rate", "project-collection-rate",
                    "receivable-accounting-period", List.of("project-1", "project-2"),
                    LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31")));
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(multiOwner, multiSession, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_SCOPE_INVALID", error.code());
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    @Test
    void duplicateAuthorizedProjectNamesRequireAnExplicitProjectId() {
        AuthSession multiOwner = new AuthSession("auth-2", "user-1", "用户",
                new AccessScope("org-1", List.of("project-1", "project-2"), List.of(), List.of("analyst")),
                Instant.MAX);
        AnalysisSession multiSession = new AnalysisSession("session-2", "user-1", multiOwner.scope(),
                "分析花园 2026 年 1 月收缴率", Map.of(), "pending", Instant.now(), Instant.now());
        when(scopedProjects.targets(multiOwner)).thenReturn(List.of(
                new ScopedProjectTarget("project-1", "花园"), new ScopedProjectTarget("project-2", "花园")));
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            SpringAiMainAgent.BoundWorkflowTool tool =
                    (SpringAiMainAgent.BoundWorkflowTool) invocation.getArguments()[0];
            tool.run(new WorkflowToolInput("project", "collection-rate", "project-collection-rate",
                    "receivable-accounting-period", List.of("project-1"), LocalDate.parse("2026-01-01"),
                    LocalDate.parse("2026-01-31")));
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(multiOwner, multiSession, "execution-1", ontology(), "trace-1", "lease-1"));

        assertEquals("AGENT_TOOL_SCOPE_INVALID", error.code());
        verify(workflow, never()).execute(any(), any(), anyString(), anyString());
    }

    private static WorkflowToolInput toolInput() {
        return new WorkflowToolInput("project", "collection-rate", "project-collection-rate",
                "receivable-accounting-period", List.of("project-1"), LocalDate.parse("2026-01-01"),
                LocalDate.parse("2026-01-31"));
    }

    private static Map<String, Object> referencedConclusion() {
        return Map.of("title", "上一轮结论", "summary", "上一轮收缴率下降。");
    }

    private static OntologyCatalog ontology() {
        return new OntologyCatalog("ontology-1", "1.0.0", List.of(item("project")),
                List.of(new OntologyCatalog.Item("collection-rate", "collection-rate",
                        Map.of("applicableSubjectKeys", List.of("project"),
                                "defaultAggregation", "ratio", "unit", "%"))),
                List.of(projectCollectionRate(),
                        metricVariant("project-paid-amount", Map.of("cubeMeasure", "FinancePayments.paidAmount")),
                        metricVariant("project-receivable-amount",
                                Map.of("cubeMeasure", "FinanceReceivables.receivableAmount"))),
                List.of(), List.of(receivableAccountingPeriod(), paymentDate()), planSteps(), List.of(
                binding("erp", "erp.read-model", "validate-candidate-factors", "erp-read"),
                binding("cube", "cube.semantic-query", "inspect-metric-change", "semantic-query"),
                binding("neo4j", "neo4j.graph-query", "validate-candidate-factors", "graph-query"),
                binding("llm", "llm.structured-analysis", "synthesize-attribution", "llm-analysis")));
    }

    private static OntologyCatalog.ToolBinding binding(String id, String toolName, String step, String capability) {
        return new OntologyCatalog.ToolBinding(id, toolName, step, capability,
                List.of(Map.of("type", "always", "value", true)), 10);
    }

    private static OntologyCatalog.Item item(String key) {
        return new OntologyCatalog.Item(key, key, Map.of());
    }

    private static OntologyCatalog.Item projectCollectionRate() {
        return metricVariant("project-collection-rate", Map.of(
                "numeratorMetricKey", "project-paid-amount",
                "denominatorMetricKey", "project-receivable-amount",
                "formula", "project-paid-amount / project-receivable-amount * 100"));
    }

    private static OntologyCatalog.Item metricVariant(String key, Map<String, Object> cubeViewMapping) {
        return new OntologyCatalog.Item(key, key, Map.of(
                "parentMetricDefinitionKey", "collection-rate", "semanticDiscriminator", "project-scope",
                "cubeViewMapping", cubeViewMapping));
    }

    private static OntologyCatalog.Item receivableAccountingPeriod() {
        return new OntologyCatalog.Item("receivable-accounting-period", "receivable-accounting-period", Map.of(
                "semanticType", "accounting-period",
                "entityDateFieldMapping", Map.of("receivable", "shouldAccountBook"),
                "cubeTimeDimensionMapping", Map.of("cubeDimension", "FinanceReceivables.receivableAccountingPeriod"),
                "defaultGranularity", "year"));
    }

    private static OntologyCatalog.Item paymentDate() {
        return new OntologyCatalog.Item("payment-date", "payment-date", Map.of(
                "semanticType", "transaction-date",
                "entityDateFieldMapping", Map.of("payment", "operatorDate"),
                "cubeTimeDimensionMapping", Map.of("cubeDimension", "FinancePayments.paymentDate"),
                "defaultGranularity", "month"));
    }

    private static List<OntologyCatalog.Item> planSteps() {
        return List.of(
                planStep("confirm-analysis-scope", 1, List.of("capability-status")),
                planStep("inspect-metric-change", 2, List.of("semantic-query")),
                planStep("validate-candidate-factors", 3, List.of("semantic-query", "graph-query", "erp-read")),
                planStep("synthesize-attribution", 4, List.of("semantic-query", "structured-analysis")));
    }

    private static OntologyCatalog.Item planStep(String key, int order, List<String> capabilities) {
        return new OntologyCatalog.Item(key, key, Map.of("intentTypes", List.of("fee-analysis"),
                "requiredCapabilities", capabilities, "sortOrder", order));
    }
}
