package com.dip3.ontologyagent.property.internal.adapter.out.llm;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.InvocationEventRecorder;
import com.dip3.ontologyagent.integration.erp.ScopedProjectResolver;
import com.dip3.ontologyagent.integration.erp.ScopedProjectTarget;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.OpenCodeSessionHeader;
import com.dip3.ontologyagent.property.internal.application.AnalysisWorkflow;
import com.dip3.ontologyagent.property.internal.application.MainAgent;
import com.dip3.ontologyagent.property.internal.domain.AnalysisRuntimeCapability;
import com.dip3.ontologyagent.property.internal.domain.PropertyInvocationContract;
import com.dip3.ontologyagent.property.internal.domain.QuestionDateRange;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.MessageChatMemoryAdvisor;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.LinkedHashSet;
import java.text.Normalizer;
import java.util.Comparator;

@Component
public final class SpringAiMainAgent implements MainAgent {
    private static final String SYSTEM_PROMPT = """
            你是企业经营分析 Main Agent。你必须且只能调用一次 %s；禁止直接编造结论，
            禁止调用其他工具，禁止在工具返回后进行第二轮推理。所有 entityKey、metricDefinitionKey、
            metricVariantKey、timeSemanticKey 必须逐字选自提供的可执行本体能力，父指标与口径不得混用。
            projectIds 只能是 allowedProjectIds 的子集，空数组表示完整授权范围。日期必须来自 allowedDateRange；追问可使用 effectiveContext 中已确认的上下文，信息不足时让工具参数校验失败，
            from 与 to 必须逐字使用 allowedDateRange，不得猜测日期或不存在的业务 key。
            """.formatted(PropertyInvocationContract.TOOL_NAME);
    private final ChatClient chat;
    private final MessageChatMemoryAdvisor followUpMemory;
    private final AnalysisWorkflow workflow;
    private final InvocationEventRecorder recorder;
    private final ScopedProjectResolver scopedProjects;
    private final JsonCodec json;

    public SpringAiMainAgent(ChatClient.Builder builder, AnalysisWorkflow workflow,
                             InvocationEventRecorder recorder,
                             ScopedProjectResolver scopedProjects, JsonCodec json, ChatMemory chatMemory) {
        this.chat = builder.build();
        this.followUpMemory = MessageChatMemoryAdvisor.builder(chatMemory).build();
        this.workflow = workflow;
        this.recorder = recorder;
        this.scopedProjects = scopedProjects;
        this.json = json;
    }

    @Override
    public WorkflowResult execute(AuthSession owner, AgentTurn turn, String executionId,
                                  OntologyCatalog ontology, String traceId, String leaseOwner) {
        if (blank(leaseOwner)) throw new BackendException("JOB_LEASE_REQUIRED", "Main Agent 必须绑定当前执行租约。");
        QuestionDateRange allowedDateRange = resolveDateRange(turn);
        List<ScopedProjectTarget> allowedProjects = scopedProjects.targets(owner);
        BoundWorkflowTool tool = new BoundWorkflowTool(owner, turn, executionId, ontology, traceId,
                allowedDateRange, allowedProjects, leaseOwner);
        List<OntologyCatalog.Item> entities = AnalysisRuntimeCapability.advertised(ontology.entities(),
                AnalysisRuntimeCapability.ENTITY_KEY);
        List<OntologyCatalog.Item> metrics = AnalysisRuntimeCapability.advertised(ontology.metrics(),
                AnalysisRuntimeCapability.METRIC_DEFINITION_KEY);
        List<OntologyCatalog.Item> variants = AnalysisRuntimeCapability.advertised(ontology.metricVariants(),
                AnalysisRuntimeCapability.METRIC_VARIANT_KEY);
        List<OntologyCatalog.Item> times = AnalysisRuntimeCapability.advertised(ontology.timeSemantics(),
                AnalysisRuntimeCapability.TIME_SEMANTIC_KEY);
        if (entities.isEmpty() || metrics.isEmpty() || variants.isEmpty() || times.isEmpty()) {
            throw new BackendException("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED",
                    "当前本体未提供完整的项目口径收缴率运行语义。");
        }
        try {
            ChatClient.ChatClientRequestSpec prompt = chat.prompt()
                    .options(OpenAiChatOptions.builder()
                            .customHeaders(OpenCodeSessionHeader.forConversation(turn.sessionId())));
            if (turn.followUp()) {
                prompt = prompt.advisors(followUpMemory)
                        .advisors(spec -> spec.param(ChatMemory.CONVERSATION_ID, turn.sessionId()));
            }
            Map<String, Object> agentInput = new LinkedHashMap<>();
            agentInput.put("question", turn.questionText());
            agentInput.put("turnType", turn.followUp() ? "follow-up" : "initial");
            agentInput.put("followUpId", turn.followUpId());
            agentInput.put("referencedExecutionId", turn.referencedExecutionId());
            agentInput.put("referencedConclusion", turn.referencedConclusion());
            agentInput.put("effectiveContext", turn.effectiveContext());
            agentInput.put("ontologyVersionId", ontology.versionId());
            agentInput.put("entities", keys(entities));
            agentInput.put("metricDefinitions", keys(metrics));
            agentInput.put("metricVariants", keys(variants));
            agentInput.put("timeSemantics", keys(times));
            agentInput.put("allowedProjects", allowedProjects);
            agentInput.put("allowedProjectIds", allowedProjects.stream().map(ScopedProjectTarget::id).toList());
            agentInput.put("allowedDateRange", Map.of("from", allowedDateRange.from().toString(),
                    "to", allowedDateRange.to().toString()));
            agentInput.put("allowedTool", PropertyInvocationContract.TOOL_NAME);
            prompt.system(SYSTEM_PROMPT).user(json.write(agentInput)).tools(tool).call().content();
        } catch (BackendException error) {
            throw error;
        } catch (RuntimeException error) {
            BackendException cause = backendCause(error);
            if (cause != null) throw cause;
            throw new BackendException("AGENT_PROVIDER_FAILURE", "Main Agent 模型调用失败。", error);
        }
        WorkflowResult result = tool.result.get();
        if (result == null) {
            throw new BackendException("AGENT_TOOL_NOT_CALLED",
                    "Main Agent 未调用 " + PropertyInvocationContract.TOOL_NAME + "。");
        }
        return result;
    }

    private static List<Map<String, String>> keys(List<OntologyCatalog.Item> items) {
        return items.stream().map(item -> Map.of("businessKey", item.businessKey(),
                "displayName", item.displayName())).toList();
    }

    public final class BoundWorkflowTool {
        private final AuthSession owner;
        private final AgentTurn turn;
        private final String executionId;
        private final OntologyCatalog ontology;
        private final String traceId;
        private final QuestionDateRange allowedDateRange;
        private final List<ScopedProjectTarget> allowedProjects;
        private final String leaseOwner;
        private final AtomicBoolean called = new AtomicBoolean();
        private final AtomicReference<WorkflowResult> result = new AtomicReference<>();

        private BoundWorkflowTool(AuthSession owner, AgentTurn turn, String executionId,
                                  OntologyCatalog ontology, String traceId, QuestionDateRange allowedDateRange,
                                  List<ScopedProjectTarget> allowedProjects, String leaseOwner) {
            this.owner = owner;
            this.turn = turn;
            this.executionId = executionId;
            this.ontology = ontology;
            this.traceId = traceId;
            this.allowedDateRange = allowedDateRange;
            this.allowedProjects = allowedProjects;
            this.leaseOwner = leaseOwner;
        }

        @Tool(name = PropertyInvocationContract.TOOL_NAME, returnDirect = true,
                description = "执行一次确定性分析工作流：校验本体与权限，依次读取 ERP、Cube、Neo4j 证据并生成结论。")
        public String run(WorkflowToolInput input) {
            if (!called.compareAndSet(false, true)) {
                throw new BackendException("AGENT_TOOL_CONTRACT_VIOLATION",
                        PropertyInvocationContract.TOOL_NAME + " 禁止重复调用。");
            }
            Map<String, Object> auditInput = new LinkedHashMap<>();
            if (input != null) {
                auditInput.put("entityKey", input.entityKey());
                auditInput.put("metricDefinitionKey", input.metricDefinitionKey());
                auditInput.put("metricVariantKey", input.metricVariantKey());
                auditInput.put("timeSemanticKey", input.timeSemanticKey());
                auditInput.put("projectIds", input.projectIds());
                auditInput.put("from", input.from() == null ? null : input.from().toString());
                auditInput.put("to", input.to() == null ? null : input.to().toString());
            }
            auditInput.put("ontologyVersionId", ontology.versionId());
            auditInput.put("questionText", turn.questionText());
            auditInput.put("referencedConclusion", turn.referencedConclusion());
            String invocationId = recorder.start(turn.sessionId(), executionId, owner.userId(), "main-agent",
                    PropertyInvocationContract.CONTRACT.toolName(),
                    PropertyInvocationContract.CONTRACT.invocationType(), null, auditInput, traceId, leaseOwner);
            try {
                validate(input, allowedProjects, effectiveScopeText(turn), allowedDateRange);
                WorkflowResult value = workflow.execute(owner,
                        new WorkflowRequest(executionId, turn.sessionId(), ontology.versionId(), turn.questionText(),
                                input.entityKey(),
                                input.metricDefinitionKey(), input.metricVariantKey(), input.timeSemanticKey(),
                                List.copyOf(input.projectIds()), input.from(), input.to(), leaseOwner,
                                turn.contract(), turn.followUpId(), turn.referencedExecutionId(),
                                turn.referencedConclusion(), turn.effectiveContext()),
                        traceId, invocationId);
                recorder.succeedWhileLeased(invocationId, Map.of("evidenceCount", value.evidence().size(),
                        "renderBlockCount", value.renderBlocks().size()), executionId, leaseOwner);
                result.set(value);
                return json.write(Map.of("status", "completed", "executionId", executionId,
                        "conclusion", value.conclusion()));
            } catch (RuntimeException error) {
                String code = error instanceof BackendException known ? known.code() : "WORKFLOW_FAILED";
                try {
                    recorder.failWhileLeased(invocationId, code,
                            error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage(),
                            executionId, leaseOwner);
                } catch (BackendException auditError) {
                    if ("JOB_LEASE_LOST".equals(auditError.code())) {
                        auditError.addSuppressed(error);
                        throw auditError;
                    }
                    throw auditFailure(error, auditError);
                } catch (RuntimeException auditError) {
                    throw auditFailure(error, auditError);
                }
                throw error;
            }
        }
    }

    private static QuestionDateRange resolveDateRange(AgentTurn turn) {
        if (turn.followUp()) {
            return inheritedDateRange(turn,
                    new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问执行缺少已冻结的日期范围。"));
        }
        return QuestionDateRange.resolve(turn.questionText(), turn.anchoredAt());
    }

    private static QuestionDateRange inheritedDateRange(AgentTurn turn, BackendException missingRange) {
        String inherited;
        Object from = turn.effectiveContext().get("from");
        Object to = turn.effectiveContext().get("to");
        if (from instanceof String fromText && !fromText.isBlank()
                && to instanceof String toText && !toText.isBlank()) {
            inherited = fromText + "/" + toText;
        } else {
            inherited = contextFieldValue(turn.effectiveContext(), "timeRange");
        }
        if (blank(inherited)) throw missingRange;
        try {
            QuestionDateRange range = QuestionDateRange.resolve(inherited, turn.anchoredAt());
            if (range.from().isAfter(range.to())) {
                throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问上下文开始日期不能晚于结束日期。");
            }
            return range;
        } catch (BackendException error) {
            if ("FOLLOW_UP_CONTEXT_INVALID".equals(error.code())) throw error;
            throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问上下文中的日期范围无效。", error);
        }
    }

    private static String effectiveScopeText(AgentTurn turn) {
        if (!turn.followUp()) return turn.questionText();
        List<String> values = new java.util.ArrayList<>();
        String entity = contextFieldValue(turn.effectiveContext(), "entity");
        if (!blank(entity)) values.add(entity);
        if (turn.effectiveContext().get("projectIds") instanceof List<?> projectIds) {
            projectIds.stream().filter(String.class::isInstance).map(String.class::cast).forEach(values::add);
        }
        Object constraints = turn.effectiveContext().get("constraints");
        if (constraints instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> constraint) {
                    String label = String.valueOf(constraint.get("label"));
                    Object value = constraint.get("value");
                    if ("项目 ID".equals(label) && value instanceof String text
                            && !text.isBlank()) values.add(text);
                }
            }
        }
        return values.isEmpty() ? turn.questionText() : String.join(" ", values);
    }

    private static String contextFieldValue(Map<String, Object> context, String key) {
        Object field = context.get(key);
        if (!(field instanceof Map<?, ?> values)) return null;
        Object value = values.get("value");
        return value instanceof String text ? text : null;
    }

    private static void validate(WorkflowToolInput input, List<ScopedProjectTarget> allowedProjects,
                                 String question, QuestionDateRange allowedDateRange) {
        if (input == null || blank(input.entityKey()) || blank(input.metricDefinitionKey())
                || blank(input.metricVariantKey()) || blank(input.timeSemanticKey()) || input.projectIds() == null
                || input.from() == null || input.to() == null || input.from().isAfter(input.to())) {
            throw new BackendException("AGENT_TOOL_INPUT_INVALID",
                    "Workflow 必须提供已批准的实体、父指标、口径、项目范围、时间语义和有效日期范围。");
        }
        LinkedHashSet<String> selected = new LinkedHashSet<>(input.projectIds());
        LinkedHashSet<String> allowed = allowedProjects.stream().map(ScopedProjectTarget::id)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        if (selected.size() != input.projectIds().size() || selected.stream().anyMatch(SpringAiMainAgent::blank)
                || !allowed.containsAll(selected)) {
            throw new BackendException("AGENT_TOOL_SCOPE_INVALID", "Workflow projectIds 超出当前授权范围。");
        }
        String normalizedQuestion = Normalizer.normalize(question, Normalizer.Form.NFKC);
        boolean ambiguousName = allowedProjects.stream().collect(java.util.stream.Collectors.groupingBy(
                        ScopedProjectTarget::name, java.util.stream.Collectors.counting()))
                .entrySet().stream().anyMatch(entry -> entry.getValue() > 1
                        && normalizedQuestion.contains(entry.getKey()));
        if (ambiguousName) {
            throw new BackendException("AGENT_TOOL_SCOPE_INVALID", "问题中的项目名称在授权范围内不唯一，请使用项目 ID。");
        }
        String remaining = normalizedQuestion;
        LinkedHashSet<String> mentioned = new LinkedHashSet<>();
        for (ScopedProjectTarget target : allowedProjects.stream()
                .sorted(Comparator.comparingInt((ScopedProjectTarget target) -> target.name().length()).reversed())
                .toList()) {
            if (remaining.contains(target.name())) {
                mentioned.add(target.id());
                remaining = remaining.replace(target.name(), " ");
            }
        }
        for (ScopedProjectTarget target : allowedProjects) {
            if (remaining.contains(target.id())) {
                mentioned.add(target.id());
                remaining = remaining.replace(target.id(), " ");
            }
        }
        boolean fullScope = List.of("全部项目", "所有项目", "全体项目", "各项目", "项目整体", "全范围")
                .stream().anyMatch(normalizedQuestion::contains);
        String unmatchedScope = remaining.replaceAll("[\\s\\u3000]+", "");
        for (String generic : List.of("全部项目", "所有项目", "全体项目", "各项目", "项目整体", "全范围",
                "项目收缴率", "项目收费率", "项目回款率")) {
            unmatchedScope = unmatchedScope.replace(generic, "");
        }
        boolean unknownScope = List.of("项目", "小区", "花园", "园区").stream().anyMatch(unmatchedScope::contains)
                || hasUnknownQuestionText(remaining);
        boolean selectedFullScope = selected.isEmpty() || selected.equals(allowed);
        if (unknownScope || fullScope && !selectedFullScope
                || !fullScope && !mentioned.isEmpty() && !selected.equals(mentioned)
                || !fullScope && mentioned.isEmpty() && allowed.size() > 1) {
            throw new BackendException("AGENT_TOOL_SCOPE_INVALID", "Workflow projectIds 与问题中明确的项目范围不一致。");
        }
        if (!allowedDateRange.from().equals(input.from()) || !allowedDateRange.to().equals(input.to())) {
            throw new BackendException("AGENT_TOOL_TIME_RANGE_INVALID",
                    "Workflow 日期必须与问题中确定的时间范围完全一致。");
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static boolean hasUnknownQuestionText(String questionWithoutAuthorizedTargets) {
        String residue = questionWithoutAuthorizedTargets.replaceAll("[\\s\\u3000]+", "");
        residue = residue.replaceAll("(?<!\\d)\\d{4}-\\d{2}-\\d{2}(?!\\d)", "");
        residue = residue.replaceAll("(?<!\\d)\\d{4}年\\d{1,2}月", "");
        residue = residue.replaceAll("(?<!\\d)\\d{4}年", "");
        for (String phrase : List.of("全部项目", "所有项目", "全体项目", "各项目", "项目整体", "全范围",
                "项目收缴率", "项目收费率", "项目回款率", "收缴率", "收费率", "回款率", "应收账期",
                "帮我分析", "请分析", "分析一下", "帮忙分析", "分析", "查询", "统计", "查看", "计算",
                "看看", "一下", "情况", "数据", "结果", "指标", "本月", "上月", "今年", "去年",
                "基于", "按照", "以及", "和", "与", "跟", "及", "按", "在", "的")) {
            residue = residue.replace(phrase, "");
        }
        residue = residue.replaceAll("[年月日号至到从起止截至范围区间\\-/:,.，。、?？()（）]", "");
        return residue.matches("(?s).*[\\p{L}\\p{N}].*");
    }

    private static BackendException backendCause(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof BackendException known) return known;
            current = current.getCause();
        }
        return null;
    }

    private static BackendException auditFailure(RuntimeException original, RuntimeException auditError) {
        BackendException failure = new BackendException("INVOCATION_AUDIT_FAILURE",
                "Workflow Tool 失败后，Agent invocation 审计写入失败。", auditError);
        failure.addSuppressed(original);
        return failure;
    }
}
