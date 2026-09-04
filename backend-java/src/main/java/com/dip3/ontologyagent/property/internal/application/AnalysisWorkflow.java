package com.dip3.ontologyagent.property.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.ExecutionEvent;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.InvocationEventRecorder;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.property.internal.domain.AnalysisRuntimeCapability;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

@Service
public final class AnalysisWorkflow {
    private final OntologyRepository ontologies;
    private final EvidenceProvider erp;
    private final EvidenceProvider cube;
    private final EvidenceProvider graph;
    private final ConclusionProvider conclusions;
    private final InvocationEventRecorder recorder;
    private final ExecutionRepository executions;

    public AnalysisWorkflow(OntologyRepository ontologies,
                            @Qualifier("erpEvidenceProvider") EvidenceProvider erp,
                            @Qualifier("cubeEvidenceProvider") EvidenceProvider cube,
                            @Qualifier("graphEvidenceProvider") EvidenceProvider graph,
                            ConclusionProvider conclusions,
                            ExecutionRepository executions, InvocationEventRecorder recorder) {
        this.ontologies = ontologies;
        this.erp = erp;
        this.cube = cube;
        this.graph = graph;
        this.conclusions = conclusions;
        this.executions = executions;
        this.recorder = recorder;
    }

    public WorkflowResult execute(AuthSession owner, WorkflowRequest request, String traceId, String parentInvocationId) {
        fence(request);
        OntologyCatalog ontology = ontologies.published(request.ontologyVersionId());
        validateGrounding(request, ontology);
        Map<String, OntologyCatalog.Item> planSteps = validatePlanSteps(ontology);
        Map<String, String> toolBindings = selectTools(ontology, request);
        Map<String, Object> plan = plan(request, toolBindings, planSteps);
        Evidence cubeEvidence = callTool(owner, request, traceId, parentInvocationId, "cube.semantic-query",
                toolBindings.get("cube.semantic-query"),
                () -> cube.collect(owner, request));
        Evidence erpEvidence = callTool(owner, request, traceId, parentInvocationId, "erp.read-model",
                toolBindings.get("erp.read-model"),
                () -> erp.collect(owner, request));
        Evidence graphEvidence = callTool(owner, request, traceId, parentInvocationId, "neo4j.graph-query",
                toolBindings.get("neo4j.graph-query"),
                () -> graph.collect(owner, request));
        List<Evidence> evidence = List.of(erpEvidence, cubeEvidence, graphEvidence);
        List<String> emptySources = evidence.stream().filter(item -> item.rows().isEmpty())
                .map(Evidence::source).toList();
        if (!emptySources.isEmpty()) {
            throw new BackendException("ANALYSIS_EVIDENCE_EMPTY",
                    "分析所需数据源未返回证据: " + String.join(", ", emptySources));
        }
        validateRequestedFactors(request, graphEvidence);
        validateEvidenceConsistency(erpEvidence, cubeEvidence);
        GroundedConclusion conclusion = callConclusion(owner, request, evidence, traceId, parentInvocationId,
                toolBindings.get("llm.structured-analysis"));
        List<Map<String, Object>> blocks = renderBlocks(evidence, conclusion.text());
        return new WorkflowResult(plan, List.copyOf(evidence), conclusion.text(), conclusion.claims(), blocks);
    }

    public static void validateCatalog(OntologyCatalog ontology) {
        WorkflowRequest request = new WorkflowRequest("publish-validation", "publish-validation",
                ontology.versionId(), AnalysisRuntimeCapability.ENTITY_KEY,
                AnalysisRuntimeCapability.METRIC_DEFINITION_KEY,
                AnalysisRuntimeCapability.METRIC_VARIANT_KEY,
                AnalysisRuntimeCapability.TIME_SEMANTIC_KEY, List.of("publish-validation-project"),
                java.time.LocalDate.of(2026, 1, 1), java.time.LocalDate.of(2026, 12, 31),
                "publish-validation");
        validateGrounding(request, ontology);
        validatePlanSteps(ontology);
        selectTools(ontology, request);
    }

    private static void validateRequestedFactors(WorkflowRequest request, Evidence graphEvidence) {
        Object raw = request.effectiveContext().get("constraints");
        if (!(raw instanceof List<?> constraints)) return;
        List<String> factors = constraints.stream().filter(Map.class::isInstance).map(Map.class::cast)
                .filter(item -> "候选因素".equals(item.get("label")))
                .map(item -> String.valueOf(item.get("value"))).filter(value -> !value.isBlank()).toList();
        for (String factor : factors) {
            boolean supported = graphEvidence.rows().stream().anyMatch(row -> row.values().stream()
                    .filter(java.util.Objects::nonNull).map(String::valueOf).anyMatch(value -> value.contains(factor)));
            if (!supported) {
                throw new BackendException("FOLLOW_UP_FACTOR_EVIDENCE_NOT_FOUND",
                        "候选因素没有对应的 Neo4j 受治理证据: " + factor);
            }
        }
    }

    private Evidence callTool(AuthSession owner, WorkflowRequest request, String traceId, String parentInvocationId,
                              String toolName, String bindingId, Supplier<Evidence> call) {
        fence(request);
        Map<String, Object> auditInput = new LinkedHashMap<>();
        auditInput.put("ontologyVersionId", request.ontologyVersionId());
        auditInput.put("entityKey", request.entityKey());
        auditInput.put("metricDefinitionKey", request.metricDefinitionKey());
        auditInput.put("metricVariantKey", request.metricVariantKey());
        auditInput.put("timeSemanticKey", request.timeSemanticKey());
        auditInput.put("projectIds", request.projectIds());
        auditInput.put("from", request.from().toString());
        auditInput.put("to", request.to().toString());
        auditInput.put("toolBindingId", bindingId);
        String id = recorder.start(request.sessionId(), request.executionId(), owner.userId(),
                "analysis-workflow", toolName, "subtool", parentInvocationId,
                auditInput, traceId, request.leaseOwner());
        try {
            Evidence result = call.get();
            if (result == null || result.rows() == null || result.rows().isEmpty()) {
                throw new BackendException("ANALYSIS_EVIDENCE_EMPTY",
                        toolName + " 没有返回可用于结论的证据。");
            }
            fence(request);
            recorder.succeed(id, Map.of("source", result.source(), "title", result.title(),
                    "rowCount", result.rows().size(), "rows", result.rows()), owner.userId(), request.leaseOwner(),
                    event(request, "tool-completed", "processing", toolName + " 已完成",
                    List.of(Map.of("type", "status", "title", "工具状态", "value", toolName + " 已完成", "tone", "success")),
                    Map.of("toolName", toolName, "toolBindingId", bindingId), traceId, null));
            return result;
        } catch (RuntimeException error) {
            String code = code(error, "DATA_SOURCE_FAILURE");
            String message = message(error);
            recordFailure(id, code, message, owner.userId(), request, event(request, "tool-failed", "failed",
                    toolName + " 失败", List.of(Map.of("type", "status", "title", "工具状态",
                            "value", toolName + " 失败", "tone", "error")),
                    Map.of("toolName", toolName, "toolBindingId", bindingId), traceId, code), error);
            throw error;
        }
    }

    private GroundedConclusion callConclusion(AuthSession owner, WorkflowRequest request, List<Evidence> evidence,
                                               String traceId, String parentInvocationId, String bindingId) {
        fence(request);
        Map<String, Object> auditInput = new LinkedHashMap<>();
        auditInput.put("questionText", request.questionText());
        auditInput.put("referencedConclusion", request.referencedConclusion());
        auditInput.put("evidence", Evidence.projection(evidence));
        auditInput.put("toolBindingId", bindingId);
        String id = recorder.start(request.sessionId(), request.executionId(), owner.userId(),
                "analysis-workflow", "llm.structured-analysis", "subtool", parentInvocationId,
                auditInput, traceId, request.leaseOwner());
        try {
            GroundedConclusion grounded = conclusions.conclude(request, evidence);
            if (grounded == null || grounded.claims().isEmpty() || grounded.text().isBlank()) {
                throw new BackendException("PROVIDER_RESPONSE_INVALID", "LLM 返回了空结论。");
            }
            fence(request);
            recorder.succeed(id, Map.of("conclusionLength", grounded.text().length(), "claims", grounded.claims()),
                    owner.userId(), request.leaseOwner(),
                    event(request, "tool-completed", "processing", "llm.structured-analysis 已完成",
                    List.of(Map.of("type", "status", "title", "工具状态",
                            "value", "llm.structured-analysis 已完成", "tone", "success")),
                    Map.of("toolName", "llm.structured-analysis"), traceId, null));
            return grounded;
        } catch (RuntimeException error) {
            String code = code(error, "PROVIDER_FAILURE");
            String message = message(error);
            recordFailure(id, code, message, owner.userId(), request,
                    event(request, "tool-failed", "failed", "llm.structured-analysis 失败",
                            List.of(Map.of("type", "status", "title", "工具状态",
                                    "value", "llm.structured-analysis 失败", "tone", "error")),
                            Map.of("toolName", "llm.structured-analysis"), traceId, code), error);
            throw error;
        }
    }

    private void recordFailure(String invocationId, String code, String message, String ownerUserId,
                               WorkflowRequest request, ExecutionEvent event, RuntimeException original) {
        try {
            fence(request);
            recorder.fail(invocationId, code, message, ownerUserId, request.leaseOwner(), event);
        } catch (BackendException auditError) {
            if ("JOB_LEASE_LOST".equals(auditError.code())) {
                auditError.addSuppressed(original);
                throw auditError;
            }
            throw auditFailure(original, auditError);
        } catch (RuntimeException auditError) {
            throw auditFailure(original, auditError);
        }
    }

    private static BackendException auditFailure(RuntimeException original, RuntimeException auditError) {
        BackendException failure = new BackendException("INVOCATION_AUDIT_FAILURE",
                "业务调用失败后，Agent invocation 审计写入失败: " + message(auditError), auditError);
        failure.addSuppressed(original);
        return failure;
    }

    private void fence(WorkflowRequest request) {
        executions.renewLease(request.executionId(), request.leaseOwner(), ExecutionRepository.EXECUTION_LEASE);
    }

    private static void validateGrounding(WorkflowRequest request, OntologyCatalog ontology) {
        if (!ExecutionRepository.isJavaContract(request.executionContract())
                || ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT.equals(request.executionContract())
                && (request.followUpId() == null || request.followUpId().isBlank()
                || request.referencedExecutionId() == null || request.referencedExecutionId().isBlank())) {
            throw new BackendException("EXECUTION_CONTRACT_INVALID", "Workflow 执行契约或追问轮次标识无效。");
        }
        if (!ontology.versionId().equals(request.ontologyVersionId())) {
            throw new BackendException("ONTOLOGY_VERSION_MISMATCH", "Workflow 请求未绑定当前已发布本体版本。");
        }
        AnalysisRuntimeCapability.validate(request, ontology);
        if (request.projectIds() == null || request.from() == null || request.to() == null
                || request.from().isAfter(request.to())
                || ChronoUnit.DAYS.between(request.from(), request.to()) > 366) {
            throw new BackendException("ONTOLOGY_GROUNDING_FAILED", "Workflow 时间范围无效。");
        }
    }

    private static Map<String, String> selectTools(OntologyCatalog ontology, WorkflowRequest request) {
        Map<String, ToolRequirement> required = Map.of(
                "erp.read-model", new ToolRequirement("validate-candidate-factors", "erp-read"),
                "cube.semantic-query", new ToolRequirement("inspect-metric-change", "semantic-query"),
                "neo4j.graph-query", new ToolRequirement("validate-candidate-factors", "graph-query"),
                "llm.structured-analysis", new ToolRequirement("synthesize-attribution", "llm-analysis"));
        Map<String, String> selected = new LinkedHashMap<>();
        for (Map.Entry<String, ToolRequirement> entry : required.entrySet()) {
            OntologyCatalog.ToolBinding binding = ontology.toolBindings().stream()
                    .filter(item -> entry.getKey().equals(item.toolName()))
                    .filter(item -> (item.stepTemplateKey() != null
                            && entry.getValue().step().equals(item.stepTemplateKey()))
                            || (item.capabilityTag() != null
                            && entry.getValue().capability().equals(item.capabilityTag())))
                    .filter(item -> active(item.activationConditions(), request))
                    .max(java.util.Comparator.comparingInt(OntologyCatalog.ToolBinding::priority))
                    .orElseThrow(() -> new BackendException("ONTOLOGY_TOOL_NOT_APPROVED",
                            "当前本体没有激活工具绑定: " + entry.getKey()));
            selected.put(entry.getKey(), binding.id());
        }
        return Map.copyOf(selected);
    }

    private static Map<String, OntologyCatalog.Item> validatePlanSteps(OntologyCatalog ontology) {
        Map<String, PlanRequirement> required = Map.of(
                "confirm-analysis-scope", new PlanRequirement(1, Set.of("capability-status")),
                "inspect-metric-change", new PlanRequirement(2, Set.of("semantic-query")),
                "validate-candidate-factors", new PlanRequirement(3,
                        Set.of("semantic-query", "graph-query", "erp-read")),
                "synthesize-attribution", new PlanRequirement(4,
                        Set.of("semantic-query", "structured-analysis")));
        Map<String, OntologyCatalog.Item> selected = new LinkedHashMap<>();
        for (Map.Entry<String, PlanRequirement> entry : required.entrySet()) {
            List<OntologyCatalog.Item> matches = ontology.planSteps().stream()
                    .filter(item -> entry.getKey().equals(item.businessKey())).toList();
            if (matches.size() != 1 || !validPlanStep(matches.get(0), entry.getValue())) {
                throw new BackendException("ONTOLOGY_PLAN_NOT_APPROVED",
                        "当前本体没有适用于收费分析的计划步骤: " + entry.getKey());
            }
            selected.put(entry.getKey(), matches.get(0));
        }
        return Map.copyOf(selected);
    }

    private static void validateEvidenceConsistency(Evidence erpEvidence, Evidence cubeEvidence) {
        if (!"erp-staging".equals(erpEvidence.source()) || !"cube".equals(cubeEvidence.source())
                || cubeEvidence.rows().size() != 1) {
            throw new BackendException("ANALYSIS_EVIDENCE_CONFLICT", "ERP 与 Cube 证据形态不符合固定收缴率契约。");
        }
        BigDecimal erpReceivable = sum(erpEvidence.rows(), "receivableAmount");
        BigDecimal erpPaid = sum(erpEvidence.rows(), "paidAmount");
        Map<String, Object> cube = cubeEvidence.rows().get(0);
        BigDecimal cubeReceivable = numeric(cube.get("denominator"), "Cube denominator");
        BigDecimal cubePaid = numeric(cube.get("numerator"), "Cube numerator");
        BigDecimal cubeRate = numeric(cube.get("value"), "Cube value");
        if (cubeReceivable.signum() <= 0) {
            throw new BackendException("ANALYSIS_EVIDENCE_CONFLICT", "Cube denominator 必须大于零。");
        }
        BigDecimal calculatedRate = cubePaid.multiply(BigDecimal.valueOf(100))
                .divide(cubeReceivable, 4, RoundingMode.HALF_UP);
        if (erpReceivable.setScale(2, RoundingMode.HALF_UP)
                .compareTo(cubeReceivable.setScale(2, RoundingMode.HALF_UP)) != 0
                || erpPaid.setScale(2, RoundingMode.HALF_UP)
                .compareTo(cubePaid.setScale(2, RoundingMode.HALF_UP)) != 0
                || calculatedRate.compareTo(cubeRate.setScale(4, RoundingMode.HALF_UP)) != 0) {
            throw new BackendException("ANALYSIS_EVIDENCE_CONFLICT",
                    "ERP 与 Cube 对同一项目和时间范围返回了不一致的收缴率事实。");
        }
    }

    private static BigDecimal sum(List<Map<String, Object>> rows, String field) {
        return rows.stream().map(row -> numeric(row.get(field), "ERP " + field))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static BigDecimal numeric(Object value, String field) {
        try {
            if (value == null) throw new NumberFormatException("null");
            return new BigDecimal(value.toString());
        } catch (NumberFormatException error) {
            throw new BackendException("ANALYSIS_EVIDENCE_CONFLICT", field + " 不是有效数值。", error);
        }
    }

    private static boolean validPlanStep(OntologyCatalog.Item step, PlanRequirement requirement) {
        Object intents = step.metadata().get("intentTypes");
        Object capabilities = step.metadata().get("requiredCapabilities");
        Object order = step.metadata().get("sortOrder");
        return step.displayName() != null && !step.displayName().isBlank()
                && intents instanceof List<?> intentList && intentList.contains("fee-analysis")
                && capabilities instanceof List<?> capabilityList
                && capabilityList.containsAll(requirement.capabilities())
                && order instanceof Number number && number.intValue() == requirement.order();
    }

    private static boolean active(List<Map<String, Object>> conditions, WorkflowRequest request) {
        return conditions != null && conditions.stream().allMatch(condition -> switch (String.valueOf(condition.get("type"))) {
            case "always" -> Boolean.TRUE.equals(condition.get("value"));
            case "entity-present" -> request.entityKey().equals(condition.get("entityKey"));
            case "metric-present" -> request.metricDefinitionKey().equals(condition.get("metricKey"))
                    || request.metricVariantKey().equals(condition.get("metricKey"));
            case "time-semantic-present" -> request.timeSemanticKey().equals(condition.get("timeSemanticKey"));
            case "intent-type" -> "fee-analysis".equals(condition.get("intentType"));
            default -> false;
        });
    }

    private static Map<String, Object> plan(WorkflowRequest request, Map<String, String> toolBindings,
                                            Map<String, OntologyCatalog.Item> planSteps) {
        List<Map<String, Object>> steps = List.of(
                step("confirm-analysis-scope", 1, planSteps.get("confirm-analysis-scope").displayName(),
                        "校验用户范围与本体绑定", List.of()),
                step("inspect-metric-change", 2, planSteps.get("inspect-metric-change").displayName(),
                        "读取 Cube 受治理指标", List.of("confirm-analysis-scope")),
                step("validate-candidate-factors", 3, planSteps.get("validate-candidate-factors").displayName(),
                        "读取 ERP 事实与 Neo4j 收费项目结构关系，不作为因果证明", List.of("inspect-metric-change")),
                step("synthesize-attribution", 4, planSteps.get("synthesize-attribution").displayName(),
                        "仅基于已取得证据生成结论", List.of("validate-candidate-factors")));
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("mode", "multi-step");
        plan.put("summary", ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT.equals(request.executionContract())
                ? "追问分析 Workflow" : "首次分析 Workflow");
        plan.put("steps", steps);
        plan.put("_executionContract", request.executionContract());
        plan.put("_groundedSource", request.ontologyVersionId());
        plan.put("_groundingStatus", "grounded");
        plan.put("_toolBindings", toolBindings);
        plan.put("_executionAssumptions", List.of());
        if (request.followUpId() != null) plan.put("_followUpId", request.followUpId());
        if (request.referencedExecutionId() != null) {
            plan.put("_referencedExecutionId", request.referencedExecutionId());
        }
        Map<String, Object> resolved = new LinkedHashMap<>(request.effectiveContext());
        resolved.put("entityKey", request.entityKey());
        resolved.put("metricDefinitionKey", request.metricDefinitionKey());
        resolved.put("metricVariantKey", request.metricVariantKey());
        resolved.put("timeSemanticKey", request.timeSemanticKey());
        resolved.put("projectIds", request.projectIds());
        resolved.put("from", request.from().toString());
        resolved.put("to", request.to().toString());
        plan.put("_resolvedContext", resolved);
        return Map.copyOf(plan);
    }

    private static Map<String, Object> step(String id, int order, String title, String objective, List<String> deps) {
        return Map.of("id", id, "order", order, "title", title, "objective", objective, "dependencyIds", deps);
    }

    private record PlanRequirement(int order, Set<String> capabilities) {}

    private static List<Map<String, Object>> renderBlocks(List<Evidence> evidence, String conclusion) {
        List<Map<String, Object>> blocks = new ArrayList<>();
        blocks.add(Map.of("type", "markdown", "title", "证据约束结论", "content", conclusion));
        blocks.add(Map.of("type", "evidence-card", "title", "关键证据",
                "summary", "来自 ERP、Cube 与 Neo4j 的受治理证据",
                "evidence", evidence.stream().map(item -> Map.of("label", item.title(),
                        "summary", summarize(item))).toList()));
        evidence.stream().map(AnalysisWorkflow::evidenceTable).forEach(blocks::add);
        return List.copyOf(blocks);
    }

    private static Map<String, Object> evidenceTable(Evidence evidence) {
        List<String> columns = evidence.rows().stream().flatMap(row -> row.keySet().stream()).distinct().toList();
        List<List<String>> rows = evidence.rows().stream().map(row -> columns.stream()
                .map(column -> String.valueOf(row.get(column))).toList()).toList();
        return Map.of("type", "table", "title", evidence.title(), "columns", columns, "rows", rows);
    }

    private static String summarize(Evidence evidence) {
        return evidence.rows().isEmpty() ? "数据源返回空结果" : "返回 " + evidence.rows().size() + " 条受范围约束的证据";
    }

    private static String code(RuntimeException error, String fallback) {
        return error instanceof BackendException known ? known.code() : fallback;
    }

    private static String message(RuntimeException error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }

    private static ExecutionEvent event(WorkflowRequest request, String kind, String status, String message,
                                        List<Map<String, Object>> blocks, Map<String, Object> metadata,
                                        String traceId, String errorCode) {
        return new ExecutionEvent(UUID.randomUUID().toString(), request.sessionId(), request.executionId(), 0,
                kind, Instant.now(), status, message, blocks, new LinkedHashMap<>(metadata), errorCode, traceId);
    }

    private record ToolRequirement(String step, String capability) {}
}
