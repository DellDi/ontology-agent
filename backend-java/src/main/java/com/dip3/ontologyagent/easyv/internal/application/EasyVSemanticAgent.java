package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.ExecutionProgress;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Citation;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposeRequest;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposedAnswer;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanDecision;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanRequest;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVInvocationContract;
import com.dip3.ontologyagent.execution.InvocationEventRecorder;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery;
import com.dip3.ontologyagent.semantic.api.OntologyMetric;
import com.dip3.ontologyagent.semantic.api.OntologyObjectType;
import com.dip3.ontologyagent.semantic.api.OntologyProperty;
import com.dip3.ontologyagent.semantic.api.QueryIntent;
import com.dip3.ontologyagent.semantic.api.ObjectSelection;
import com.dip3.ontologyagent.semantic.api.ObjectQueryPort;
import com.dip3.ontologyagent.semantic.api.QueryIntentCodec;
import com.dip3.ontologyagent.semantic.api.ResolvedTimeRange;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.AccessContext;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.DataCoverage;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.SemanticQueryResult;
import com.dip3.ontologyagent.semantic.api.TimeCoverage;
import com.dip3.ontologyagent.semantic.api.TimeExpression;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.Objects;
import java.util.function.Consumer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * EasyV 语义分析 Agent：模型把问题规划为本体查询意图 → Java 校验编译（违规单轮回传纠正）→
 * 语义层按冻结版本与授权范围执行 → 模型仅基于结果作答且逐条引用数据点 → Java 校验引用后组装证据。
 * 澄清、不支持与校验失败一律 fail loud，不回退默认查询。
 */
@Service
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVSemanticAgent implements EasyVMainAgent {
  public static final String DATA_SCOPE_EVIDENCE = "easyv-data-scope";
  public static final String QUERY_EVIDENCE_PREFIX = "easyv-query:";
  public static final String CLAIM_KIND = "direct-answer";
  public static final String MODE = "semantic-query-read-only";
  static final int MAX_QUERIES = 4;
  static final int MAX_TOOL_CALLS = 8;
  static final int EVIDENCE_ROW_CAP = 50;
  static final long EXECUTION_TIMEOUT_MILLIS = 180_000;
  private static final String COMPARE_SUFFIX = ":compare";
  private static final String TOOL_LABEL = "执行 EasyV 语义分析";

  private final EasyVAnalysisModel model;
  private final SemanticModel semantic;
  private final SemanticQueryCompiler compiler;
  private final SemanticQueryPort queries;
  private final DatasetVersionSetRegistry datasets;
  private final InvocationEventRecorder recorder;
  private final EasyVObjectSelectionService selections;
  private final EasyVAgentTools tools;

  public EasyVSemanticAgent(EasyVAnalysisModel model, SemanticModel semantic, SemanticQueryCompiler compiler,
                            SemanticQueryPort queries, DatasetVersionSetRegistry datasets,
                            InvocationEventRecorder recorder, EasyVObjectSelectionService selections, EasyVAgentTools tools) {
    this.model = model;
    this.semantic = semantic;
    this.compiler = compiler;
    this.queries = queries;
    this.datasets = datasets;
    this.recorder = recorder;
    this.selections = selections;
    this.tools = tools;
  }

  /** 一条已编译并执行的查询。 */
  record ExecutedQuery(String id, String label, CompiledSemanticQuery compiled, SemanticQueryResult result,
                       DataCoverage coverage) {}

  private record ToolCall(String tool, Map<String, Object> input, CompiledSemanticQuery metric, EasyVAgentTools.Prepared object) {
    Object identity() { return metric != null ? metric.cubeQuery() : object.request() != null ? object.request() : object.selection(); }
  }
  private record ExecutedTool(String id, EasyVAgentTools.Output output) {}

  @Override
  public WorkflowResult execute(AuthSession principal, AgentTurn turn, String executionId, OntologyCatalog ontology,
                                String datasetVersionSetId, ResolvedScopeSnapshot scope, String traceId,
                                String leaseOwner, ExecutionProgress progress) {
    if (leaseOwner == null || leaseOwner.isBlank()) {
      throw new BackendException("JOB_LEASE_REQUIRED", "EasyV Agent 必须绑定当前执行租约。");
    }
    if (datasetVersionSetId == null || datasetVersionSetId.isBlank()) {
      throw new BackendException("DATASET_VERSION_SET_MISSING", "EasyV 分析缺少冻结数据集版本。");
    }
    DatasetVersionSet versionSet =
        datasets.requireFrozen(datasetVersionSetId, EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS);
    AccessContext access = new AccessContext(versionSet.productVersionIds(), EasyVScopeResolver.dataScope(scope));
    String dataScope = EasyVScopeResolver.dataScopeLabel(scope);

    Map<String, Object> auditInput = new LinkedHashMap<>();
    auditInput.put("ontologyVersionId", ontology.versionId());
    auditInput.put("datasetVersionSetId", datasetVersionSetId);
    auditInput.put("dataScope", dataScope);
    auditInput.put("followUp", turn.followUp());
    if (turn.effectiveContext().get("objectSelection") != null) auditInput.put("objectSelection", turn.effectiveContext().get("objectSelection"));
    String invocationId = recorder.start(turn.sessionId(), executionId, principal.userId(), "easyv-semantic-agent",
        EasyVInvocationContract.TOOL_NAME, EasyVInvocationContract.CONTRACT.invocationType(), null, auditInput,
        traceId, leaseOwner);
    Map<String, Object> toolStep = step("analysis", 0, TOOL_LABEL, "running");
    long started = System.nanoTime();
    progress.emit("step-started", toolStep, null);
    progress.emit("tool-started", toolStep,
        Map.of("name", EasyVInvocationContract.TOOL_NAME, "label", TOOL_LABEL, "input", auditInput));
    try {
      WorkflowResult result = analyse(principal, turn, ontology, datasetVersionSetId, scope, versionSet, access, dataScope,
          executionId, invocationId, traceId, leaseOwner, started + EXECUTION_TIMEOUT_MILLIS * 1_000_000L, progress);
      progress.emit("tool-completed", toolStep, Map.of("name", EasyVInvocationContract.TOOL_NAME,
          "label", TOOL_LABEL, "durationMs", elapsed(started),
          "output", Map.of("evidenceCount", result.evidence().size(), "claimCount", result.claims().size())));
      recorder.succeedWhileLeased(invocationId,
          Map.of("evidenceCount", result.evidence().size(), "claimCount", result.claims().size()),
          executionId, leaseOwner);
      progress.emit("step-completed", done(toolStep, started, "completed"), null);
      return result;
    } catch (RuntimeException error) {
      String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
      progress.emit("tool-failed", toolStep, Map.of("name", EasyVInvocationContract.TOOL_NAME,
          "label", TOOL_LABEL, "durationMs", elapsed(started), "error", message));
      progress.emit("step-completed", done(toolStep, started, "failed"), null);
      failInvocation(invocationId, error, executionId, leaseOwner);
      throw error;
    }
  }

  private WorkflowResult analyse(AuthSession principal, AgentTurn turn, OntologyCatalog ontology, String datasetVersionSetId,
                                 ResolvedScopeSnapshot scope, DatasetVersionSet versionSet, AccessContext access,
                                 String dataScope, String executionId, String parentInvocationId, String traceId,
                                 String leaseOwner, long deadline, ExecutionProgress progress) {
    remainingMillis(deadline);
    List<Map<String, Object>> performedSteps = new ArrayList<>();
    performedSteps.add(structuredOverride(turn)
        ? planStep("plan-queries", 1, "structured-adjustment", "应用结构化调整")
        : planStep("plan-queries", 1, "llm-plan", "理解问题并规划查询"));
    Map<String, Object> planStep = step("plan-queries", 1,
        structuredOverride(turn) ? "应用结构化调整" : "理解问题并规划查询", "running");
    progress.emit("step-started", planStep, null);
    long planStarted = System.nanoTime();
    List<ToolCall> compiled;
    EasyVAgentTools.Run objectRun;
    ObjectQueryPort.Row selectedObject = null;
    try {
      if (turn.effectiveContext().get("objectSelection") != null) {
        ObjectSelection selection = ObjectSelection.read(turn.effectiveContext().get("objectSelection"));
        if (!turn.followUp() || !selection.executionId().equals(turn.referencedExecutionId())
            || !selection.datasetVersionSetId().equals(datasetVersionSetId)) {
          throw new BackendException("OBJECT_VERSION_MISMATCH", "执行中的对象选择与来源轮次或冻结集合不一致。");
        }
        progress.emit("tool-started", planStep, Map.of("name", "read_selected_object", "label", "读取所选对象", "input", selection.snapshot()));
        String selectedInvocation = recorder.start(turn.sessionId(), executionId, principal.userId(),
            "easyv-semantic-agent", "read_selected_object", "subtool", parentInvocationId, selection.snapshot(), traceId, leaseOwner);
        try {
          remainingMillis(deadline);
          var selected = selections.requireDuringExecution(principal, scope, selection);
          remainingMillis(deadline);
          recorder.succeedWhileLeased(selectedInvocation, Map.of("reference", selected.object().reference(),
              "properties", selected.object().properties(), "scope", selected.scope().values()), executionId, leaseOwner);
          selectedObject = selected.object();
          scope = selected.scope();
          access = new AccessContext(versionSet.productVersionIds(), EasyVScopeResolver.dataScope(scope));
          dataScope = EasyVScopeResolver.dataScopeLabel(scope);
        } catch (RuntimeException error) {
          progress.emit("tool-failed", planStep, Map.of("name", "read_selected_object", "label", "读取所选对象",
              "error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()));
          failInvocation(selectedInvocation, error, executionId, leaseOwner);
          throw error;
        }
        progress.emit("tool-completed", planStep, Map.of("name", "read_selected_object", "label", "读取所选对象", "output", Map.of("reference", selection.snapshot().get("reference"))));
      }
      objectRun = tools.open(new CapabilityExecutionContext(principal, turn, executionId, ontology, datasetVersionSetId,
          traceId, leaseOwner, progress), scope, versionSet.productVersionIds(), selectedObject, previousCalls(turn));
      scope = objectRun.currentScope();
      dataScope = EasyVScopeResolver.dataScopeLabel(scope);
      compiled = plan(turn, selectedObject, List.of(), MAX_QUERIES, MAX_TOOL_CALLS, deadline, objectRun, versionSet);
    } catch (RuntimeException error) {
      progress.emit("step-completed", done(planStep, planStarted, "failed"), null);
      throw error;
    }
    progress.emit("step-completed", done(planStep, planStarted, "completed"), null);

    List<ExecutedQuery> executed = new ArrayList<>();
    List<ExecutedTool> objectResults = new ArrayList<>();
    List<ToolCall> performedCalls = new ArrayList<>();
    List<Map<String, Object>> callTrace = new ArrayList<>();
    while (!compiled.isEmpty()) {
      remainingMillis(deadline);
      for (ToolCall call : compiled) {
        String id = "q" + (performedCalls.size() + 1);
        String label = call.metric() != null ? label(call.metric()) : toolLabel(call.tool());
        performedSteps.add(planStep("query-" + id, performedSteps.size() + 1,
            call.metric() != null ? "semantic-query" : "object-tool", label));
        Map<String, Object> queryStep = step("query-" + id, performedSteps.size(), label, "running");
        progress.emit("step-started", queryStep, null);
        long queryStarted = System.nanoTime();
        try {
          List<ObjectQueryPort.Reference> refs;
          if (call.metric() != null) {
            executed.add(run(id, call.metric(), objectRun.access(), turn, principal, executionId, parentInvocationId, traceId,
                leaseOwner, deadline, progress));
            refs = call.input().containsKey("handle") ? List.of(objectRun.requireHandle(call.input().get("handle")).reference()) : List.of();
          } else {
            var output = runObject(id, call.object(), objectRun, turn, principal, executionId, parentInvocationId,
                traceId, leaseOwner, deadline, progress);
            objectResults.add(new ExecutedTool(id, output)); refs = output.references(); label = output.label();
          }
          performedCalls.add(call);
          callTrace.add(Map.of("id", id, "tool", call.tool(), "label", label, "input", call.input(), "references", refs));
          progress.emit("step-completed", done(queryStep, queryStarted, "completed"), null);
        } catch (RuntimeException error) {
          progress.emit("step-completed", done(queryStep, queryStarted, "failed"), null); throw error;
        }
      }
      scope = objectRun.currentScope(); dataScope = EasyVScopeResolver.dataScopeLabel(scope);
      if (structuredOverride(turn)) break;
      String planningId = "plan-after-q" + performedCalls.size();
      String title = "根据查询结果决定下一步";
      performedSteps.add(planStep(planningId, performedSteps.size() + 1, "llm-plan", title));
      Map<String, Object> nextStep = step(planningId, performedSteps.size(), title, "running");
      progress.emit("step-started", nextStep, null);
      long nextStarted = System.nanoTime();
      try {
        List<Evidence> currentEvidence = evidence(executed, objectResults, ontology, datasetVersionSetId, versionSet, dataScope);
        List<Map<String, Object>> observations = projections(executed, objectResults, currentEvidence, true);
        compiled = plan(turn, selectedObject, observations, MAX_QUERIES - executed.size(), MAX_TOOL_CALLS - performedCalls.size(), deadline, objectRun, versionSet);
        for (ToolCall call : compiled) if (performedCalls.stream().anyMatch(previous -> previous.tool().equals(call.tool()) && previous.identity().equals(call.identity()))) {
          throw new BackendException("AGENT_TOOL_REPEATED", "EasyV 规划重复了本轮已执行的调用，请明确新的分析范围。");
        }
        progress.emit("step-completed", done(nextStep, nextStarted, "completed"), null);
      } catch (RuntimeException error) {
        progress.emit("step-completed", done(nextStep, nextStarted, "failed"), null); throw error;
      }
    }
    objectRun.currentScope();
    List<Evidence> evidence = evidence(executed, objectResults, ontology, datasetVersionSetId, versionSet, dataScope);

    performedSteps.add(planStep("compose-answer", performedSteps.size() + 1, "llm-compose", "综合回答"));
    Map<String, Object> composeStep = step("compose-answer", performedSteps.size(), "综合回答", "running");
    progress.emit("step-started", composeStep, null);
    long composeStarted = System.nanoTime();
    ComposedAnswer answer;
    List<GroundedConclusion.EvidenceReference> references;
    try {
      answer = null;
      references = null;
      List<String> violations = List.of();
      Consumer<String> sink = throttled(progress);
      for (int attempt = 1; attempt <= 2 && references == null; attempt += 1) {
        try {
          answer = model.compose(new ComposeRequest(turn.questionText(), dataScope,
              projections(executed, objectResults, evidence, false), violations, remainingMillis(deadline)), sink);
          remainingMillis(deadline);
          objectRun.currentScope();
        } catch (BackendException error) {
          if (!"EASYV_ANSWER_INVALID".equals(error.code())) throw error;
          violations = List.of(error.getMessage());
          continue;
        }
        List<String> found = new ArrayList<>();
        for (var highlight : answer == null ? List.<EasyVAnalysisModel.Highlight>of() : answer.highlights()) {
          if (highlight.viz() == null || !List.of("bar", "line", "pie", "table", "none").contains(highlight.viz())) {
            found.add("highlight 的 viz 不支持：" + highlight.viz());
          }
          if (executed.stream().noneMatch(query -> query.id().equals(highlight.query()))
              && objectResults.stream().noneMatch(tool -> tool.id().equals(highlight.query()))) {
            found.add("highlight 的查询不存在：" + highlight.query());
          }
        }
        List<GroundedConclusion.EvidenceReference> resolved = references(answer, evidence, found);
        if (found.isEmpty()) {
          references = resolved;
        } else {
          violations = found;
        }
      }
      if (references == null) {
        throw new BackendException("EASYV_ANSWER_UNGROUNDED",
            "EasyV 回答未能引用有效的数据点：" + String.join("；", violations) + "。");
      }
    } catch (RuntimeException error) {
      progress.emit("step-completed", done(composeStep, composeStarted, "failed"), null);
      throw error;
    }
    progress.emit("step-completed", done(composeStep, composeStarted, "completed"), null);

    List<GroundedConclusion.Claim> claims =
        List.of(new GroundedConclusion.Claim(CLAIM_KIND, answer.markdown(), references));
    List<Map<String, Object>> blocks = new ArrayList<>(EasyVRenderBlocks.build(executed, answer.highlights(), semantic, datasetVersionSetId));
    blocks.addAll(EasyVRenderBlocks.objectBrowsers(executed, semantic, datasetVersionSetId,
        versionSet.productVersionIds().keySet()));
    blocks.addAll(objectResults.stream().map(tool -> tool.output().renderBlock()).toList());
    return new WorkflowResult(planSnapshot(turn, scope, dataScope, executed, evidence, answer, performedSteps, callTrace), evidence,
        answer.markdown(), claims, blocks);
  }

  private List<ToolCall> plan(AgentTurn turn, ObjectQueryPort.Row selectedObject, List<Map<String, Object>> observations,
      int remainingQueries, int remainingCalls, long deadline, EasyVAgentTools.Run objectRun, DatasetVersionSet versions) {
    List<?> override = overrideIntents(turn);
    if (override != null) {
      List<CompiledSemanticQuery> compiled = compileOverride(override, turn.anchoredAt());
      return compiled.stream().map(query -> {
        var constrained = selectedObject == null ? query : compiler.compile(selections.constrain(query.intent(), selectedObject), turn.anchoredAt()).require();
        return new ToolCall("query_metrics", Map.of("intent", QueryIntentCodec.write(constrained.intent())), constrained, null);
      }).toList();
    }
    return planCalls(turn.questionText(), turn.anchoredAt(), turn.referencedConclusion(),
        turn.followUp() ? previousQueries(turn) : List.of(), selectedObject, observations, remainingQueries, remainingCalls,
        deadline, objectRun, versions.productVersionIds().keySet().containsAll(Set.of("easyv-ai-application", "easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component")));
  }

  /** 真实 A 规划评测保留入口，只开放指标工具，不执行模型输出。 */
  List<CompiledSemanticQuery> planQueries(String question, Instant anchoredAt, Map<String, Object> previousConclusion,
      List<Map<String, Object>> previousQueries) {
    return planCalls(question, anchoredAt, previousConclusion, previousQueries, null, List.of(), MAX_QUERIES, MAX_TOOL_CALLS,
        System.nanoTime() + EXECUTION_TIMEOUT_MILLIS * 1_000_000L, null, false).stream().map(ToolCall::metric).toList();
  }

  private List<ToolCall> planCalls(String question, Instant anchoredAt, Map<String, Object> referencedConclusion,
      List<Map<String, Object>> previousQueries, ObjectQueryPort.Row selectedObject, List<Map<String, Object>> observations,
      int remainingQueries, int remainingCalls, long deadline, EasyVAgentTools.Run objectRun, boolean objectTools) {
    ZoneId zone = semantic.contributions().stream()
        .filter(item -> EasyVGenerationOntology.DOMAIN_KEY.equals(item.domainKey()))
        .findFirst()
        .orElseThrow(() -> new BackendException("EASYV_SEMANTIC_MODEL_MISSING", "语义层未注册 EasyV 本体。"))
        .businessZone();
    List<Map<String, Object>> catalog = QueryIntentCodec.catalog(semantic, EasyVGenerationOntology.DOMAIN_KEY);
    List<String> violations = List.of();
    for (int attempt = 1; attempt <= 2; attempt += 1) {
      PlanDecision decision;
      try {
        decision = model.plan(new PlanRequest(question, catalog,
            anchoredAt.atZone(zone).toLocalDate().toString(), zone.getId(), referencedConclusion,
            previousQueries, violations, selectedObject == null ? Map.of() : Map.of(
                "reference", selectedObject.reference(), "objectLabel", semantic.require(selectedObject.reference().objectKey()).label(),
                "properties", selectedObject.properties()), observations, remainingQueries, remainingMillis(deadline), remainingCalls, EasyVAgentTools.catalog(objectTools),
            objectRun == null ? List.of() : objectRun.knownObjects()));
        remainingMillis(deadline);
      } catch (BackendException error) {
        if (!"EASYV_PLAN_INVALID".equals(error.code())) throw error;
        violations = List.of(error.getMessage());
        continue;
      }
      if (decision == null || decision.status() == null) {
        violations = List.of("输出缺少 status");
        continue;
      }
      switch (decision.status()) {
        case CLARIFY -> throw clarification(decision.message(), decision.options());
        case UNSUPPORTED -> throw new BackendException("EASYV_QUESTION_UNSUPPORTED",
            "当前数据无法回答该问题：" + nonBlank(decision.message(), "模型未说明原因") + "。");
        case FINISHED -> {
          if (!observations.isEmpty() && decision.calls().isEmpty()) return List.of();
          violations = List.of("没有执行结果时不能 finished，finished 不接受 calls");
        }
        case READY -> {
          List<String> found = new ArrayList<>();
          List<ToolCall> compiled = compileCalls(decision.calls(), anchoredAt, found, selectedObject, objectRun, objectTools);
          if (found.isEmpty()) {
            if (compiled.size() > remainingCalls || compiled.stream().filter(call -> call.metric() != null).count() > remainingQueries) {
              throw new BackendException("AGENT_TOOL_LIMIT", "EasyV 分析最多执行 8 次工具调用，其中指标查询最多 4 次。");
            }
            if (compiled.stream().map(call -> List.of(call.tool(), call.identity())).distinct().count() != compiled.size()) found.add("同一批次不接受重复调用");
            else return compiled;
          }
          violations = found;
        }
      }
    }
    throw new BackendException("EASYV_PLAN_INVALID",
        "EasyV 查询规划两次均未通过本体校验：" + String.join("；", violations) + "。");
  }

  @SuppressWarnings("unchecked")
  private List<ToolCall> compileCalls(List<Object> raw, Instant anchor, List<String> violations, ObjectQueryPort.Row selected,
      EasyVAgentTools.Run objectRun, boolean objectTools) {
    if (raw.isEmpty() || raw.size() > MAX_TOOL_CALLS) { violations.add("calls 需要 1-8 个调用"); return List.of(); }
    List<ToolCall> compiled = new ArrayList<>();
    for (Object item : raw) {
      if (!(item instanceof Map<?, ?> call) || !call.keySet().equals(Set.of("tool", "input")) || !(call.get("tool") instanceof String tool)
          || !(call.get("input") instanceof Map<?, ?> rawInput) || rawInput.keySet().stream().anyMatch(k -> !(k instanceof String)) || rawInput.values().stream().anyMatch(Objects::isNull)) {
        violations.add("调用必须且只能包含 tool 和非空 input 对象"); continue;
      }
      var input = (Map<String, Object>) rawInput;
      try {
        if (tool.equals("query_metrics")) {
          if (!Set.of("intent", "handle").containsAll(input.keySet()) || !input.containsKey("intent")) throw new BackendException("EASYV_PLAN_INVALID", "query_metrics 需要 intent，可选 handle，禁止其他字段。");
          var result = compile(List.of(input.get("intent")), anchor, violations, selected);
          if (!result.isEmpty()) {
            var query = result.getFirst();
            if (input.containsKey("handle")) {
              if (objectRun == null) throw new BackendException("EASYV_PLAN_INVALID", "当前规划入口没有对象句柄。");
              var row = objectRun.requireHandle(input.get("handle"));
              if (row.properties().isEmpty()) throw new BackendException("EASYV_PLAN_INVALID", "历史对象先 read_object，再按真实属性查询指标。");
              query = compiler.compile(selections.constrain(query.intent(), row), anchor).require();
            }
            compiled.add(new ToolCall(tool, Map.copyOf(input), query, null));
          }
        } else {
          if (!objectTools || objectRun == null) throw new BackendException("EASYV_PLAN_INVALID", "当前冻结集合或入口未提供对象工具。");
          var prepared = objectRun.prepare(tool, input); compiled.add(new ToolCall(tool, Map.copyOf(input), null, prepared));
        }
      } catch (BackendException error) {
        if (!Set.of("EASYV_PLAN_INVALID", "OBJECT_SELECTION_QUERY_UNSUPPORTED", "OBJECT_SELECTION_INVALID").contains(error.code())) throw error;
        violations.add(error.getMessage());
      }
    }
    return compiled;
  }

  private static String toolLabel(String tool) {
    return switch (tool) { case "query_objects" -> "读取对象列表"; case "read_object" -> "读取对象详情";
      case "traverse_objects" -> "穿透对象关系"; case "assess_scheme" -> "评估区域方案"; default -> "执行指标查询"; };
  }

  private static List<Map<String, Object>> previousCalls(AgentTurn turn) {
    return EasyVAgentTools.readTrace(turn.effectiveContext().get("toolCalls"));
  }

  /** 结构化调整轮次：不调用模型，直接编译用户编辑后的查询意图；任何违规都 fail loud，不回退模型规划。 */
  private List<CompiledSemanticQuery> compileOverride(List<?> override, Instant anchoredAt) {
    List<String> violations = new ArrayList<>();
    List<CompiledSemanticQuery> compiled = new ArrayList<>();
    if (override.size() > MAX_QUERIES) {
      violations.add("override 最多 " + MAX_QUERIES + " 个查询意图");
    }
    for (int index = 0; index < override.size(); index += 1) {
      Object entry = override.get(index);
      String id = entry instanceof Map<?, ?> map && map.get("id") instanceof String text && !text.isBlank()
          ? text : "q" + (index + 1);
      String prefix = "查询 " + id + "：";
      QueryIntentCodec.Parsed parsed =
          QueryIntentCodec.read(entry instanceof Map<?, ?> map ? map.get("intent") : null);
      if (!parsed.accepted()) {
        parsed.violations().forEach(item -> violations.add(prefix + item));
        continue;
      }
      QueryIntent intent = parsed.intent();
      if (semantic.find(intent.objectKey()).isPresent()
          && !EasyVGenerationOntology.DOMAIN_KEY.equals(semantic.domainKey(intent.objectKey()))) {
        violations.add(prefix + "对象 " + intent.objectKey() + " 不属于 EasyV 领域");
        continue;
      }
      SemanticQueryCompiler.Result result = compiler.compile(intent, anchoredAt);
      if (result.accepted()) {
        compiled.add(result.query());
      } else {
        result.violations().forEach(item -> violations.add(prefix + item));
      }
    }
    if (!violations.isEmpty()) {
      throw new BackendException("EASYV_OVERRIDE_INVALID",
          "结构化调整的查询意图未通过本体校验：" + String.join("；", violations) + "。");
    }
    return compiled;
  }

  private static List<?> overrideIntents(AgentTurn turn) {
    return turn.effectiveContext().get("override") instanceof List<?> list && !list.isEmpty() ? list : null;
  }

  private static boolean structuredOverride(AgentTurn turn) {
    return overrideIntents(turn) != null;
  }

  private List<CompiledSemanticQuery> compile(List<Object> raw, Instant anchoredAt, List<String> violations, ObjectQueryPort.Row selectedObject) {
    if (raw.isEmpty() || raw.size() > MAX_QUERIES) {
      violations.add("queries 需要 1-" + MAX_QUERIES + " 个查询意图");
      return List.of();
    }
    List<CompiledSemanticQuery> compiled = new ArrayList<>();
    for (int index = 0; index < raw.size(); index += 1) {
      String prefix = "查询 q" + (index + 1) + "：";
      QueryIntentCodec.Parsed parsed = QueryIntentCodec.read(raw.get(index));
      if (!parsed.accepted()) {
        parsed.violations().forEach(item -> violations.add(prefix + item));
        continue;
      }
      QueryIntent intent = parsed.intent();
      if (semantic.find(intent.objectKey()).isPresent()
          && !EasyVGenerationOntology.DOMAIN_KEY.equals(semantic.domainKey(intent.objectKey()))) {
        violations.add(prefix + "对象 " + intent.objectKey() + " 不属于 EasyV 领域");
        continue;
      }
      ambiguity(intent.time() == null ? null : intent.time().expression());
      ambiguity(intent.compare());
      if (selectedObject != null && semantic.find(intent.objectKey()).isPresent()) {
        try { intent = selections.constrain(intent, selectedObject); }
        catch (BackendException error) {
          if (!"OBJECT_SELECTION_QUERY_UNSUPPORTED".equals(error.code())) throw error;
          violations.add(prefix + error.getMessage()); continue;
        }
      }
      SemanticQueryCompiler.Result result = compiler.compile(intent, anchoredAt);
      if (result.accepted()) {
        compiled.add(result.query());
      } else {
        result.violations().forEach(item -> violations.add(prefix + item));
      }
    }
    return compiled;
  }

  private static void ambiguity(TimeExpression expression) {
    if (expression != null && expression.kind() == TimeExpression.Kind.AMBIGUOUS) {
      throw clarification("“" + expression.sourceText() + "”指哪段时间？",
          expression.candidates().stream().map(TimeExpression::sourceText).toList());
    }
  }

  private static BackendException clarification(String message, List<String> options) {
    String question = nonBlank(message, "问题需要进一步明确");
    // 契约上限 6 个非空选项：模型给出更多或空白项时收敛到契约内，保证失败快照可解析
    List<String> normalized = options == null ? List.of() : options.stream()
        .map(option -> option == null ? "" : option.trim())
        .filter(option -> !option.isEmpty())
        .distinct()
        .limit(6)
        .toList();
    String choices = normalized.isEmpty() ? "" : "可选：" + String.join(" / ", normalized) + "。";
    return BackendException.clarification("EASYV_CLARIFICATION_REQUIRED",
        "需要先确认：" + question + (choices.isEmpty() ? "" : " " + choices) + " 请补充后重新提问。",
        question, normalized);
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> previousQueries(AgentTurn turn) {
    Object raw = turn.effectiveContext().get("queries");
    if (!(raw instanceof List<?> list) || (list.isEmpty() && previousCalls(turn).isEmpty())
        || list.stream().anyMatch(item -> !(item instanceof Map<?, ?>))) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问缺少上一轮已执行的查询意图。");
    }
    return list.stream().map(item -> (Map<String, Object>) item).toList();
  }

  private ExecutedQuery run(String id, CompiledSemanticQuery compiled, AccessContext access,
                            AgentTurn turn, AuthSession principal, String executionId, String parentInvocationId,
                            String traceId, String leaseOwner, long deadline, ExecutionProgress progress) {
    remainingMillis(deadline);
    String label = label(compiled);
    long started = System.nanoTime();
    progress.emit("tool-started", null, Map.of("name", id, "label", label, "fact", compiled.objectKey(),
        "input", QueryIntentCodec.write(compiled.intent())));
    Map<String, Object> input = new LinkedHashMap<>();
    input.put("id", id);
    input.put("intent", QueryIntentCodec.write(compiled.intent()));
    input.put("productVersions", access.productVersions());
    input.put("scope", access.scope());
    input.put("from", compiled.range().from() == null ? null : compiled.range().from().toString());
    input.put("to", compiled.range().to().toString());
    input.put("compareRange", compiled.compareRange() == null ? null : Map.of("from", compiled.compareRange().from().toString(),
        "to", compiled.compareRange().to().toString(), "description", compiled.compareRange().description()));
    String invocationId = recorder.start(turn.sessionId(), executionId, principal.userId(), "easyv-semantic-agent",
        "query_metrics", "subtool", parentInvocationId, input, traceId, leaseOwner);
    try {
      remainingMillis(deadline);
      SemanticQueryResult result = queries.execute(compiled, access);
      remainingMillis(deadline);
      DataCoverage coverage = queries.coverage(compiled, access);
      remainingMillis(deadline);
      Map<String, Object> output = new LinkedHashMap<>();
      output.put("rows", result.rows());
      output.put("compareRows", result.compareRows());
      output.put("sql", result.sql());
      if (coverage != null) {
        Map<String, Object> coverageInput = new LinkedHashMap<>();
        coverageInput.put("from", coverage.from() == null ? null : coverage.from().toString());
        coverageInput.put("to", coverage.to() == null ? null : coverage.to().toString());
        output.put("coverage", coverageInput);
      } else output.put("coverage", null);
      recorder.succeedWhileLeased(invocationId, output, executionId, leaseOwner);
      progress.emit("tool-completed", null, Map.of("name", id, "label", label, "fact", compiled.objectKey(),
          "sql", result.sql(), "durationMs", elapsed(started),
          "output", Map.of("rows", result.rows().size(), "compareRows", result.compareRows().size())));
      return new ExecutedQuery(id, label, compiled, result, coverage);
    } catch (RuntimeException error) {
      progress.emit("tool-failed", null, Map.of("name", id, "label", label, "fact", compiled.objectKey(),
          "durationMs", elapsed(started),
          "error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()));
      failInvocation(invocationId, error, executionId, leaseOwner);
      throw error;
    }
  }

  private EasyVAgentTools.Output runObject(String id, EasyVAgentTools.Prepared call, EasyVAgentTools.Run run,
      AgentTurn turn, AuthSession principal, String executionId, String parent, String traceId, String leaseOwner,
      long deadline, ExecutionProgress progress) {
    String label = toolLabel(call.tool());
    Map<String, Object> input = new LinkedHashMap<>(); input.put("id", id); input.put("toolInput", call.input());
    input.put("executionId", executionId); input.put("datasetVersionSetId", runContextSet(call));
    input.put("request", call.request()); input.put("selection", call.selection());
    var access = run.access();
    input.put("productVersions", access.productVersions()); input.put("scope", access.scope());
    String invocation = recorder.start(turn.sessionId(), executionId, principal.userId(), "easyv-semantic-agent",
        call.tool(), "subtool", parent, input, traceId, leaseOwner);
    long started = System.nanoTime();
    progress.emit("tool-started", null, Map.of("name", id, "label", label, "input", call.input()));
    try {
      remainingMillis(deadline); var result = run.execute(id, call); remainingMillis(deadline);
      recorder.succeedWhileLeased(invocation, result.audit(), executionId, leaseOwner);
      progress.emit("tool-completed", null, Map.of("name", id, "label", result.label(), "durationMs", elapsed(started), "output", Map.of("rows", result.rows().size())));
      return result;
    } catch (RuntimeException error) {
      progress.emit("tool-failed", null, Map.of("name", id, "label", label, "durationMs", elapsed(started), "error", nonBlank(error.getMessage(), error.getClass().getSimpleName())));
      failInvocation(invocation, error, executionId, leaseOwner); throw error;
    }
  }
  private static String runContextSet(EasyVAgentTools.Prepared call) { return call.request() == null ? call.selection().datasetVersionSetId() : call.request().datasetVersionSetId(); }

  private String label(CompiledSemanticQuery compiled) {
    List<String> measures = new ArrayList<>();
    List<String> dimensions = new ArrayList<>();
    for (CompiledSemanticQuery.Column column : compiled.columns()) {
      switch (column.kind()) {
        case MEASURE -> measures.add(column.label());
        case DIMENSION -> dimensions.add(column.label());
        case TIME -> { }
      }
    }
    StringBuilder label = new StringBuilder(semantic.require(compiled.objectKey()).label())
        .append(" · ").append(String.join("、", measures));
    if (!dimensions.isEmpty()) label.append(" 按").append(String.join("、", dimensions));
    if (compiled.granularity() != null) label.append(" 按").append(granularityLabel(compiled.granularity()));
    return label.toString();
  }

  private static String granularityLabel(String granularity) {
    return switch (granularity) {
      case "day" -> "日";
      case "week" -> "周";
      case "month" -> "月";
      case "quarter" -> "季度";
      case "year" -> "年";
      default -> granularity;
    };
  }

  private List<Evidence> evidence(List<ExecutedQuery> executed, List<ExecutedTool> objectResults, OntologyCatalog ontology, String datasetVersionSetId,
                                  DatasetVersionSet versionSet, String dataScope) {
    List<Evidence> evidence = new ArrayList<>();
    Set<String> allProducts = new LinkedHashSet<>();
    for (ExecutedQuery query : executed) {
      allProducts.addAll(query.compiled().productKeys());
      Evidence.Provenance provenance =
          provenance(query.compiled().productKeys(), ontology, datasetVersionSetId, versionSet);
      if (!query.result().rows().isEmpty()) {
        evidence.add(new Evidence(QUERY_EVIDENCE_PREFIX + query.id(), query.label(),
            evidenceRows(query.result().rows()), provenance));
      }
      if (!query.result().compareRows().isEmpty()) {
        evidence.add(new Evidence(QUERY_EVIDENCE_PREFIX + query.id() + COMPARE_SUFFIX,
            query.label() + "（对比期 " + query.compiled().compareRange().description() + "）",
            evidenceRows(query.result().compareRows()), provenance));
      }
    }
    for (ExecutedTool tool : objectResults) {
      allProducts.addAll(tool.output().products());
      if (!tool.output().rows().isEmpty()) evidence.add(new Evidence(QUERY_EVIDENCE_PREFIX + tool.id(), tool.output().label(),
          evidenceRows(tool.output().rows()), provenance(tool.output().products(), ontology, datasetVersionSetId, versionSet)));
    }
    Map<String, Object> scopeRow = new LinkedHashMap<>();
    scopeRow.put("dataScope", dataScope);
    scopeRow.put("queryCount", executed.size());
    scopeRow.put("toolCount", executed.size() + objectResults.size());
    scopeRow.put("resultRows", executed.stream().mapToInt(query -> query.result().rows().size()).sum() + objectResults.stream().mapToInt(tool -> tool.output().rows().size()).sum());
    scopeRow.put("freshnessAt", versionSet.capturedAt().toString());
    evidence.add(0, new Evidence(DATA_SCOPE_EVIDENCE, "数据范围与冻结版本", List.of(scopeRow),
        provenance(allProducts, ontology, datasetVersionSetId, versionSet)));
    return List.copyOf(evidence);
  }

  private static List<Map<String, Object>> evidenceRows(List<Map<String, Object>> rows) {
    return rows.stream().limit(EVIDENCE_ROW_CAP).map(row -> {
      Map<String, Object> copy = new LinkedHashMap<>();
      row.forEach((key, value) -> copy.put(key, value == null ? "" : value));
      return (Map<String, Object>) copy;
    }).toList();
  }

  private static Evidence.Provenance provenance(Iterable<String> productKeys, OntologyCatalog ontology,
                                                String datasetVersionSetId, DatasetVersionSet versionSet) {
    Map<String, String> versions = new LinkedHashMap<>();
    for (String productKey : productKeys) {
      String version = versionSet.productVersionIds().get(productKey);
      if (version == null) {
        throw new BackendException("DATASET_VERSION_SET_INCOMPLETE",
            "冻结数据集版本缺少数据产品 " + productKey + "。");
      }
      versions.put(productKey, version);
    }
    return new Evidence.Provenance(ontology.versionId(), datasetVersionSetId, versionSet.capturedAt(), versions);
  }

  private List<Map<String, Object>> projections(List<ExecutedQuery> executed, List<ExecutedTool> objectResults, List<Evidence> evidence, boolean includeHandles) {
    Map<String, Evidence> bySource = new LinkedHashMap<>();
    evidence.forEach(item -> bySource.put(item.source(), item));
    List<Map<String, Object>> out = new ArrayList<>();
    for (ExecutedQuery query : executed) {
      out.add(projection(query.id(), query.label(), query.compiled().range().description(),
          query.compiled().range(), query, query.result().rows(),
          bySource.get(QUERY_EVIDENCE_PREFIX + query.id())));
      if (query.compiled().compareRange() != null) {
        out.add(projection(query.id() + COMPARE_SUFFIX, query.label() + "（对比期）",
            query.compiled().compareRange().description(), query.compiled().compareRange(), query,
            query.result().compareRows(),
            bySource.get(QUERY_EVIDENCE_PREFIX + query.id() + COMPARE_SUFFIX)));
      }
    }
    for (var tool : objectResults) {
      if (includeHandles) out.add(tool.output().observation());
      else {
        // 句柄仅供规划调用工具；回答使用真实业务字段，审计与证据保留原始结果。
        Map<String, Object> observation = new LinkedHashMap<>(tool.output().observation());
        observation.put("rows", tool.output().rows().stream().limit(EVIDENCE_ROW_CAP).map(row -> {
          Map<String, Object> values = new LinkedHashMap<>(row);
          values.remove("handle");
          return values;
        }).toList());
        out.add(observation);
      }
    }
    out.sort(java.util.Comparator.comparingInt(item -> Integer.parseInt(((String) item.get("id")).split(":")[0].substring(1))));
    return out;
  }

  private Map<String, Object> projection(String id, String label, String range,
                                                ResolvedTimeRange coverageRange, ExecutedQuery query,
                                                List<Map<String, Object>> rows, Evidence evidence) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", id);
    out.put("label", label);
    out.put("intent", QueryIntentCodec.write(query.compiled().intent()));
    out.put("range", range);
    DataCoverage dataCoverage = query.coverage();
    out.put("dataCoverage", dataCoverage == null || dataCoverage.empty() ? "无数据"
        : dataCoverage.from() + " 至 " + dataCoverage.to());
    TimeCoverage coverage = dataCoverage == null
        ? null : coverageRange.coverage(dataCoverage.from(), dataCoverage.to());
    out.put("coverageStatus", coverage == null ? "none" : lower(coverage.status()));
    if (coverage != null && coverage.status() == TimeCoverage.Status.PARTIAL) {
      out.put("effectiveRange", coverage.effectiveFrom() + " 至 " + coverage.effectiveTo());
    }
    out.put("columns", query.compiled().columns().stream()
        .map(column -> Map.of("key", column.key(), "label", column.label(), "kind", lower(column.kind()),
            "identifier", column.kind() == CompiledSemanticQuery.ColumnKind.DIMENSION
                && semantic.resolve(query.compiled().objectKey(), column.key()).property().identifier())).toList());
    out.put("totalRows", rows.size());
    out.put("rows", evidence == null ? List.of() : evidence.rows());
    return out;
  }

  private static List<GroundedConclusion.EvidenceReference> references(
      ComposedAnswer answer, List<Evidence> evidence, List<String> violations) {
    if (answer == null || answer.markdown() == null || answer.markdown().isBlank()) {
      violations.add("answer 不能为空");
      return List.of();
    }
    Map<String, Evidence> bySource = new LinkedHashMap<>();
    evidence.forEach(item -> bySource.put(item.source(), item));
    // 可引用值与下方 citation 校验同一规则；全空行（如比率 0/0 产生 null）不构成可引用证据
    boolean hasQueryEvidence = evidence.stream()
        .filter(item -> item.source().startsWith(QUERY_EVIDENCE_PREFIX))
        .anyMatch(item -> item.rows().stream()
            .anyMatch(row -> row.values().stream().anyMatch(EasyVSemanticAgent::citableValue)));
    List<GroundedConclusion.EvidenceReference> references = new ArrayList<>();
    for (Citation citation : answer.citations()) {
      Evidence item = citation.query() == null ? null : bySource.get(QUERY_EVIDENCE_PREFIX + citation.query());
      if (item == null) {
        violations.add("引用的查询不存在或无结果：" + citation.query());
        continue;
      }
      if (citation.row() < 0 || citation.row() >= item.rows().size()) {
        violations.add("引用 " + citation.query() + " 的行下标越界：" + citation.row());
        continue;
      }
      Object value = item.rows().get(citation.row()).get(citation.field());
      if (!citableValue(value)) {
        violations.add("引用 " + citation.query() + " 第 " + citation.row() + " 行的字段无效或为空：" + citation.field()
            + "；可引用字段：" + item.rows().get(citation.row()).entrySet().stream()
                .filter(entry -> citableValue(entry.getValue())).map(Map.Entry::getKey).toList());
        continue;
      }
      references.add(new GroundedConclusion.EvidenceReference(item.source(), citation.row(), citation.field(), value));
    }
    if (hasQueryEvidence && references.isEmpty() && violations.isEmpty()) {
      violations.add("citations 至少引用一个支撑结论的数据点");
    }
    if (!hasQueryEvidence) {
      Evidence scope = bySource.get(DATA_SCOPE_EVIDENCE);
      references.add(new GroundedConclusion.EvidenceReference(scope.source(), 0, "resultRows",
          scope.rows().getFirst().get("resultRows")));
    }
    return references;
  }

  private static boolean citableValue(Object value) {
    return value instanceof Number || value instanceof Boolean
        || (value instanceof String text && !text.isEmpty());
  }

  /** “我的理解”投影：每条已执行查询的对象、指标、维度、过滤、解析后时间与数据覆盖。 */
  private Map<String, Object> understanding(ExecutedQuery query) {
    CompiledSemanticQuery compiled = query.compiled();
    QueryIntent intent = compiled.intent();
    OntologyObjectType object = semantic.require(compiled.objectKey());
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("id", query.id());
    item.put("label", query.label());
    item.put("object", Map.of("key", object.key(), "label", object.label()));
    item.put("measures", compiled.columns().stream()
        .filter(column -> column.kind() == CompiledSemanticQuery.ColumnKind.MEASURE)
        .map(column -> Map.of("key", column.key(), "label", column.label())).toList());
    item.put("dimensions", compiled.columns().stream()
        .filter(column -> column.kind() == CompiledSemanticQuery.ColumnKind.DIMENSION)
        .map(column -> Map.of("key", column.key(), "label", memberLabel(object, column.key()))).toList());
    item.put("filters", intent.filters().stream().map(filter -> {
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("member", filter.member());
      entry.put("label", filterLabel(object, filter.member()));
      entry.put("operator", lower(filter.operator()));
      entry.put("values", filter.values());
      return (Map<String, Object>) entry;
    }).toList());
    String timePath = intent.time().dimension() == null || intent.time().dimension().isBlank()
        ? object.defaultTimeProperty() : intent.time().dimension();
    ResolvedTimeRange range = compiled.range();
    Map<String, Object> time = new LinkedHashMap<>();
    time.put("dimension", timePath);
    time.put("label", memberLabel(object, timePath));
    time.put("sourceText", intent.time().expression().sourceText());
    time.put("kind", lower(intent.time().expression().kind()));
    time.put("from", range.from() == null ? null : range.from().toString());
    time.put("to", range.to().toString());
    time.put("allData", range.allData());
    time.put("granularity", compiled.granularity());
    item.put("time", time);
    ResolvedTimeRange compare = compiled.compareRange();
    item.put("compare", compare == null ? null : Map.of("sourceText", compare.sourceText(),
        "from", compare.from().toString(), "to", compare.to().toString()));
    item.put("limit", intent.limit());
    DataCoverage dataCoverage = query.coverage();
    TimeCoverage coverage = dataCoverage == null
        ? null : range.coverage(dataCoverage.from(), dataCoverage.to());
    Map<String, Object> coverageMap = new LinkedHashMap<>();
    coverageMap.put("status", coverage == null ? "none" : lower(coverage.status()));
    coverageMap.put("dataFrom", dataCoverage == null || dataCoverage.from() == null
        ? null : dataCoverage.from().toString());
    coverageMap.put("dataTo", dataCoverage == null || dataCoverage.to() == null
        ? null : dataCoverage.to().toString());
    coverageMap.put("effectiveFrom", coverage == null || coverage.effectiveFrom() == null
        ? null : coverage.effectiveFrom().toString());
    coverageMap.put("effectiveTo", coverage == null || coverage.effectiveTo() == null
        ? null : coverage.effectiveTo().toString());
    item.put("coverage", coverageMap);
    return item;
  }

  /** 结构化调整编辑器目录：本轮执行涉及的每个根对象的可选指标与成员路径（与编译器接受的路径一致）。 */
  private Map<String, Object> editorCatalog(List<ExecutedQuery> executed) {
    List<Map<String, Object>> objects = new ArrayList<>();
    Set<String> seen = new LinkedHashSet<>();
    for (ExecutedQuery query : executed) {
      String key = query.compiled().objectKey();
      if (!seen.add(key)) continue;
      OntologyObjectType object = semantic.require(key);
      List<Map<String, Object>> dimensions = new ArrayList<>();
      List<Map<String, Object>> timeDimensions = new ArrayList<>();
      for (SemanticModel.ResolvedMember member : semantic.members(key)) {
        Map<String, Object> item = Map.of("key", member.path(), "label", memberLabel(member));
        (member.property().type() == OntologyProperty.Type.TIME ? timeDimensions : dimensions).add(item);
      }
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("key", object.key());
      entry.put("label", object.label());
      entry.put("defaultTime", object.defaultTimeProperty());
      entry.put("measures", object.metrics().stream()
          .map(metric -> Map.of("key", metric.key(), "label", metric.label())).toList());
      entry.put("dimensions", List.copyOf(dimensions));
      entry.put("timeDimensions", List.copyOf(timeDimensions));
      objects.add(entry);
    }
    return Map.of("objects", List.copyOf(objects));
  }

  /** 成员路径展示标签：一跳关联路径以“目标对象·属性”组合，标注数据来源对象。 */
  private String memberLabel(OntologyObjectType root, String path) {
    return memberLabel(semantic.resolve(root.key(), path));
  }

  private static String memberLabel(SemanticModel.ResolvedMember member) {
    return member.path().contains(".")
        ? member.owner().label() + "·" + member.property().label()
        : member.property().label();
  }

  /** 过滤成员标签：指标 key 取指标标签（HAVING），属性路径走成员解析。 */
  private String filterLabel(OntologyObjectType root, String member) {
    return root.findMetric(member).map(OntologyMetric::label).orElseGet(() -> memberLabel(root, member));
  }

  private static String lower(Enum<?> value) {
    return value.name().toLowerCase(Locale.ROOT).replace('_', '-');
  }

  private Map<String, Object> planSnapshot(AgentTurn turn, ResolvedScopeSnapshot scope, String dataScope,
                                           List<ExecutedQuery> executed, List<Evidence> evidence,
                                           ComposedAnswer answer, List<Map<String, Object>> performedSteps, List<Map<String, Object>> callTrace) {
    Map<String, Object> resolved = new LinkedHashMap<>(scope.values());
    resolved.put("dataScope", dataScope);
    resolved.put("queries", executed.stream().map(query -> {
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("id", query.id());
      item.put("label", query.label());
      item.put("intent", QueryIntentCodec.write(query.compiled().intent()));
      item.put("range", query.compiled().range().description());
      if (query.compiled().range().from() != null) item.put("from", query.compiled().range().from().toString());
      item.put("to", query.compiled().range().to().toString());
      if (query.compiled().compareRange() != null) {
        item.put("compareRange", query.compiled().compareRange().description());
      }
      return (Map<String, Object>) item;
    }).toList());
    Map<String, Object> plan = new LinkedHashMap<>();
    plan.put("_executionContract", turn.contract());
    if (turn.effectiveContext().get("objectSelection") != null) {
      ObjectSelection selection = ObjectSelection.read(turn.effectiveContext().get("objectSelection"));
      plan.put("_objectSelection", selection.snapshot());
      plan.put("_objectSelectionLabel", semantic.require(selection.reference().objectKey()).label() + " · " + selection.reference().objectId());
    }
    resolved.put("toolCalls", List.copyOf(callTrace));
    plan.put("_resolvedContext", Map.copyOf(resolved));
    if (!executed.isEmpty()) {
      plan.put("_understanding", executed.stream().map(this::understanding).toList());
      plan.put("_editorCatalog", editorCatalog(executed));
    }
    plan.put("_evidenceTypes", evidence.stream().map(Evidence::source).toList());
    plan.put("summary", "EasyV 数据问答");
    plan.put("mode", MODE);
    plan.put("steps", List.copyOf(performedSteps));
    if (!answer.suggestions().isEmpty()) plan.put("_suggestedQuestions", answer.suggestions());
    if (!answer.actions().isEmpty()) {
      plan.put("_suggestedActions", answer.actions().stream()
          .map(action -> Map.of("label", action.label(), "rationale", action.rationale())).toList());
    }
    if (turn.followUpId() != null) plan.put("_followUpId", turn.followUpId());
    if (turn.referencedExecutionId() != null) plan.put("_referencedExecutionId", turn.referencedExecutionId());
    return Map.copyOf(plan);
  }

  private static Map<String, Object> planStep(String id, int order, String kind, String title) {
    return Map.of("id", id, "order", order, "kind", kind, "title", title);
  }

  /** 累计回答文本按增量阈值上报，避免逐 token 写事件。 */
  private static Consumer<String> throttled(ExecutionProgress progress) {
    long[] lastAt = {0L};
    int[] lastLength = {0};
    return text -> {
      long now = System.nanoTime();
      if (text.length() - lastLength[0] >= 24 || now - lastAt[0] >= 150_000_000L) {
        lastAt[0] = now;
        lastLength[0] = text.length();
        progress.emitAnswerDelta(text);
      }
    };
  }

  private static Map<String, Object> step(String id, int order, String title, String status) {
    return Map.of("id", id, "order", order, "title", title, "status", status);
  }

  private static Map<String, Object> done(Map<String, Object> step, long started, String status) {
    Map<String, Object> out = new LinkedHashMap<>(step);
    out.put("status", status);
    out.put("durationMs", elapsed(started));
    return out;
  }

  /** 模型等待可取消；同步工具沿用各自超时，在调用前后核验整个轮次预算。 */
  static long remainingMillis(long deadline) {
    long remaining = (deadline - System.nanoTime()) / 1_000_000L;
    if (remaining <= 0) throw new BackendException("AGENT_EXECUTION_TIMEOUT", "EasyV 分析超过 180 秒执行时限。");
    return remaining;
  }

  private void failInvocation(String invocationId, RuntimeException error, String executionId, String leaseOwner) {
    String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    try {
      recorder.failWhileLeased(invocationId,
          error instanceof BackendException known ? known.code() : "WORKFLOW_FAILED", message, executionId, leaseOwner);
    } catch (RuntimeException auditError) {
      if (auditError instanceof BackendException known && "JOB_LEASE_LOST".equals(known.code())) {
        known.addSuppressed(error);
        throw known;
      }
      BackendException failure = new BackendException("INVOCATION_AUDIT_FAILURE", "EasyV 调用失败后审计写入失败。", auditError);
      failure.addSuppressed(error);
      throw failure;
    }
  }

  private static long elapsed(long started) {
    return (System.nanoTime() - started) / 1_000_000L;
  }

  private static String nonBlank(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value.trim();
  }
}
