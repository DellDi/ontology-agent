package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.ExecutionProgress;
import com.dip3.ontologyagent.easyv.internal.application.EasyVGenerationWorkflow;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVDateRange;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.execution.InvocationEventRecorder;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatOptions;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EasyVSpringAiMainAgentTest {
    private final ChatClient.Builder builder = mock(ChatClient.Builder.class);
    private final ChatClient chat = mock(ChatClient.class);
    private final ChatClient.ChatClientRequestSpec prompt = mock(ChatClient.ChatClientRequestSpec.class);
    private final ChatClient.CallResponseSpec response = mock(ChatClient.CallResponseSpec.class);
    private final EasyVGenerationWorkflow workflow = mock(EasyVGenerationWorkflow.class);
    private final InvocationEventRecorder recorder = mock(InvocationEventRecorder.class);
    private final AuthSession owner = new AuthSession("auth-1", "2", "用户",
            new AccessScope("org-1", List.of(), List.of(), List.of("EASYV_ANALYST")), Instant.MAX);
    private final Instant anchoredAt = Instant.parse("2026-09-14T04:00:00Z");
    private final AgentTurn turn = new AgentTurn(
            "java-initial-v1", "session-1", "分析本月 EasyV 大屏生成质量",
            null, null, Map.of(), Map.of(), anchoredAt);
    private EasyVSpringAiMainAgent agent;

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
        agent = new EasyVSpringAiMainAgent(builder, workflow, recorder, new JsonCodec());
    }

    private EasyVToolInput validInput() {
        EasyVDateRange range = EasyVDateRange.resolve(turn.questionText(), anchoredAt);
        return new EasyVToolInput(
                EasyVGenerationOntology.ENTITY_KEY,
                EasyVGenerationOntology.METRIC_KEY,
                EasyVGenerationOntology.TIME_KEY,
                range.from(),
                range.to());
    }

    private EasyVToolInput invalidInput() {
        return new EasyVToolInput("wrong-entity", "wrong-metric", "wrong-time",
                java.time.LocalDate.parse("2020-01-01"), java.time.LocalDate.parse("2020-01-31"));
    }

    private static OntologyCatalog ontology() {
        return new OntologyCatalog("easyv-v2", "2.0.0",
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
    }

    @Test
    void executesWorkflowThroughTheSingleAllowedToolCall() {
        WorkflowResult expected = new WorkflowResult(Map.of(), List.of(), "结论", List.of(), List.of());
        when(workflow.execute(any(), any())).thenReturn(expected);
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            EasyVSpringAiMainAgent.BoundTool tool =
                    (EasyVSpringAiMainAgent.BoundTool) invocation.getArguments()[0];
            tool.run(validInput());
            return prompt;
        });

        WorkflowResult actual = agent.execute(owner, turn, "execution-1", ontology(),
                "easyv-set-1", "trace-1", "lease-1", ExecutionProgress.NOOP);

        assertSame(expected, actual);
        verify(workflow, times(1)).execute(any(), any());
    }

    @Test
    void retriesOnceWhenTheModelSubmitsInvalidToolInput() {
        WorkflowResult expected = new WorkflowResult(Map.of(), List.of(), "结论", List.of(), List.of());
        when(workflow.execute(any(), any())).thenReturn(expected);
        AtomicInteger toolsInvocations = new AtomicInteger();
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            EasyVSpringAiMainAgent.BoundTool tool =
                    (EasyVSpringAiMainAgent.BoundTool) invocation.getArguments()[0];
            if (toolsInvocations.getAndIncrement() == 0) {
                // 模拟模型首次传参被严格校验拒绝，异常穿透 .call() 向上抛出
                BackendException rejected = assertThrows(BackendException.class,
                        () -> tool.run(invalidInput()));
                assertEquals("AGENT_TOOL_INPUT_INVALID", rejected.code());
                throw rejected;
            }
            tool.run(validInput());
            return prompt;
        });

        WorkflowResult actual = agent.execute(owner, turn, "execution-1", ontology(),
                "easyv-set-1", "trace-1", "lease-1", ExecutionProgress.NOOP);

        assertSame(expected, actual);
        verify(workflow, times(1)).execute(any(), any());
        assertEquals(2, toolsInvocations.get());
    }

    @Test
    void failsLoudWhenInvalidInputRepeatsOnRetry() {
        AtomicInteger toolsInvocations = new AtomicInteger();
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            EasyVSpringAiMainAgent.BoundTool tool =
                    (EasyVSpringAiMainAgent.BoundTool) invocation.getArguments()[0];
            toolsInvocations.incrementAndGet();
            tool.run(invalidInput());
            return prompt;
        });

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, turn, "execution-1", ontology(),
                        "easyv-set-1", "trace-1", "lease-1", ExecutionProgress.NOOP));

        assertEquals("AGENT_TOOL_INPUT_INVALID", error.code());
        assertEquals(2, toolsInvocations.get());
    }

    @Test
    void failsLoudWhenModelNeverCallsTheTool() {
        when(prompt.tools(any(Object[].class))).thenReturn(prompt);

        BackendException error = assertThrows(BackendException.class,
                () -> agent.execute(owner, turn, "execution-1", ontology(),
                        "easyv-set-1", "trace-1", "lease-1", ExecutionProgress.NOOP));

        assertEquals("AGENT_TOOL_NOT_CALLED", error.code());
        verify(prompt, times(2)).tools(any(Object[].class));
    }

    @Test
    void freeFormQuestionWithoutTimeWordsUsesTheFullDataRange() {
        AgentTurn freeForm = new AgentTurn(
                "java-initial-v1", "session-1", "现在有多少用户了",
                null, null, Map.of(), Map.of(), anchoredAt);
        EasyVToolInput[] captured = new EasyVToolInput[1];
        when(workflow.execute(any(), any())).thenReturn(
                new WorkflowResult(Map.of(), List.of(), "结论", List.of(), List.of()));
        when(prompt.tools(any(Object[].class))).thenAnswer(invocation -> {
            EasyVSpringAiMainAgent.BoundTool tool =
                    (EasyVSpringAiMainAgent.BoundTool) invocation.getArguments()[0];
            EasyVToolInput input = new EasyVToolInput(
                    EasyVGenerationOntology.ENTITY_KEY,
                    EasyVGenerationOntology.METRIC_KEY,
                    EasyVGenerationOntology.TIME_KEY,
                    EasyVDateRange.UNBOUNDED_FROM,
                    java.time.LocalDate.parse("2026-09-14"));
            tool.run(input);
            captured[0] = input;
            return prompt;
        });

        WorkflowResult actual = agent.execute(owner, freeForm, "execution-1", ontology(),
                "easyv-set-1", "trace-1", "lease-1", ExecutionProgress.NOOP);

        assertEquals("结论", actual.conclusion());
        assertEquals(EasyVDateRange.UNBOUNDED_FROM, captured[0].from());
        assertEquals(java.time.LocalDate.parse("2026-09-14"), captured[0].to());
    }
}
