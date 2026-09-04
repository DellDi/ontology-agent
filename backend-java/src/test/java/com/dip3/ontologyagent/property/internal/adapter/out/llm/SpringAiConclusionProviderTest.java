package com.dip3.ontologyagent.property.internal.adapter.out.llm;

import com.dip3.ontologyagent.config.ProviderCapabilityProperties;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.OpenCodeSessionHeader;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.api.Advisor;
import org.springframework.ai.openai.OpenAiChatOptions;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

class SpringAiConclusionProviderTest {
    private final ChatClient.Builder builder = mock(ChatClient.Builder.class);
    private final ChatClient chat = mock(ChatClient.class);
    private final ChatClient.ChatClientRequestSpec prompt = mock(ChatClient.ChatClientRequestSpec.class);
    private final ChatClient.CallResponseSpec response = mock(ChatClient.CallResponseSpec.class);
    private SpringAiConclusionProvider provider;

    @BeforeEach
    void setUp() {
        when(builder.build()).thenReturn(chat);
        when(chat.prompt()).thenReturn(prompt);
        when(prompt.options(any(OpenAiChatOptions.Builder.class))).thenReturn(prompt);
        when(prompt.system(anyString())).thenReturn(prompt);
        when(prompt.user(anyString())).thenReturn(prompt);
        when(prompt.advisors(any(Advisor[].class))).thenReturn(prompt);
        when(prompt.call()).thenReturn(response);
        provider = new SpringAiConclusionProvider(builder, new JsonCodec());
    }

    @Test
    void acceptsOnlyAConclusionGroundedInEveryActualEvidenceSource() {
        when(response.entity(eq(SpringAiConclusionProvider.ConclusionDraft.class), any()))
                .thenReturn(validDraft());

        var conclusion = provider.conclude(request(), evidence());
        assertEquals("授权项目范围收缴率为 1%。\n\n"
                        + "ERP 证据显示项目一应收金额为 1000，实收金额为 800，欠费金额为 200。\n\n"
                        + "Neo4j 证据显示项目一的 has-receivable 事实与收费项目物业费存在 belongs-to 结构关系。",
                conclusion.text());
        assertEquals(List.of("collection-rate", "erp-balance", "charge-structure"),
                conclusion.claims().stream().map(com.dip3.ontologyagent.tooling.GroundedConclusion.Claim::kind)
                        .toList());
        verify(response, times(1)).entity(eq(SpringAiConclusionProvider.ConclusionDraft.class), any());
        verify(response, never()).content();
        org.mockito.ArgumentCaptor<OpenAiChatOptions.Builder> options =
                org.mockito.ArgumentCaptor.forClass(OpenAiChatOptions.Builder.class);
        verify(prompt).options(options.capture());
        assertEquals(Map.of(OpenCodeSessionHeader.NAME, "session-1"),
                options.getValue().build().getCustomHeaders());
    }

    @Test
    void rejectsAConclusionThatOmitsAnEvidenceSource() {
        when(response.entity(eq(SpringAiConclusionProvider.ConclusionDraft.class), any()))
                .thenReturn(new SpringAiConclusionProvider.ConclusionDraft(validDraft().claims().subList(0, 2)));

        BackendException error = assertThrows(BackendException.class,
                () -> provider.conclude(request(), evidence()));
        assertEquals("PROVIDER_EVIDENCE_UNGROUNDED", error.code());
    }

    @Test
    void rejectsMarkdownOrMalformedProviderOutput() {
        when(response.entity(eq(SpringAiConclusionProvider.ConclusionDraft.class), any())).thenReturn(null);

        BackendException error = assertThrows(BackendException.class,
                () -> provider.conclude(request(), evidence()));
        assertEquals("PROVIDER_RESPONSE_INVALID", error.code());
    }

    @Test
    void rejectsFreeTextAndReferencesThatDoNotMatchTheRequiredFactShape() {
        SpringAiConclusionProvider.ConclusionDraft invalidKind = new SpringAiConclusionProvider.ConclusionDraft(
                List.of(new SpringAiConclusionProvider.ClaimDraft("free-text", List.of())));
        when(response.entity(eq(SpringAiConclusionProvider.ConclusionDraft.class), any())).thenReturn(invalidKind);
        assertEquals("PROVIDER_RESPONSE_INVALID", assertThrows(BackendException.class,
                () -> provider.conclude(request(), evidence())).code());

        var claims = new java.util.ArrayList<>(validDraft().claims());
        claims.set(0, new SpringAiConclusionProvider.ClaimDraft("collection-rate", List.of(
                new SpringAiConclusionProvider.EvidenceReferenceDraft("cube", 0, "value", 99))));
        when(response.entity(eq(SpringAiConclusionProvider.ConclusionDraft.class), any()))
                .thenReturn(new SpringAiConclusionProvider.ConclusionDraft(claims));
        assertEquals("PROVIDER_EVIDENCE_UNGROUNDED", assertThrows(BackendException.class,
                () -> provider.conclude(request(), evidence())).code());
    }

    @Test
    void followUpQuestionAndReferencedConclusionReachTheProviderWithoutBecomingEvidence() {
        when(response.entity(eq(SpringAiConclusionProvider.ConclusionDraft.class), any()))
                .thenReturn(validDraft());
        org.mockito.ArgumentCaptor<String> userInput = org.mockito.ArgumentCaptor.forClass(String.class);

        provider.conclude(followUpRequest(), evidence());

        verify(prompt).user(userInput.capture());
        Map<String, Object> input = new JsonCodec().map(userInput.getValue());
        assertEquals("为什么本轮仍下降", input.get("questionText"));
        assertEquals(Map.of("title", "上一轮结论", "summary", "上一轮收缴率下降。"),
                input.get("referencedConclusion"));
        assertEquals(3, ((List<?>) input.get("evidence")).size());
    }

    @Test
    void dashScopeUsesJsonObjectWithoutClaimingNativeJsonSchemaSupport() {
        when(response.entity(SpringAiConclusionProvider.ConclusionDraft.class)).thenReturn(validDraft());
        provider = new SpringAiConclusionProvider(builder, new JsonCodec(), new ProviderCapabilityProperties(
                ProviderCapabilityProperties.Mode.DASHSCOPE, true,
                ProviderCapabilityProperties.StructuredOutput.JSON_OBJECT));

        provider.conclude(request(), evidence());

        verify(prompt).options(any(OpenAiChatOptions.Builder.class));
        verify(response).entity(SpringAiConclusionProvider.ConclusionDraft.class);
        verify(response, never()).entity(eq(SpringAiConclusionProvider.ConclusionDraft.class), any());
        verify(response, never()).content();
    }

    private static WorkflowRequest request() {
        return new WorkflowRequest("execution-1", "session-1", "ontology-1", "project", "collection-rate",
                "project-collection-rate", "receivable-accounting-period", List.of("project-1"),
                LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31"), "lease-1");
    }

    private static WorkflowRequest followUpRequest() {
        return new WorkflowRequest("execution-2", "session-1", "ontology-1", "为什么本轮仍下降",
                "project", "collection-rate", "project-collection-rate", "receivable-accounting-period",
                List.of("project-1"), LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31"),
                "lease-1", com.dip3.ontologyagent.execution.ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT,
                "follow-up-1", "execution-1", Map.of("title", "上一轮结论", "summary", "上一轮收缴率下降。"),
                Map.of());
    }

    private static List<Evidence> evidence() {
        return List.of(new Evidence("erp-staging", "ERP", List.of(Map.of(
                        "projectName", "项目一", "receivableAmount", 1000,
                        "paidAmount", 800, "arrearsAmount", 200))),
                new Evidence("cube", "Cube", List.of(Map.of("value", 1))),
                new Evidence("neo4j", "Neo4j", List.of(Map.of(
                        "rootLabel", "项目一", "factorLabel", "物业费", "factType", "has-receivable",
                        "relationType", "belongs-to"))));
    }

    private static SpringAiConclusionProvider.ConclusionDraft validDraft() {
        return new SpringAiConclusionProvider.ConclusionDraft(List.of(
                claim("collection-rate", ref("cube", "value", 1)),
                claim("erp-balance", ref("erp-staging", "projectName", "项目一"),
                        ref("erp-staging", "receivableAmount", 1000), ref("erp-staging", "paidAmount", 800),
                        ref("erp-staging", "arrearsAmount", 200)),
                claim("charge-structure", ref("neo4j", "rootLabel", "项目一"),
                        ref("neo4j", "factorLabel", "物业费"), ref("neo4j", "factType", "has-receivable"),
                        ref("neo4j", "relationType", "belongs-to"))));
    }

    private static SpringAiConclusionProvider.ClaimDraft claim(String kind,
            SpringAiConclusionProvider.EvidenceReferenceDraft... refs) {
        return new SpringAiConclusionProvider.ClaimDraft(kind, List.of(refs));
    }

    private static SpringAiConclusionProvider.EvidenceReferenceDraft ref(String source, String field, Object value) {
        return new SpringAiConclusionProvider.EvidenceReferenceDraft(source, 0, field, value);
    }
}
