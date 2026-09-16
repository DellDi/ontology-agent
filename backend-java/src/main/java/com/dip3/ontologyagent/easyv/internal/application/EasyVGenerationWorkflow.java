package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.ExecutionProgress;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVDateRange;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVFailureReason;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVQueryCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * 问题驱动的 EasyV 受控问答：LLM 规划目录内查询 key，服务端执行固定 SQL，
 * LLM 再基于真实结果生成回答；facts 聚合仍走确定性只读端口。
 */
@Service
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVGenerationWorkflow {
  private static final Duration MAX_FRESHNESS_AGE = Duration.ofHours(24);
  private static final Duration MAX_FUTURE_SKEW = Duration.ofMinutes(5);
  private static final int EVIDENCE_ROW_CAP = 50;
  private static final DateTimeFormatter BUSINESS_TIME =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(EasyVDateRange.BUSINESS_ZONE);
  private static final Map<String, String> COLUMN_LABELS = Map.ofEntries(
      Map.entry("application_count", "AI 应用数"),
      Map.entry("prototype_count", "原型数"),
      Map.entry("user_count", "用户数"),
      Map.entry("first_created_at", "最早创建时间"),
      Map.entry("last_created_at", "最近创建时间"),
      Map.entry("app_count", "应用数"),
      Map.entry("node_count", "节点数"),
      Map.entry("task_count", "任务数"),
      Map.entry("completed_count", "完成数"),
      Map.entry("failed_count", "失败数"),
      Map.entry("incomplete_count", "未完成数"),
      Map.entry("terminal_task_count", "终态任务数"),
      Map.entry("timed_terminal_task_count", "可计时终态任务数"),
      Map.entry("p50_ms", "耗时 P50（毫秒）"),
      Map.entry("p95_ms", "耗时 P95（毫秒）"),
      Map.entry("operation_count", "操作记录数"),
      Map.entry("rated_count", "有效评分数"),
      Map.entry("average_rating", "平均评分"),
      Map.entry("save_as_edit_count", "另存编辑数"),
      Map.entry("combined_success_count", "组合成功数"),
      Map.entry("combined_failure_count", "组合失败数"),
      Map.entry("label", "项目"),
      Map.entry("value", "数值"));
  private final EasyVGenerationFacts facts;
  private final EasyVQuestionAnalyst analyst;

  public EasyVGenerationWorkflow(EasyVGenerationFacts facts, EasyVQuestionAnalyst analyst) {
    this.facts = facts;
    this.analyst = analyst;
  }

  public WorkflowResult execute(EasyVGenerationRequest request) {
    return execute(request, ExecutionProgress.NOOP);
  }

  public WorkflowResult execute(EasyVGenerationRequest request, ExecutionProgress progress) {
    validateRequest(request);
    Map<String, Object> snapshotStep = step("load-snapshot", 1, "读取分析数据快照", "running");
    progress.emit("step-started", snapshotStep, null);
    long snapshotStart = System.nanoTime();
    EasyVGenerationFacts.Snapshot snapshot;
    try {
      snapshot =
          requireFacts(
              facts.collect(
                new EasyVGenerationFacts.Query(
                    request.executionId(),
                    request.userId(),
                    request.accessMode(),
                    request.ontologyVersionId(),
                    request.datasetVersionSetId(),
                    request.from(),
                    request.to(),
                    request.requestedAt())),
            request);
    } catch (RuntimeException error) {
      progress.emit("step-completed", stepDone(snapshotStep, elapsed(snapshotStart), "failed"), null);
      throw error;
    }
    progress.emit("step-completed", stepDone(snapshotStep, elapsed(snapshotStart), null), null);
    EasyVGenerationResult result = buildResult(request, snapshot, progress);
    return result.toWorkflowResult();
  }

  private EasyVGenerationFacts.Snapshot requireFacts(
      EasyVGenerationFacts.Snapshot snapshot, EasyVGenerationRequest request) {
    if (snapshot == null
        || snapshot.application() == null
        || snapshot.pipeline() == null
        || snapshot.forge() == null
        || snapshot.feedback() == null) {
      throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV 四类分析事实必须全部返回。");
    }
    validateWindow(snapshot.application().window(), request);
    validateWindow(snapshot.pipeline().window(), request);
    validateWindow(snapshot.forge().window(), request);
    validateWindow(snapshot.feedback().window(), request);
    if (snapshot.application().applicationCount() <= 0
        || snapshot.pipeline().taskCount() <= 0
        || snapshot.forge().taskCount() <= 0
        || snapshot.feedback().operationCount() <= 0) {
      throw new BackendException("EASYV_FACTS_EMPTY", "EasyV 授权范围内缺少可分析的四类聚合事实。");
    }
    validateCounts(snapshot);
    return snapshot;
  }

  private static void validateWindow(EasyVGenerationFacts.FactWindow window, EasyVGenerationRequest request) {
    if (window == null
        || !request.userId().equals(window.userId())
        || !request.accessMode().equals(window.accessMode())
        || !request.from().equals(window.from())
        || !request.to().equals(window.to())
        || window.freshnessAt() == null) {
      throw new BackendException("EASYV_FACTS_SCOPE_INVALID", "EasyV 事实范围或时间窗口与执行请求不一致。");
    }
    Duration age = Duration.between(window.freshnessAt(), request.requestedAt());
    if (age.compareTo(MAX_FUTURE_SKEW.negated()) < 0 || age.compareTo(MAX_FRESHNESS_AGE) > 0) {
      throw new BackendException("EASYV_FACTS_STALE", "EasyV 事实新鲜度不满足当前分析要求。");
    }
  }

  private static void validateCounts(EasyVGenerationFacts.Snapshot snapshot) {
    EasyVGenerationFacts.PipelineFacts pipeline = snapshot.pipeline();
    EasyVGenerationFacts.ForgeFacts forge = snapshot.forge();
    EasyVGenerationFacts.FeedbackFacts feedback = snapshot.feedback();
    if (snapshot.application().applicationCount() < 0
        || snapshot.application().prototypeCount() < 0
        || snapshot.application().prototypeCount() > snapshot.application().applicationCount()
        || pipeline.taskCount() < 0
        || pipeline.completedTaskCount() < 0
        || pipeline.failedTaskCount() < 0
        || pipeline.incompleteTaskCount() < 0
        || pipeline.completedTaskCount() + pipeline.failedTaskCount() + pipeline.incompleteTaskCount()
            != pipeline.taskCount()
        || pipeline.mainNodeCount() < 0
        || pipeline.timedNodeCount() < 0
        || pipeline.timedNodeCount() > pipeline.mainNodeCount()
        || pipeline.mainNodeCount() == 0
        || pipeline.bottleneckStep() == null
        || pipeline.bottleneckStep().isBlank()
        || pipeline.bottleneckP95Millis() < 0
        || forge.taskCount() < 0
        || forge.completedTaskCount() < 0
        || forge.failedTaskCount() < 0
        || forge.cancelledTaskCount() < 0
        || forge.completedTaskCount() + forge.failedTaskCount() + forge.cancelledTaskCount() > forge.taskCount()
        || forge.terminalTaskCount() < 0
        || forge.terminalTaskCount() > forge.taskCount()
        || forge.terminalTaskCount()
            != forge.completedTaskCount() + forge.failedTaskCount() + forge.cancelledTaskCount()
        || forge.timedTerminalTaskCount() < 0
        || forge.timedTerminalTaskCount() > forge.terminalTaskCount()
        || forge.timedTerminalTaskCount() == 0
        || forge.p50DurationMillis() < 0
        || forge.p95DurationMillis() < forge.p50DurationMillis()
        || feedback.ratedCount() < 0
        || feedback.ratedCount() > feedback.operationCount()
        || feedback.saveAsEditCount() < 0
        || feedback.saveAsEditCount() > feedback.operationCount()
        || feedback.combinedExecuteSuccessCount() < 0
        || feedback.combinedExecuteFailureCount() < 0
        || feedback.combinedExecuteSuccessCount() + feedback.combinedExecuteFailureCount()
            > feedback.operationCount()
        || feedback.ratedCount() > 0 && (!Double.isFinite(feedback.averageRating())
            || feedback.averageRating() < 0 || feedback.averageRating() > 5)) {
      throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV 聚合事实的计数或统计口径不一致。");
    }
    long failureReasonTotal =
        forge.failureReasonCounts().values().stream().mapToLong(value -> value == null ? -1 : value).sum();
    if (forge.failureReasonCounts().entrySet().stream()
            .anyMatch(
                entry ->
                    entry.getKey() == null
                        || entry.getValue() == null
                        || entry.getValue() < 0)
        || forge.failedTaskCount() > 0
            && (forge.failureReasonCounts().isEmpty() || failureReasonTotal != forge.failedTaskCount())) {
      throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV 失败原因聚合包含无效字段。");
    }
  }

  private EasyVGenerationResult buildResult(
      EasyVGenerationRequest request, EasyVGenerationFacts.Snapshot snapshot,
      ExecutionProgress progress) {
    String rangeDescription =
        new EasyVDateRange(request.from(), request.to()).describe() + "，上海时区";
    Map<String, Object> planStep = step("plan-queries", 2, "分析问题并规划查询", "running");
    progress.emit("step-started", planStep, null);
    long planStart = System.nanoTime();
    List<String> keys;
    try {
      keys = planKeys(request.questionText());
    } catch (RuntimeException error) {
      progress.emit("step-completed", stepDone(planStep, elapsed(planStart), "failed"), null);
      throw error;
    }
    progress.emit("step-completed",
        stepDone(planStep, elapsed(planStart), null, keys.size()), null);
    Map<String, Object> queryStep = step("run-queries", 3, "执行数据查询", "running");
    progress.emit("step-started", queryStep, null);
    long queryStart = System.nanoTime();
    List<EasyVQuestionAnalyst.QueryResult> results;
    try {
      results = executeQueries(request, keys, progress);
    } catch (RuntimeException error) {
      progress.emit("step-completed", stepDone(queryStep, elapsed(queryStart), "failed"), null);
      throw error;
    }
    progress.emit("step-completed",
        stepDone(queryStep, elapsed(queryStart), null, results.size()), null);
    Map<String, Object> composeStep = step("compose-answer", 4, "基于事实生成回答", "running");
    progress.emit("step-started", composeStep, null);
    long composeStart = System.nanoTime();
    // 流式回答：累计文本经节流后转为 answer-delta 事件（每 chunk 落库成本过高，按增量/间隔节流）
    java.util.function.Consumer<String> answerSink = answerDeltaSink(progress);
    EasyVQuestionAnalyst.ComposedAnswer answer;
    try {
      answer = analyst.composeAnswer(request.questionText(), rangeDescription, results, answerSink);
    } catch (RuntimeException error) {
      progress.emit("step-completed", stepDone(composeStep, elapsed(composeStart), "failed"), null);
      throw error;
    }
    progress.emit("step-completed", stepDone(composeStep, elapsed(composeStart), null), null);
    List<Evidence> evidence = evidence(request, snapshot, results);
    List<GroundedConclusion.EvidenceReference> refs =
        evidence.stream()
            .filter(item -> item.source().startsWith("easyv-query:"))
            .map(item -> ref(item, "rows", item.rows().size()))
            .toList();
    // 全部查询为空时，回答仍须落地到快照证据（如"该维度无数据"由快照计数行支撑）。
    if (refs.isEmpty()) {
      Evidence application = evidence.get(0);
      refs = List.of(ref(application, "applicationCount",
          application.rows().get(0).get("applicationCount")));
    }
    List<GroundedConclusion.Claim> claims =
        List.of(claim("direct-answer", answer.markdown(),
            refs.toArray(GroundedConclusion.EvidenceReference[]::new)));
    Map<String, Object> resolvedContext =
        Map.of(
            "entity", request.entityKey(),
            "metric", request.metricKey(),
            "time", request.timeKey(),
            "from", request.from().toString(),
            "to", request.to().toString(),
            "accessMode", request.accessMode(),
            "userId", request.userId());
    List<Map<String, Object>> steps = new ArrayList<>();
    steps.add(Map.of("id", "validate-scope-and-time", "order", 1,
        "kind", "deterministic-validation", "title", "校验范围与时间"));
    steps.add(Map.of("id", "plan-queries", "order", 2,
        "kind", "llm-plan", "title", "分析问题并规划查询"));
    for (int index = 0; index < results.size(); index += 1) {
      EasyVQuestionAnalyst.QueryResult result = results.get(index);
      steps.add(Map.of("id", "query-" + result.spec().key(), "order", 3 + index,
          "kind", "aggregate-facts", "title", result.spec().label()));
    }
    steps.add(Map.of("id", "compose-answer", "order", 3 + results.size(),
        "kind", "llm-compose", "title", "基于事实生成回答"));
    Map<String, Object> plan = new LinkedHashMap<>();
    plan.put("_executionContract", request.executionContract());
    plan.put("_resolvedContext", resolvedContext);
    plan.put("_evidenceTypes", evidence.stream().map(Evidence::source).toList());
    plan.put("summary", "EasyV 数据问答");
    plan.put("mode", "question-driven-read-only");
    plan.put("steps", steps);
    if (!answer.suggestions().isEmpty()) {
      plan.put("_suggestedQuestions", answer.suggestions());
    }
    if (!answer.actions().isEmpty()) {
      plan.put("_suggestedActions", answer.actions().stream()
          .map(action -> Map.<String, Object>of(
              "label", action.label(), "rationale", action.rationale()))
          .toList());
    }
    if (request.followUpId() != null) plan.put("_followUpId", request.followUpId());
    if (request.referencedExecutionId() != null) {
      plan.put("_referencedExecutionId", request.referencedExecutionId());
    }
    plan = Map.copyOf(plan);
    String lead = answer.markdown();
    List<Map<String, Object>> blocks = renderBlocks(results, answer, lead);
    return new EasyVGenerationResult(plan, evidence, claims, blocks, lead);
  }

  /** answer-delta 节流：文本累计增长 ≥24 字符或距上次 ≥150ms 才发事件，避免每 token 落库。 */
  private static java.util.function.Consumer<String> answerDeltaSink(ExecutionProgress progress) {
    return new java.util.function.Consumer<>() {
      private int lastLength;
      private long lastAt;

      @Override
      public void accept(String accumulated) {
        long now = System.currentTimeMillis();
        int length = accumulated == null ? 0 : accumulated.length();
        if (length - lastLength >= 24 || now - lastAt >= 150) {
          lastLength = length;
          lastAt = now;
          progress.emitAnswerDelta(accumulated);
        }
      }
    };
  }

  private List<String> planKeys(String question) {
    try {
      List<String> keys = analyst.planQueries(question, EasyVQueryCatalog.all());
      return keys.stream().filter(EasyVQueryCatalog::contains).distinct().toList();
    } catch (BackendException error) {
      return EasyVQueryCatalog.DEFAULT_KEYS;
    }
  }

  private List<EasyVQuestionAnalyst.QueryResult> executeQueries(
      EasyVGenerationRequest request, List<String> keys, ExecutionProgress progress) {
    if (keys.isEmpty()) {
      keys = EasyVQueryCatalog.DEFAULT_KEYS;
    }
    EasyVGenerationFacts.Query scope =
        new EasyVGenerationFacts.Query(
            request.executionId(), request.userId(), request.accessMode(),
            request.ontologyVersionId(), request.datasetVersionSetId(),
            request.from(), request.to(), request.requestedAt());
    List<EasyVQuestionAnalyst.QueryResult> results = new ArrayList<>();
    for (String key : keys) {
      EasyVQueryCatalog.Spec spec = EasyVQueryCatalog.require(key);
      Map<String, Object> tool = new LinkedHashMap<>();
      tool.put("name", spec.key());
      tool.put("label", spec.label());
      tool.put("fact", spec.fact());
      progress.emit("tool-started", null, tool);
      long toolStart = System.nanoTime();
      try {
        EasyVGenerationFacts.Aggregation aggregation = facts.aggregate(scope, key);
        List<Map<String, Object>> rows = normalizeRows(spec.key(), aggregation.rows());
        Map<String, Object> done = new LinkedHashMap<>(tool);
        done.put("sql", aggregation.sql());
        done.put("durationMs", elapsed(toolStart));
        done.put("output", Map.of("rows", rows.size()));
        progress.emit("tool-completed", null, done);
        results.add(new EasyVQuestionAnalyst.QueryResult(spec, rows));
      } catch (RuntimeException error) {
        Map<String, Object> failed = new LinkedHashMap<>(tool);
        failed.put("durationMs", elapsed(toolStart));
        failed.put("error", error.getMessage() == null ? error.getClass().getSimpleName()
            : error.getMessage());
        progress.emit("tool-failed", null, failed);
        throw error;
      }
    }
    return List.copyOf(results);
  }

  private static Map<String, Object> step(String id, int order, String title, String status) {
    Map<String, Object> step = new LinkedHashMap<>();
    step.put("id", id);
    step.put("order", order);
    step.put("title", title);
    step.put("status", status);
    return step;
  }

  private static Map<String, Object> stepDone(Map<String, Object> step, long durationMs,
                                              String status) {
    return stepDone(step, durationMs, status, null);
  }

  private static Map<String, Object> stepDone(Map<String, Object> step, long durationMs,
                                              String status, Integer toolCount) {
    Map<String, Object> done = new LinkedHashMap<>(step);
    done.put("status", status == null ? "completed" : status);
    done.put("durationMs", durationMs);
    if (toolCount != null) done.put("toolCount", toolCount);
    return done;
  }

  private static long elapsed(long nanoStart) {
    return Duration.ofNanos(System.nanoTime() - nanoStart).toMillis();
  }

  /** 行值归一化：时间戳转上海时区文本；失败原因 label 归一化为中文标签并保留原文。 */
  private static List<Map<String, Object>> normalizeRows(String key, List<Map<String, Object>> rows) {
    List<Map<String, Object>> normalized = new ArrayList<>(rows.size());
    for (Map<String, Object> row : rows) {
      Map<String, Object> out = new LinkedHashMap<>();
      row.forEach((column, value) -> out.put(column, normalizeValue(value)));
      if ("forge-failure-reasons".equals(key) && out.get("label") instanceof String raw) {
        out.put("raw_label", raw);
        out.put("label", EasyVFailureReason.label(raw));
      }
      normalized.add(Map.copyOf(out));
    }
    return List.copyOf(normalized);
  }

  private static Object normalizeValue(Object value) {
    if (value instanceof java.sql.Timestamp timestamp) {
      return BUSINESS_TIME.format(timestamp.toInstant());
    }
    if (value instanceof java.time.temporal.TemporalAccessor temporal) {
      return BUSINESS_TIME.format(java.time.Instant.from(temporal));
    }
    if (value instanceof Number number) {
      double asDouble = number.doubleValue();
      if (!Double.isFinite(asDouble)) {
        return 0L;
      }
      if (number instanceof Double || number instanceof Float || number instanceof java.math.BigDecimal) {
        return asDouble == Math.rint(asDouble) ? number.longValue() : asDouble;
      }
      return number.longValue();
    }
    return value == null ? "" : value;
  }

  private static List<Map<String, Object>> renderBlocks(
      List<EasyVQuestionAnalyst.QueryResult> results,
      EasyVQuestionAnalyst.ComposedAnswer answer,
      String lead) {
    Map<String, String> highlightViz = new LinkedHashMap<>();
    answer.highlights().forEach(highlight -> highlightViz.put(highlight.queryKey(), highlight.viz()));
    List<Map<String, Object>> blocks = new ArrayList<>();
    // 回答文本经 conclusion/primaryAnswer 通道单独展示，不再重复发 markdown 块。
    for (EasyVQuestionAnalyst.QueryResult result : results) {
      String viz = highlightViz.getOrDefault(result.spec().key(), "none");
      String role = "none".equals(viz) ? "supporting" : "primary";
      if ("none".equals(viz) && result.spec().shape() == EasyVQueryCatalog.Shape.SERIES
          && result.rows().size() > 1) {
        viz = "table";
      }
      blocks.add(resultBlock(result, viz, role));
    }
    return List.copyOf(blocks);
  }

  private static Map<String, Object> resultBlock(
      EasyVQuestionAnalyst.QueryResult result, String viz, String role) {
    EasyVQueryCatalog.Spec spec = result.spec();
    List<Map<String, Object>> rows = result.rows();
    Map<String, Object> block = new LinkedHashMap<>();
    block.put("title", spec.label());
    block.put("role", role);
    boolean chartable = !rows.isEmpty() && rows.stream()
        .allMatch(row -> row.get("value") instanceof Number n && Double.isFinite(n.doubleValue()));
    if (spec.shape() == EasyVQueryCatalog.Shape.SERIES && ("bar".equals(viz) || "pie".equals(viz)
        || "line".equals(viz)) && chartable) {
      block.put("type", "chart");
      block.put("chartType", viz);
      block.put("series", List.of(Map.of(
          "name", spec.label(),
          "points", rows.stream()
              .map(row -> Map.<String, Object>of(
                  "label", String.valueOf(row.getOrDefault("label", "")),
                  "value", row.get("value")))
              .toList())));
    } else if (spec.shape() == EasyVQueryCatalog.Shape.RECORD) {
      block.put("type", "kv-list");
      Map<String, Object> first = rows.isEmpty() ? Map.of() : rows.getFirst();
      List<Map<String, Object>> items = new ArrayList<>();
      first.forEach((column, value) ->
          items.add(Map.of("label", columnLabel(column), "value", String.valueOf(value))));
      block.put("items", items);
    } else {
      block.put("type", "table");
      Set<String> columns = new LinkedHashSet<>();
      rows.forEach(row -> columns.addAll(row.keySet()));
      List<String> ordered = new ArrayList<>(columns);
      ordered.sort(Comparator.comparing(column -> column.equals("label") ? ""
          : column.equals("value") ? " " : column));
      block.put("columns", ordered.stream().map(EasyVGenerationWorkflow::columnLabel).toList());
      block.put("rows", rows.stream()
          .map(row -> ordered.stream()
              .map(column -> String.valueOf(row.getOrDefault(column, "")))
              .toList())
          .toList());
    }
    return Map.copyOf(block);
  }

  private static String columnLabel(String column) {
    return COLUMN_LABELS.getOrDefault(column, column);
  }

  private static List<Evidence> evidence(
      EasyVGenerationRequest request, EasyVGenerationFacts.Snapshot snapshot,
      List<EasyVQuestionAnalyst.QueryResult> results) {
    List<Evidence> evidence = new ArrayList<>(snapshotEvidence(request, snapshot));
    for (EasyVQuestionAnalyst.QueryResult result : results) {
      // 空结果不能构成证据行；由回答文本如实表述"该维度无数据"。
      if (result.rows().isEmpty()) continue;
      evidence.add(new Evidence(
          "easyv-query:" + result.spec().key(),
          result.spec().label(),
          result.rows().stream().limit(EVIDENCE_ROW_CAP).toList(),
          provenance(request, snapshot, snapshot.application().window().freshnessAt(),
              productFor(result.spec().fact()))));
    }
    return List.copyOf(evidence);
  }

  private static String productFor(String fact) {
    return switch (fact) {
      case "pipeline" -> "easyv-pipeline-node";
      case "forge" -> "easyv-forge-task";
      case "feedback" -> "easyv-generation-feedback";
      default -> "easyv-ai-application";
    };
  }

  private static List<Evidence> snapshotEvidence(
      EasyVGenerationRequest request, EasyVGenerationFacts.Snapshot snapshot) {
    EasyVGenerationFacts.ApplicationFacts application = snapshot.application();
    EasyVGenerationFacts.PipelineFacts pipeline = snapshot.pipeline();
    EasyVGenerationFacts.ForgeFacts forge = snapshot.forge();
    EasyVGenerationFacts.FeedbackFacts feedback = snapshot.feedback();
    return List.of(
        new Evidence(
            "easyv-ai-application",
            "EasyV AI 应用聚合",
            List.of(Map.of(
                "applicationCount", application.applicationCount(),
                "prototypeCount", application.prototypeCount(),
                "freshnessAt", application.window().freshnessAt().toString())),
            provenance(request, snapshot, application.window().freshnessAt(),
                "easyv-ai-application", "easyv-prototype-task")),
        new Evidence(
            "easyv-pipeline-node",
            "EasyV 原型阶段聚合",
            List.of(
                Map.of(
                    "taskCount", pipeline.taskCount(),
                    "completedTaskCount", pipeline.completedTaskCount(),
                    "failedTaskCount", pipeline.failedTaskCount(),
                    "incompleteTaskCount", pipeline.incompleteTaskCount(),
                    "mainNodeCount", pipeline.mainNodeCount(),
                    "timedNodeCount", pipeline.timedNodeCount(),
                    "bottleneckStep", pipeline.bottleneckStep(),
                    "bottleneckP95Millis", pipeline.bottleneckP95Millis(),
                    "freshnessAt", pipeline.window().freshnessAt().toString())),
            provenance(request, snapshot, pipeline.window().freshnessAt(), "easyv-pipeline-node")),
        new Evidence(
            "easyv-forge-task",
            "EasyV Forge 任务聚合",
            List.of(
                Map.ofEntries(
                    Map.entry("taskCount", forge.taskCount()),
                    Map.entry("completedTaskCount", forge.completedTaskCount()),
                    Map.entry("failedTaskCount", forge.failedTaskCount()),
                    Map.entry("cancelledTaskCount", forge.cancelledTaskCount()),
                    Map.entry("terminalTaskCount", forge.terminalTaskCount()),
                    Map.entry("timedTerminalTaskCount", forge.timedTerminalTaskCount()),
                    Map.entry("p50DurationMillis", forge.p50DurationMillis()),
                    Map.entry("p95DurationMillis", forge.p95DurationMillis()),
                    Map.entry("failureReasonCounts", Map.copyOf(failureReasonLabels(forge))),
                    Map.entry("topFailureReason", topFailureReason(forge)),
                    Map.entry("freshnessAt", forge.window().freshnessAt().toString()))),
            provenance(request, snapshot, forge.window().freshnessAt(), "easyv-forge-task")),
        new Evidence(
            "easyv-generation-feedback",
            "EasyV 生成反馈聚合",
            List.of(feedbackRow(feedback)),
            provenance(request, snapshot, feedback.window().freshnessAt(),
                "easyv-generation-feedback")));
  }

  private static Map<String, Object> feedbackRow(EasyVGenerationFacts.FeedbackFacts feedback) {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("operationCount", feedback.operationCount());
    row.put("ratedCount", feedback.ratedCount());
    if (Double.isFinite(feedback.averageRating())) {
      row.put("averageRating", feedback.averageRating());
    }
    row.put("saveAsEditCount", feedback.saveAsEditCount());
    row.put("combinedExecuteSuccessCount", feedback.combinedExecuteSuccessCount());
    row.put("combinedExecuteFailureCount", feedback.combinedExecuteFailureCount());
    row.put("freshnessAt", feedback.window().freshnessAt().toString());
    return Map.copyOf(row);
  }

  private static Evidence.Provenance provenance(
      EasyVGenerationRequest request, EasyVGenerationFacts.Snapshot snapshot, Instant freshnessAt,
      String... productKeys) {
    Map<String, String> versions = new LinkedHashMap<>();
    for (String productKey : productKeys) {
      String versionId = snapshot.productVersionIds().get(productKey);
      if (versionId == null || versionId.isBlank()) {
        throw new BackendException("DATASET_VERSION_SET_INCOMPLETE",
            "EasyV 数据版本集合缺少产品: " + productKey);
      }
      versions.put(productKey, versionId);
    }
    return new Evidence.Provenance(
        request.ontologyVersionId(), request.datasetVersionSetId(), freshnessAt, versions);
  }

  private static GroundedConclusion.Claim claim(
      String kind, String text, GroundedConclusion.EvidenceReference... refs) {
    return new GroundedConclusion.Claim(kind, text, List.of(refs));
  }

  private static GroundedConclusion.EvidenceReference ref(Evidence evidence, String field, Object value) {
    return new GroundedConclusion.EvidenceReference(evidence.source(), 0, field, value);
  }

  private static Map<String, Long> failureReasonLabels(EasyVGenerationFacts.ForgeFacts forge) {
    Map<String, Long> labels = new LinkedHashMap<>();
    forge.failureReasonCounts().forEach((raw, count) ->
        labels.merge(EasyVFailureReason.label(raw), count, Long::sum));
    return labels;
  }

  private static String topFailureReason(EasyVGenerationFacts.ForgeFacts forge) {
    return failureReasonLabels(forge).entrySet().stream()
        .max(Map.Entry.comparingByValue())
        .map(entry -> entry.getKey() + " (" + entry.getValue() + ")")
        .orElse("无已归类失败原因");
  }

  private static void validateRequest(EasyVGenerationRequest request) {
    if (request == null
        || !ExecutionRepository.isJavaContract(request.executionContract())
        || blank(request.executionId())
        || blank(request.sessionId())
        || blank(request.ontologyVersionId())
        || blank(request.userId())
        || !EasyVScopeResolver.ACCESS_MODE.equals(request.accessMode())
        || request.requestedAt() == null
        || request.from() == null
        || request.to() == null
        || request.from().isAfter(request.to())
        || (request.from().isAfter(EasyVDateRange.UNBOUNDED_FROM)
            && java.time.temporal.ChronoUnit.DAYS.between(request.from(), request.to()) > 366)) {
      throw new BackendException("EASYV_REQUEST_INVALID", "EasyV 生成质量分析请求无效。");
    }
    if (request.ontology() == null || !request.ontologyVersionId().equals(request.ontology().versionId())) {
      throw new BackendException("EASYV_ONTOLOGY_VERSION_MISMATCH", "EasyV 请求本体版本与 pinned catalog 不一致。");
    }
    EasyVGenerationOntology.validate(
        request.entityKey(), request.metricKey(), request.timeKey(), request.ontology());
  }

  private static boolean blank(String value) {
    return value == null || value.isBlank();
  }
}
