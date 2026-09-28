package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.ExecutionProgress;
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
import com.dip3.ontologyagent.semantic.api.QueryIntent;
import com.dip3.ontologyagent.semantic.api.QueryIntentCodec;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.AccessContext;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.DataCoverage;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.SemanticQueryResult;
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
import java.util.Map;
import java.util.Set;
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
  static final int EVIDENCE_ROW_CAP = 50;
  private static final String COMPARE_SUFFIX = ":compare";
  private static final String TOOL_LABEL = "执行 EasyV 语义分析";

  private final EasyVAnalysisModel model;
  private final SemanticModel semantic;
  private final SemanticQueryCompiler compiler;
  private final SemanticQueryPort queries;
  private final DatasetVersionSetRegistry datasets;
  private final InvocationEventRecorder recorder;

  public EasyVSemanticAgent(EasyVAnalysisModel model, SemanticModel semantic, SemanticQueryCompiler compiler,
                            SemanticQueryPort queries, DatasetVersionSetRegistry datasets,
                            InvocationEventRecorder recorder) {
    this.model = model;
    this.semantic = semantic;
    this.compiler = compiler;
    this.queries = queries;
    this.datasets = datasets;
    this.recorder = recorder;
  }

  /** 一条已编译并执行的查询。 */
  record ExecutedQuery(String id, String label, CompiledSemanticQuery compiled, SemanticQueryResult result,
                       DataCoverage coverage) {}

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
    String invocationId = recorder.start(turn.sessionId(), executionId, principal.userId(), "easyv-semantic-agent",
        EasyVInvocationContract.TOOL_NAME, EasyVInvocationContract.CONTRACT.invocationType(), null, auditInput,
        traceId, leaseOwner);
    Map<String, Object> toolStep = step("analysis", 0, TOOL_LABEL, "running");
    long started = System.nanoTime();
    progress.emit("step-started", toolStep, null);
    progress.emit("tool-started", toolStep,
        Map.of("name", EasyVInvocationContract.TOOL_NAME, "label", TOOL_LABEL, "input", auditInput));
    try {
      WorkflowResult result = analyse(turn, ontology, datasetVersionSetId, scope, versionSet, access, dataScope,
          progress);
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
      try {
        recorder.failWhileLeased(invocationId,
            error instanceof BackendException known ? known.code() : "WORKFLOW_FAILED", message,
            executionId, leaseOwner);
      } catch (RuntimeException auditError) {
        if (auditError instanceof BackendException known && "JOB_LEASE_LOST".equals(known.code())) {
          known.addSuppressed(error);
          throw known;
        }
        BackendException failure =
            new BackendException("INVOCATION_AUDIT_FAILURE", "EasyV 调用失败后审计写入失败。", auditError);
        failure.addSuppressed(error);
        throw failure;
      }
      throw error;
    }
  }

  private WorkflowResult analyse(AgentTurn turn, OntologyCatalog ontology, String datasetVersionSetId,
                                 ResolvedScopeSnapshot scope, DatasetVersionSet versionSet, AccessContext access,
                                 String dataScope, ExecutionProgress progress) {
    Map<String, Object> planStep = step("plan-queries", 1, "理解问题并规划查询", "running");
    progress.emit("step-started", planStep, null);
    long planStarted = System.nanoTime();
    List<CompiledSemanticQuery> compiled;
    try {
      compiled = plan(turn);
    } catch (RuntimeException error) {
      progress.emit("step-completed", done(planStep, planStarted, "failed"), null);
      throw error;
    }
    progress.emit("step-completed", done(planStep, planStarted, "completed"), null);

    Map<String, Object> runStep = step("run-queries", 2, "执行语义查询", "running");
    progress.emit("step-started", runStep, null);
    long runStarted = System.nanoTime();
    List<ExecutedQuery> executed = new ArrayList<>();
    try {
      for (int index = 0; index < compiled.size(); index += 1) {
        executed.add(run("q" + (index + 1), compiled.get(index), access, progress));
      }
    } catch (RuntimeException error) {
      progress.emit("step-completed", done(runStep, runStarted, "failed"), null);
      throw error;
    }
    progress.emit("step-completed", done(runStep, runStarted, "completed"), null);

    List<Evidence> evidence = evidence(executed, ontology, datasetVersionSetId, versionSet, dataScope);
    Map<String, Object> composeStep = step("compose-answer", 3, "综合回答", "running");
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
              projections(executed, evidence), violations), sink);
        } catch (BackendException error) {
          if (!"EASYV_ANSWER_INVALID".equals(error.code())) throw error;
          violations = List.of(error.getMessage());
          continue;
        }
        List<String> found = new ArrayList<>();
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
    List<Map<String, Object>> blocks = EasyVRenderBlocks.build(executed, answer.highlights());
    return new WorkflowResult(planSnapshot(turn, scope, dataScope, executed, evidence, answer), evidence,
        answer.markdown(), claims, blocks);
  }

  private List<CompiledSemanticQuery> plan(AgentTurn turn) {
    ZoneId zone = semantic.contributions().stream()
        .filter(item -> EasyVGenerationOntology.DOMAIN_KEY.equals(item.domainKey()))
        .findFirst()
        .orElseThrow(() -> new BackendException("EASYV_SEMANTIC_MODEL_MISSING", "语义层未注册 EasyV 本体。"))
        .businessZone();
    List<Map<String, Object>> catalog = QueryIntentCodec.catalog(semantic, EasyVGenerationOntology.DOMAIN_KEY);
    List<Map<String, Object>> previousQueries = turn.followUp() ? previousQueries(turn) : List.of();
    List<String> violations = List.of();
    for (int attempt = 1; attempt <= 2; attempt += 1) {
      PlanDecision decision;
      try {
        decision = model.plan(new PlanRequest(turn.questionText(), catalog,
            turn.anchoredAt().atZone(zone).toLocalDate().toString(), zone.getId(), turn.referencedConclusion(),
            previousQueries, violations));
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
        case READY -> {
          List<String> found = new ArrayList<>();
          List<CompiledSemanticQuery> compiled = compile(decision.queries(), turn.anchoredAt(), found);
          if (found.isEmpty()) return compiled;
          violations = found;
        }
      }
    }
    throw new BackendException("EASYV_PLAN_INVALID",
        "EasyV 查询规划两次均未通过本体校验：" + String.join("；", violations) + "。");
  }

  private List<CompiledSemanticQuery> compile(List<Object> raw, Instant anchoredAt, List<String> violations) {
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
    String choices = options == null || options.isEmpty() ? "" : "可选：" + String.join(" / ", options) + "。";
    return new BackendException("EASYV_CLARIFICATION_REQUIRED",
        "需要先确认：" + question + (choices.isEmpty() ? "" : " " + choices) + " 请补充后重新提问。");
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> previousQueries(AgentTurn turn) {
    Object raw = turn.effectiveContext().get("queries");
    if (!(raw instanceof List<?> list) || list.isEmpty()
        || list.stream().anyMatch(item -> !(item instanceof Map<?, ?>))) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问缺少上一轮已执行的查询意图。");
    }
    return list.stream().map(item -> (Map<String, Object>) item).toList();
  }

  private ExecutedQuery run(String id, CompiledSemanticQuery compiled, AccessContext access,
                            ExecutionProgress progress) {
    String label = label(compiled);
    long started = System.nanoTime();
    progress.emit("tool-started", null, Map.of("name", id, "label", label, "fact", compiled.objectKey(),
        "input", QueryIntentCodec.write(compiled.intent())));
    try {
      SemanticQueryResult result = queries.execute(compiled, access);
      DataCoverage coverage = queries.coverage(compiled, access);
      progress.emit("tool-completed", null, Map.of("name", id, "label", label, "fact", compiled.objectKey(),
          "sql", result.sql(), "durationMs", elapsed(started),
          "output", Map.of("rows", result.rows().size(), "compareRows", result.compareRows().size())));
      return new ExecutedQuery(id, label, compiled, result, coverage);
    } catch (RuntimeException error) {
      progress.emit("tool-failed", null, Map.of("name", id, "label", label, "fact", compiled.objectKey(),
          "durationMs", elapsed(started),
          "error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()));
      throw error;
    }
  }

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

  private List<Evidence> evidence(List<ExecutedQuery> executed, OntologyCatalog ontology, String datasetVersionSetId,
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
    Map<String, Object> scopeRow = new LinkedHashMap<>();
    scopeRow.put("dataScope", dataScope);
    scopeRow.put("queryCount", executed.size());
    scopeRow.put("resultRows", executed.stream().mapToInt(query -> query.result().rows().size()).sum());
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

  private static List<Map<String, Object>> projections(List<ExecutedQuery> executed, List<Evidence> evidence) {
    Map<String, Evidence> bySource = new LinkedHashMap<>();
    evidence.forEach(item -> bySource.put(item.source(), item));
    List<Map<String, Object>> out = new ArrayList<>();
    for (ExecutedQuery query : executed) {
      out.add(projection(query.id(), query.label(), query.compiled().range().description(), query,
          query.result().rows(), bySource.get(QUERY_EVIDENCE_PREFIX + query.id())));
      if (query.compiled().compareRange() != null) {
        out.add(projection(query.id() + COMPARE_SUFFIX, query.label() + "（对比期）",
            query.compiled().compareRange().description(), query, query.result().compareRows(),
            bySource.get(QUERY_EVIDENCE_PREFIX + query.id() + COMPARE_SUFFIX)));
      }
    }
    return out;
  }

  private static Map<String, Object> projection(String id, String label, String range, ExecutedQuery query,
                                                List<Map<String, Object>> rows, Evidence evidence) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", id);
    out.put("label", label);
    out.put("range", range);
    DataCoverage coverage = query.coverage();
    out.put("dataCoverage", coverage == null || coverage.empty() ? "无数据"
        : coverage.from() + " 至 " + coverage.to());
    out.put("columns", query.compiled().columns().stream()
        .map(column -> Map.of("key", column.key(), "label", column.label())).toList());
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
    boolean hasQueryEvidence = evidence.stream().anyMatch(item -> item.source().startsWith(QUERY_EVIDENCE_PREFIX));
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
      if (!(value instanceof String || value instanceof Number || value instanceof Boolean)
          || (value instanceof String text && text.isEmpty())) {
        violations.add("引用 " + citation.query() + " 第 " + citation.row() + " 行的字段无效或为空：" + citation.field());
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

  private static Map<String, Object> planSnapshot(AgentTurn turn, ResolvedScopeSnapshot scope, String dataScope,
                                                  List<ExecutedQuery> executed, List<Evidence> evidence,
                                                  ComposedAnswer answer) {
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
    List<Map<String, Object>> steps = new ArrayList<>();
    steps.add(planStep("plan-queries", 1, "llm-plan", "理解问题并规划查询"));
    for (int index = 0; index < executed.size(); index += 1) {
      steps.add(planStep("query-" + executed.get(index).id(), index + 2, "semantic-query",
          executed.get(index).label()));
    }
    steps.add(planStep("compose-answer", executed.size() + 2, "llm-compose", "综合回答"));
    Map<String, Object> plan = new LinkedHashMap<>();
    plan.put("_executionContract", turn.contract());
    plan.put("_resolvedContext", Map.copyOf(resolved));
    plan.put("_evidenceTypes", evidence.stream().map(Evidence::source).toList());
    plan.put("summary", "EasyV 数据问答");
    plan.put("mode", MODE);
    plan.put("steps", List.copyOf(steps));
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

  private static long elapsed(long started) {
    return (System.nanoTime() - started) / 1_000_000L;
  }

  private static String nonBlank(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value.trim();
  }
}
