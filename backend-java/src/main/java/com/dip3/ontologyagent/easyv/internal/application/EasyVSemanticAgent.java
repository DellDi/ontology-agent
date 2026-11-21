package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.ExecutionProgress;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposeRequest;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposedAnswer;
import com.dip3.ontologyagent.easyv.internal.application.EasyVToolCallPlanner.ToolCall;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVInvocationContract;
import com.dip3.ontologyagent.execution.InvocationEventRecorder;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery;
import com.dip3.ontologyagent.semantic.api.InitialObjectSelection;
import com.dip3.ontologyagent.semantic.api.ObjectQueryPort;
import com.dip3.ontologyagent.semantic.api.ObjectSelection;
import com.dip3.ontologyagent.semantic.api.QueryIntentCodec;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.AccessContext;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.DataCoverage;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.SemanticQueryResult;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * EasyV 语义分析 Agent：编排对象选择、规划循环、工具/查询执行与审计、证据校验与回答组装。
 * 具体规划编译、证据引文校验与快照组装分别委托给同包协作者，公开契约与事件格式不变。
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
  private static final String TOOL_LABEL = "执行 EasyV 语义分析";

  private final EasyVAnalysisModel model;
  private final SemanticQueryPort queries;
  private final DatasetVersionSetRegistry datasets;
  private final InvocationEventRecorder recorder;
  private final EasyVObjectSelectionService selections;
  private final EasyVAgentTools tools;
  private final EasyVToolCallPlanner planner;
  private final EasyVEvidenceValidator evidenceValidator;
  private final EasyVWorkflowAssembler assembler;

  public EasyVSemanticAgent(EasyVAnalysisModel model, SemanticModel semantic, SemanticQueryCompiler compiler,
                            SemanticQueryPort queries, DatasetVersionSetRegistry datasets,
                            InvocationEventRecorder recorder, EasyVObjectSelectionService selections,
                            EasyVAgentTools tools) {
    this.model = model;
    this.queries = queries;
    this.datasets = datasets;
    this.recorder = recorder;
    this.selections = selections;
    this.tools = tools;
    this.planner = new EasyVToolCallPlanner(model, semantic, compiler, selections);
    this.evidenceValidator = new EasyVEvidenceValidator(semantic);
    this.assembler = new EasyVWorkflowAssembler(semantic);
  }

  /** 一条已编译并执行的查询。 */
  record ExecutedQuery(String id, String label, CompiledSemanticQuery compiled, SemanticQueryResult result,
                       DataCoverage coverage) {}

  record ExecutedTool(String id, EasyVAgentTools.Output output) {}

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
    EasyVScopeResolver.dataScope(scope);
    String dataScope = EasyVScopeResolver.dataScopeLabel(scope);

    if (!turn.followUp() && turn.effectiveContext().containsKey("initialObjectSelection")) {
      var initial = InitialObjectSelection.read(turn.effectiveContext().get("initialObjectSelection"));
      turn = new AgentTurn(turn.contract(), turn.sessionId(), turn.questionText(), null, null, Map.of(),
          Map.of("objectSelection", initial.bind(executionId).snapshot()), turn.anchoredAt());
    }

    Map<String, Object> auditInput = new LinkedHashMap<>();
    auditInput.put("ontologyVersionId", ontology.versionId());
    auditInput.put("datasetVersionSetId", datasetVersionSetId);
    auditInput.put("dataScope", dataScope);
    auditInput.put("followUp", turn.followUp());
    if (turn.effectiveContext().get("objectSelection") != null) {
      auditInput.put("objectSelection", turn.effectiveContext().get("objectSelection"));
    }
    String invocationId = recorder.start(turn.sessionId(), executionId, principal.userId(), "easyv-semantic-agent",
        EasyVInvocationContract.TOOL_NAME, EasyVInvocationContract.CONTRACT.invocationType(), null, auditInput,
        traceId, leaseOwner);
    Map<String, Object> toolStep = step("analysis", 0, TOOL_LABEL, "running");
    long started = System.nanoTime();
    progress.emit("step-started", toolStep, null);
    progress.emit("tool-started", toolStep,
        Map.of("name", EasyVInvocationContract.TOOL_NAME, "label", TOOL_LABEL, "input", auditInput));
    try {
      WorkflowResult result = analyse(principal, turn, ontology, datasetVersionSetId, scope, versionSet, dataScope,
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

  /** 真实 A 规划评测保留入口，只开放指标工具，不执行模型输出。 */
  List<CompiledSemanticQuery> planQueries(String question, Instant anchoredAt, Map<String, Object> previousConclusion,
                                          List<Map<String, Object>> previousQueries) {
    return planner.planQueries(question, anchoredAt, previousConclusion, previousQueries);
  }

  private WorkflowResult analyse(AuthSession principal, AgentTurn turn, OntologyCatalog ontology,
                                 String datasetVersionSetId, ResolvedScopeSnapshot scope, DatasetVersionSet versionSet,
                                 String dataScope, String executionId, String parentInvocationId, String traceId,
                                 String leaseOwner, long deadline, ExecutionProgress progress) {
    remainingMillis(deadline);
    List<Map<String, Object>> performedSteps = new ArrayList<>();
    boolean override = planner.structuredOverride(turn);
    performedSteps.add(planStep("plan-queries", 1,
        override ? "structured-adjustment" : "llm-plan",
        override ? "应用结构化调整" : "理解问题并规划查询"));
    Map<String, Object> planStep = step("plan-queries", 1,
        override ? "应用结构化调整" : "理解问题并规划查询", "running");
    progress.emit("step-started", planStep, null);
    long planStarted = System.nanoTime();
    List<ToolCall> compiled;
    EasyVAgentTools.Run objectRun;
    ObjectQueryPort.Row selectedObject = null;
    try {
      List<ObjectQueryPort.Row> selectedObjects = List.of();
      if (turn.effectiveContext().get("objectSelection") != null) {
        var resolvedSelection = resolveSelection(principal, turn, datasetVersionSetId, scope, executionId,
            parentInvocationId, traceId, leaseOwner, deadline, planStep, progress);
        scope = resolvedSelection.scope();
        selectedObjects = resolvedSelection.objects();
        selectedObject = selectedObjects.size() == 1 ? resolvedSelection.object() : null;
      }
      var context = new CapabilityExecutionContext(principal, turn, executionId, ontology,
          datasetVersionSetId, traceId, leaseOwner, progress);
      objectRun = selectedObjects.size() > 1
          ? tools.openBatch(context, scope, versionSet.productVersionIds(), selectedObjects, List.of())
          : tools.open(context, scope, versionSet.productVersionIds(), selectedObject, planner.previousCalls(turn));
      scope = objectRun.currentScope();
      dataScope = EasyVScopeResolver.dataScopeLabel(scope);
      compiled = planner.plan(turn, selectedObject, List.of(), MAX_QUERIES, MAX_TOOL_CALLS,
          deadline, objectRun, versionSet);
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
        String label = call.metric() != null ? assembler.label(call.metric()) : EasyVToolCallPlanner.toolLabel(call.tool());
        performedSteps.add(planStep("query-" + id, performedSteps.size() + 1,
            call.metric() != null ? "semantic-query" : "object-tool", label));
        Map<String, Object> queryStep = step("query-" + id, performedSteps.size(), label, "running");
        progress.emit("step-started", queryStep, null);
        long queryStarted = System.nanoTime();
        try {
          List<ObjectQueryPort.Reference> refs;
          if (call.metric() != null) {
            executed.add(runMetricQuery(id, call.metric(), objectRun.access(), turn, principal, executionId,
                parentInvocationId, traceId, leaseOwner, deadline, progress));
            refs = call.input().containsKey("handle")
                ? List.of(objectRun.requireHandle(call.input().get("handle")).reference()) : List.of();
          } else {
            var output = runObjectTool(id, call.object(), objectRun, turn, principal, executionId,
                parentInvocationId, traceId, leaseOwner, deadline, progress);
            objectResults.add(new ExecutedTool(id, output));
            refs = output.references();
            label = output.label();
          }
          performedCalls.add(call);
          callTrace.add(Map.of("id", id, "tool", call.tool(), "label", label, "input", call.input(), "references", refs));
          progress.emit("step-completed", done(queryStep, queryStarted, "completed"), null);
        } catch (RuntimeException error) {
          progress.emit("step-completed", done(queryStep, queryStarted, "failed"), null);
          throw error;
        }
      }
      scope = objectRun.currentScope();
      dataScope = EasyVScopeResolver.dataScopeLabel(scope);
      if (override) break;
      String planningId = "plan-after-q" + performedCalls.size();
      String title = "根据查询结果决定下一步";
      performedSteps.add(planStep(planningId, performedSteps.size() + 1, "llm-plan", title));
      Map<String, Object> nextStep = step(planningId, performedSteps.size(), title, "running");
      progress.emit("step-started", nextStep, null);
      long nextStarted = System.nanoTime();
      try {
        List<Evidence> currentEvidence =
            evidenceValidator.evidence(executed, objectResults, ontology, datasetVersionSetId, versionSet, dataScope);
        List<Map<String, Object>> observations =
            evidenceValidator.projections(executed, objectResults, currentEvidence, true);
        compiled = planner.plan(turn, selectedObject, observations,
            MAX_QUERIES - executed.size(), MAX_TOOL_CALLS - performedCalls.size(), deadline, objectRun, versionSet);
        for (ToolCall call : compiled) {
          if (performedCalls.stream().anyMatch(prev -> prev.tool().equals(call.tool()) && prev.identity().equals(call.identity()))) {
            throw new BackendException("AGENT_TOOL_REPEATED", "EasyV 规划重复了本轮已执行的调用，请明确新的分析范围。");
          }
        }
        progress.emit("step-completed", done(nextStep, nextStarted, "completed"), null);
      } catch (RuntimeException error) {
        progress.emit("step-completed", done(nextStep, nextStarted, "failed"), null);
        throw error;
      }
    }
    objectRun.currentScope();
    objectRun.requireBatchCoverage();
    List<Evidence> evidence =
        evidenceValidator.evidence(executed, objectResults, ontology, datasetVersionSetId, versionSet, dataScope);

    ComposedResult composed = composeWithRetry(turn, dataScope, executed, objectResults, evidence,
        performedSteps, deadline, objectRun, progress);
    return assembler.assemble(turn, scope, dataScope, executed, objectResults, evidence,
        composed.answer(), composed.references(), performedSteps, callTrace, selectedObject, versionSet, datasetVersionSetId);
  }

  private record ComposedResult(ComposedAnswer answer, List<GroundedConclusion.EvidenceReference> references) {}

  private ComposedResult composeWithRetry(AgentTurn turn, String dataScope, List<ExecutedQuery> executed,
                                          List<ExecutedTool> objectResults, List<Evidence> evidence,
                                          List<Map<String, Object>> performedSteps, long deadline,
                                          EasyVAgentTools.Run objectRun, ExecutionProgress progress) {
    performedSteps.add(planStep("compose-answer", performedSteps.size() + 1, "llm-compose", "综合回答"));
    Map<String, Object> composeStep = step("compose-answer", performedSteps.size(), "综合回答", "running");
    progress.emit("step-started", composeStep, null);
    long composeStarted = System.nanoTime();
    try {
      ComposedAnswer answer = null;
      List<GroundedConclusion.EvidenceReference> references = null;
      List<String> violations = List.of();
      Consumer<String> sink = throttled(progress);
      for (int attempt = 1; attempt <= 2 && references == null; attempt += 1) {
        try {
          answer = objectRun.batchSelected()
              ? assembler.batchReviewAnswer(objectRun.batchCoverageLabel(), dataScope, objectResults)
              : model.compose(new ComposeRequest(turn.questionText(), dataScope,
                  evidenceValidator.projections(executed, objectResults, evidence, false),
                  violations, remainingMillis(deadline)), sink);
          remainingMillis(deadline);
          objectRun.currentScope();
        } catch (BackendException error) {
          if (!"EASYV_ANSWER_INVALID".equals(error.code())) throw error;
          violations = List.of(error.getMessage());
          continue;
        }
        List<String> found = new ArrayList<>();
        List<GroundedConclusion.EvidenceReference> resolved =
            evidenceValidator.validateAndGround(answer, executed, objectResults, evidence, found);
        if (found.isEmpty()) references = resolved;
        else violations = found;
      }
      if (references == null) {
        throw new BackendException("EASYV_ANSWER_UNGROUNDED",
            "这次分析的内容与来源未能核对一致，暂未生成可靠结论。可以重新分析，原型未被修改。",
            new IllegalStateException(String.join("；", violations)));
      }
      progress.emit("step-completed", done(composeStep, composeStarted, "completed"), null);
      return new ComposedResult(answer, references);
    } catch (RuntimeException error) {
      progress.emit("step-completed", done(composeStep, composeStarted, "failed"), null);
      throw error;
    }
  }

  private EasyVObjectSelectionService.Selected resolveSelection(AuthSession principal, AgentTurn turn,
                                                                String datasetVersionSetId, ResolvedScopeSnapshot scope,
                                                                String executionId, String parentInvocationId,
                                                                String traceId, String leaseOwner, long deadline,
                                                                Map<String, Object> planStep, ExecutionProgress progress) {
    ObjectSelection selection = ObjectSelection.read(turn.effectiveContext().get("objectSelection"));
    if (!selection.executionId().equals(turn.followUp() ? turn.referencedExecutionId() : executionId)
        || !selection.datasetVersionSetId().equals(datasetVersionSetId)) {
      throw new BackendException("OBJECT_VERSION_MISMATCH", "执行中的对象选择与来源轮次或冻结集合不一致。");
    }
    progress.emit("tool-started", planStep,
        Map.of("name", "read_selected_object", "label", "读取所选对象", "input", selection.snapshot()));
    String selectedInvocation = recorder.start(turn.sessionId(), executionId, principal.userId(),
        "easyv-semantic-agent", "read_selected_object", "subtool", parentInvocationId, selection.snapshot(),
        traceId, leaseOwner);
    try {
      remainingMillis(deadline);
      var selected = selections.requireDuringExecution(principal, scope, selection);
      remainingMillis(deadline);
      recorder.succeedWhileLeased(selectedInvocation, Map.of("reference", selected.object().reference(),
          "properties", selected.object().properties(), "scope", selected.scope().values()), executionId, leaseOwner);
      progress.emit("tool-completed", planStep, Map.of("name", "read_selected_object", "label", "读取所选对象",
          "output", Map.of("reference", selection.snapshot().get("reference"))));
      return selected;
    } catch (RuntimeException error) {
      progress.emit("tool-failed", planStep, Map.of("name", "read_selected_object", "label", "读取所选对象",
          "error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()));
      failInvocation(selectedInvocation, error, executionId, leaseOwner);
      throw error;
    }
  }

  private ExecutedQuery runMetricQuery(String id, CompiledSemanticQuery compiled, AccessContext access,
                                       AgentTurn turn, AuthSession principal, String executionId,
                                       String parentInvocationId, String traceId, String leaseOwner,
                                       long deadline, ExecutionProgress progress) {
    remainingMillis(deadline);
    String label = assembler.label(compiled);
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
    input.put("compareRange", compiled.compareRange() == null ? null : Map.of(
        "from", compiled.compareRange().from().toString(),
        "to", compiled.compareRange().to().toString(),
        "description", compiled.compareRange().description()));
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
      } else {
        output.put("coverage", null);
      }
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

  private EasyVAgentTools.Output runObjectTool(String id, EasyVAgentTools.Prepared call, EasyVAgentTools.Run run,
                                               AgentTurn turn, AuthSession principal, String executionId, String parent,
                                               String traceId, String leaseOwner, long deadline,
                                               ExecutionProgress progress) {
    String label = EasyVToolCallPlanner.toolLabel(call.tool());
    Map<String, Object> input = new LinkedHashMap<>();
    input.put("id", id);
    input.put("toolInput", call.input());
    input.put("executionId", executionId);
    input.put("datasetVersionSetId", run.datasetVersionSetId());
    input.put("request", call.request());
    input.put("selection", call.selection());
    var access = run.access();
    input.put("productVersions", access.productVersions());
    input.put("scope", access.scope());
    String invocation = recorder.start(turn.sessionId(), executionId, principal.userId(), "easyv-semantic-agent",
        call.tool(), "subtool", parent, input, traceId, leaseOwner);
    long started = System.nanoTime();
    progress.emit("tool-started", null, Map.of("name", id, "label", label, "input", call.input()));
    try {
      remainingMillis(deadline);
      var result = run.execute(id, call);
      remainingMillis(deadline);
      recorder.succeedWhileLeased(invocation, result.audit(), executionId, leaseOwner);
      progress.emit("tool-completed", null, Map.of("name", id, "label", result.label(), "durationMs", elapsed(started),
          "output", Map.of("rows", result.rows().size())));
      if (call.tool().equals("preview_block_improvement")) {
        var block = new LinkedHashMap<String, Object>(result.renderBlock());
        block.put("blockImprovement", Map.of("executionId", executionId, "invocationId", invocation));
        return new EasyVAgentTools.Output(result.label(), result.rows(), result.products(), result.observation(),
            result.audit(), Collections.unmodifiableMap(block), result.references());
      }
      return result;
    } catch (RuntimeException error) {
      progress.emit("tool-failed", null, Map.of("name", id, "label", label, "durationMs", elapsed(started),
          "error", nonBlank(error.getMessage(), error.getClass().getSimpleName())));
      failInvocation(invocation, error, executionId, leaseOwner);
      throw error;
    }
  }

  /** 模型等待可取消；同步工具沿用各自超时，在调用前后核验整个轮次预算。 */
  static long remainingMillis(long deadline) {
    long remaining = (deadline - System.nanoTime()) / 1_000_000L;
    if (remaining <= 0) throw new BackendException("AGENT_EXECUTION_TIMEOUT", "EasyV 分析超过 180 秒执行时限。");
    return remaining;
  }

  static String nonBlank(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value.trim();
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
}
