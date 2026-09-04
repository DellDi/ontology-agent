package com.dip3.ontologyagent.integration;

import com.dip3.ontologyagent.property.internal.application.MainAgent;
import com.dip3.ontologyagent.property.internal.domain.QuestionDateRange;
import com.dip3.ontologyagent.property.internal.adapter.out.llm.SpringAiMainAgent;
import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.analysis.AnalysisSessionRepository;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.config.ProviderCapabilityProperties;
import com.dip3.ontologyagent.execution.AgentInvocationRepository;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import com.dip3.ontologyagent.property.internal.adapter.out.llm.WorkflowToolInput;
import org.junit.jupiter.api.Test;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static com.dip3.ontologyagent.support.CapabilityTestFixtures.propertyBinding;

@SpringBootTest(properties = {
        "dip3.worker.enabled=false",
        "spring.main.web-application-type=none"
})
@ContextConfiguration(initializers = LiveProviderIT.RequiredEnvironment.class)
class LiveProviderIT {
    private static final List<String> REQUIRED_ENVIRONMENT = List.of(
            "REDIS_URL", "LLM_PROVIDER_BASE_URL", "LLM_PROVIDER_API_KEY", "LLM_PROVIDER_MODEL",
            "LLM_PROVIDER_MODE", "LLM_PROVIDER_TOOL_CALLING", "LLM_PROVIDER_STRUCTURED_OUTPUT",
            "SESSION_SECRET", "CUBE_API_URL", "CUBE_API_SECRET", "NEO4J_URI", "NEO4J_USERNAME",
            "NEO4J_PASSWORD", "LIVE_USER_ID", "LIVE_ORGANIZATION_ID", "LIVE_PROJECT_IDS",
            "LIVE_ONTOLOGY_VERSION_ID", "LIVE_ENTITY_KEY", "LIVE_METRIC_DEFINITION_KEY",
            "LIVE_METRIC_VARIANT_KEY", "LIVE_TIME_SEMANTIC_KEY", "LIVE_FROM", "LIVE_TO", "LIVE_QUESTION");

    private final MainAgent mainAgent;
    private final OntologyRepository ontologies;
    private final AgentInvocationRepository invocations;
    private final AnalysisSessionRepository sessions;
    private final ExecutionRepository executions;
    private final ProviderCapabilityProperties provider;
    private final OpenAiChatModel chatModel;

    @Autowired
    LiveProviderIT(MainAgent mainAgent, OntologyRepository ontologies, AgentInvocationRepository invocations,
                   AnalysisSessionRepository sessions, ExecutionRepository executions,
                   ProviderCapabilityProperties provider, OpenAiChatModel chatModel) {
        this.mainAgent = mainAgent;
        this.ontologies = ontologies;
        this.invocations = invocations;
        this.sessions = sessions;
        this.executions = executions;
        this.provider = provider;
        this.chatModel = chatModel;
    }

    @Test
    @Transactional
    void realMainAgentCallsTheWorkflowExactlyOnceWithGovernedParameters() throws NoSuchMethodException {
        Tool workflowTool = SpringAiMainAgent.BoundWorkflowTool.class
                .getMethod("run", WorkflowToolInput.class).getAnnotation(Tool.class);
        assertAll(
                () -> assertEquals(ProviderCapabilityProperties.Mode.DASHSCOPE, provider.mode(),
                        "该门禁专门证明 DashScope，不接受其他 OpenAI-compatible Provider 代跑"),
                () -> assertEquals(ProviderCapabilityProperties.StructuredOutput.JSON_OBJECT,
                        provider.structuredOutput()),
                () -> assertTrue(provider.toolCalling()),
                () -> assertEquals(0, chatModel.getOptions().getMaxRetries(), "真实 ChatModel 必须零重试"),
                () -> assertEquals(Boolean.FALSE, chatModel.getOptions().getParallelToolCalls()),
                () -> assertNotNull(workflowTool),
                () -> assertTrue(workflowTool.returnDirect(), "analysis_workflow 必须保持 returnDirect")
        );
        Instant now = Instant.now();
        AuthSession owner = new AuthSession("live", required("LIVE_USER_ID"), "live-integration",
                new AccessScope(required("LIVE_ORGANIZATION_ID"), csv("LIVE_PROJECT_IDS"), List.of(),
                        List.of("analyst")), Instant.now().plusSeconds(300));
        AnalysisSession session = sessions.create(owner, required("LIVE_QUESTION"), Map.of());
        QuestionDateRange questionRange = QuestionDateRange.resolve(session.questionText(), session.createdAt());
        assertEquals(LocalDate.parse(required("LIVE_FROM")), questionRange.from(),
                "LIVE_QUESTION 必须明确表达 LIVE_FROM/LIVE_TO 的完整自然月范围");
        assertEquals(LocalDate.parse(required("LIVE_TO")), questionRange.to(),
                "LIVE_QUESTION 必须明确表达 LIVE_FROM/LIVE_TO 的完整自然月范围");
        var ontology = ontologies.currentPublished();
        assertEquals(required("LIVE_ONTOLOGY_VERSION_ID"), ontology.versionId());
        String traceId = "live-trace-" + UUID.randomUUID();
        String executionId = executions.submit(session, "live-" + UUID.randomUUID(), traceId,
                propertyBinding(owner, ontology.versionId())).executionId();
        var claimed = executions.claim("live-worker:" + UUID.randomUUID(), Duration.ofMinutes(5)).orElseThrow();

        WorkflowResult result = mainAgent.execute(owner, session, executionId, ontology,
                traceId, claimed.workerId());

        assertAll(
                () -> assertEquals(List.of("erp-staging", "cube", "neo4j"),
                        result.evidence().stream().map(item -> item.source()).toList()),
                () -> assertFalse(result.evidence().get(0).rows().isEmpty(), "ERP 必须返回真实范围内证据"),
                () -> assertFalse(result.evidence().get(1).rows().isEmpty(), "Cube 必须返回真实语义指标"),
                () -> assertFalse(result.evidence().get(2).rows().isEmpty(), "Neo4j 必须返回真实关系证据"),
                () -> assertFalse(result.conclusion().isBlank(), "模型必须基于已取得证据返回结论"),
                () -> assertEquals(1, invocations.count(executionId, "workflow-tool", "analysis_workflow")),
                () -> assertEquals(1,
                        invocations.count(executionId, "subtool", "llm.structured-analysis")),
                () -> assertGroundedConclusion(result)
        );

        Map<String, Object> input = invocations.singleInput(executionId, "workflow-tool", "analysis_workflow");
        assertAll(
                () -> assertEquals(required("LIVE_ENTITY_KEY"), input.get("entityKey")),
                () -> assertEquals(required("LIVE_METRIC_DEFINITION_KEY"), input.get("metricDefinitionKey")),
                () -> assertEquals(required("LIVE_METRIC_VARIANT_KEY"), input.get("metricVariantKey")),
                () -> assertEquals(required("LIVE_TIME_SEMANTIC_KEY"), input.get("timeSemanticKey")),
                () -> assertEquals(LocalDate.parse(required("LIVE_FROM")).toString(), input.get("from")),
                () -> assertEquals(LocalDate.parse(required("LIVE_TO")).toString(), input.get("to"))
        );
    }

    private static void assertGroundedConclusion(WorkflowResult result) {
        assertEquals(3, result.claims().size(), "必须返回三类受控 claim");
        assertEquals(result.claims().stream().map(GroundedConclusion.Claim::text)
                .collect(Collectors.joining("\n\n")), result.conclusion(), "最终结论只能由结构化 claims 生成");
        Map<String, Evidence> evidenceBySource = result.evidence().stream()
                .collect(Collectors.toMap(Evidence::source, item -> item));
        Map<String, Set<String>> referencedFields = new HashMap<>();
        for (GroundedConclusion.Claim claim : result.claims()) {
            assertFalse(claim.evidenceRefs().isEmpty(), "每条 claim 必须引用真实 evidence");
            Set<String> claimSources = new HashSet<>();
            for (GroundedConclusion.EvidenceReference reference : claim.evidenceRefs()) {
                Evidence evidence = evidenceBySource.get(reference.source());
                assertNotNull(evidence, "claim 引用了不存在的 evidence source");
                assertTrue(reference.row() >= 0 && reference.row() < evidence.rows().size(),
                        "claim 引用了不存在的 evidence row");
                assertTrue(evidence.rows().get(reference.row()).containsKey(reference.field()),
                        "claim 引用了不存在的 evidence field");
                assertSameValue(evidence.rows().get(reference.row()).get(reference.field()), reference.value());
                claimSources.add(reference.source());
                referencedFields.computeIfAbsent(reference.source(), ignored -> new HashSet<>())
                        .add(reference.field());
            }
            assertEquals(1, claimSources.size(), "单条 claim 不得混用证据源");
        }
        assertEquals(Map.of(
                "cube", Set.of("value"),
                "erp-staging", Set.of("projectName", "receivableAmount", "paidAmount", "arrearsAmount"),
                "neo4j", Set.of("rootLabel", "factorLabel", "factType", "relationType")
        ), referencedFields, "三类 claim 必须完整引用治理规定的事实字段");
    }

    private static void assertSameValue(Object actual, Object claimed) {
        if (actual instanceof Number left && claimed instanceof Number right) {
            assertEquals(0, new BigDecimal(left.toString()).compareTo(new BigDecimal(right.toString())),
                    "claim 数值必须等于真实 evidence");
        } else {
            assertEquals(actual, claimed, "claim 值必须等于真实 evidence");
        }
    }

    private static List<String> csv(String name) {
        return Arrays.stream(required(name).split(","))
                .map(String::trim).filter(value -> !value.isEmpty()).toList();
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("真实集成验证缺少环境变量 " + name);
        }
        return value.trim();
    }

    public static final class RequiredEnvironment
            implements ApplicationContextInitializer<ConfigurableApplicationContext> {
        @Override
        public void initialize(ConfigurableApplicationContext context) {
            List<String> missing = new ArrayList<>(REQUIRED_ENVIRONMENT.stream()
                    .filter(name -> !configured(name)).toList());
            boolean explicitDatabase = configured("JAVA_DATABASE_URL")
                    && configured("JAVA_DATABASE_USERNAME") && configured("JAVA_DATABASE_PASSWORD");
            boolean composedDatabase = configured("POSTGRES_PORT") && configured("POSTGRES_DB")
                    && configured("POSTGRES_USER") && configured("POSTGRES_PASSWORD");
            if (!explicitDatabase && !composedDatabase) {
                missing.add("JAVA_DATABASE_URL/JAVA_DATABASE_USERNAME/JAVA_DATABASE_PASSWORD "
                        + "或 POSTGRES_PORT/POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD");
            }
            if (!missing.isEmpty()) {
                throw new IllegalStateException("Live integration is missing environment variables: "
                        + String.join(", ", missing));
            }
        }

        private static boolean configured(String name) {
            String value = System.getenv(name);
            return value != null && !value.isBlank();
        }
    }
}
