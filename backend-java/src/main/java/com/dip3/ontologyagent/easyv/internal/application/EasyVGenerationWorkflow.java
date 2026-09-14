package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/** Deterministic EasyV quality analysis over a typed, read-only fact port. */
@Service
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVGenerationWorkflow {
  private static final Duration MAX_FRESHNESS_AGE = Duration.ofHours(24);
  private static final Duration MAX_FUTURE_SKEW = Duration.ofMinutes(5);
  private static final List<String> CLAIM_KINDS =
      List.of(
          "generation-quality",
          "stage-bottleneck",
          "failure-concentration",
          "feedback-association",
          "business-success-settlement-distinct");
  private final EasyVGenerationFacts facts;

  public EasyVGenerationWorkflow(EasyVGenerationFacts facts) {
    this.facts = facts;
  }

  public WorkflowResult execute(EasyVGenerationRequest request) {
    validateRequest(request);
    EasyVGenerationFacts.Snapshot snapshot =
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
    EasyVGenerationResult result = buildResult(request, snapshot);
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
                        || !entry.getKey().matches("[a-z0-9][a-z0-9._:-]{0,127}")
                        || entry.getValue() == null
                        || entry.getValue() < 0)
        || forge.failedTaskCount() > 0
            && (forge.failureReasonCounts().isEmpty() || failureReasonTotal != forge.failedTaskCount())) {
      throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV 失败原因聚合包含无效字段。");
    }
  }

  private EasyVGenerationResult buildResult(
      EasyVGenerationRequest request, EasyVGenerationFacts.Snapshot snapshot) {
    List<Evidence> evidence = evidence(request, snapshot);
    List<GroundedConclusion.Claim> claims = claims(snapshot, evidence);
    Map<String, Object> resolvedContext =
        Map.of(
            "entity", request.entityKey(),
            "metric", request.metricKey(),
            "time", request.timeKey(),
            "from", request.from().toString(),
            "to", request.to().toString(),
            "accessMode", request.accessMode(),
            "userId", request.userId());
    List<Map<String, Object>> steps =
        List.of(
            Map.of("id", "validate-scope-and-time", "order", 1, "kind", "deterministic-validation",
                "title", "校验范围与时间"),
            Map.of("id", "read-easyv-ai-application", "order", 2, "kind", "aggregate-facts",
                "title", "读取 AI 应用事实"),
            Map.of("id", "read-easyv-pipeline-node", "order", 3, "kind", "aggregate-facts",
                "title", "读取流水线节点事实"),
            Map.of("id", "read-easyv-forge-task", "order", 4, "kind", "aggregate-facts",
                "title", "读取 Forge 任务事实"),
            Map.of("id", "read-easyv-generation-feedback", "order", 5, "kind", "aggregate-facts",
                "title", "读取生成反馈事实"),
            Map.of("id", "validate-evidence", "order", 6, "kind", "deterministic-validation",
                "title", "校验证据完整性"),
            Map.of("id", "render-grounded-claims", "order", 7, "kind", "deterministic-render",
                "title", "渲染证据结论"));
    Map<String, Object> plan = new LinkedHashMap<>();
    plan.put("_executionContract", request.executionContract());
    plan.put("_resolvedContext", resolvedContext);
    plan.put("_evidenceTypes", evidence.stream().map(Evidence::source).toList());
    plan.put("summary", "EasyV 生成质量分析");
    plan.put("mode", "deterministic-read-only");
    plan.put("steps", steps);
    if (request.followUpId() != null) plan.put("_followUpId", request.followUpId());
    if (request.referencedExecutionId() != null) {
      plan.put("_referencedExecutionId", request.referencedExecutionId());
    }
    plan = Map.copyOf(plan);
    String lead = leadSummary(request, snapshot);
    List<Map<String, Object>> blocks = renderBlocks(request, snapshot, claims, lead);
    return new EasyVGenerationResult(plan, evidence, claims, blocks, lead);
  }

  private static List<Map<String, Object>> renderBlocks(
      EasyVGenerationRequest request,
      EasyVGenerationFacts.Snapshot snapshot,
      List<GroundedConclusion.Claim> claims,
      String lead) {
    EasyVGenerationFacts.ApplicationFacts application = snapshot.application();
    EasyVGenerationFacts.PipelineFacts pipeline = snapshot.pipeline();
    EasyVGenerationFacts.ForgeFacts forge = snapshot.forge();
    EasyVGenerationFacts.FeedbackFacts feedback = snapshot.feedback();
    List<Map<String, Object>> blocks = new ArrayList<>();
    blocks.add(Map.<String, Object>of(
        "type", "markdown",
        "title", "综合结论",
        "content", lead));
    blocks.add(Map.<String, Object>of(
        "type", "kv-list",
        "title", "关键指标",
        "items", List.of(
            kv("AI 应用", application.applicationCount()),
            kv("原型", application.prototypeCount()),
            kv("Forge 完成率",
                ratio(forge.completedTaskCount(),
                    forge.completedTaskCount() + forge.failedTaskCount())),
            kv("流水线任务", pipeline.taskCount() + "（完成 " + pipeline.completedTaskCount()
                + " / 失败 " + pipeline.failedTaskCount() + "）"),
            kv("瓶颈阶段 P95", safe(pipeline.bottleneckStep()) + " · "
                + pipeline.bottleneckP95Millis() + " ms"),
            kv("有效评分覆盖", feedback.ratedCount() + "/" + feedback.operationCount()))));
    blocks.add(Map.<String, Object>of(
        "type", "chart",
        "title", "各阶段 P95 耗时",
        "chartType", "bar",
        "series", List.of(Map.of(
            "name", "P95 耗时",
            "points", pipeline.stageDurations().stream()
                .limit(10)
                .map(stage -> Map.<String, Object>of(
                    "label", stage.stepName(), "value", stage.p95Millis()))
                .toList())),
        "unit", "ms"));
    blocks.add(Map.<String, Object>of(
        "type", "chart",
        "title", "原型流水线任务状态",
        "chartType", "bar",
        "series", List.of(Map.of(
            "name", "任务数",
            "points", List.of(
                Map.of("label", "完成", "value", pipeline.completedTaskCount()),
                Map.of("label", "失败", "value", pipeline.failedTaskCount()),
                Map.of("label", "未完成", "value", pipeline.incompleteTaskCount())))),
        "unit", "个"));
    blocks.add(Map.<String, Object>of(
        "type", "chart",
        "title", "Forge 任务状态分布",
        "chartType", "pie",
        "series", List.of(Map.of(
            "name", "任务数",
            "points", List.of(
                Map.of("label", "完成", "value", forge.completedTaskCount()),
                Map.of("label", "失败", "value", forge.failedTaskCount()),
                Map.of("label", "取消", "value", forge.cancelledTaskCount())))),
        "unit", "个"));
    blocks.add(Map.<String, Object>of(
        "type", "chart",
        "title", "execute_result 组合结果分布",
        "chartType", "pie",
        "series", List.of(Map.of(
            "name", "记录数",
            "points", List.of(
                Map.of("label", "组合成功", "value", feedback.combinedExecuteSuccessCount()),
                Map.of("label", "组合失败", "value", feedback.combinedExecuteFailureCount())))),
        "unit", "条"));
    blocks.add(failureReasonTable(forge));
    claims.stream()
        .map(claim -> Map.<String, Object>of(
            "type", "markdown", "title", claimTitle(claim.kind()), "content", claim.text()))
        .forEach(blocks::add);
    return List.copyOf(blocks);
  }

  private static Map<String, Object> failureReasonTable(EasyVGenerationFacts.ForgeFacts forge) {
    List<Map.Entry<String, Long>> sorted = forge.failureReasonCounts().entrySet().stream()
        .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
        .toList();
    List<List<String>> rows = sorted.isEmpty()
        ? List.of(List.of("无已归类失败原因", "0"))
        : sorted.stream()
            .map(entry -> List.of(entry.getKey(), String.valueOf(entry.getValue())))
            .toList();
    return Map.of(
        "type", "table",
        "title", "失败原因分布",
        "columns", List.of("失败原因", "任务数"),
        "rows", rows);
  }

  private static Map<String, Object> kv(String label, Object value) {
    return Map.of("label", label, "value", String.valueOf(value));
  }

  private static String leadSummary(
      EasyVGenerationRequest request, EasyVGenerationFacts.Snapshot snapshot) {
    EasyVGenerationFacts.ApplicationFacts application = snapshot.application();
    EasyVGenerationFacts.PipelineFacts pipeline = snapshot.pipeline();
    EasyVGenerationFacts.ForgeFacts forge = snapshot.forge();
    EasyVGenerationFacts.FeedbackFacts feedback = snapshot.feedback();
    return "本期（" + request.from() + " 至 " + request.to() + "，上海时区）共覆盖 "
        + application.applicationCount() + " 个 AI 应用、" + application.prototypeCount() + " 个原型；"
        + "Forge 生成完成率 " + ratio(forge.completedTaskCount(),
            forge.completedTaskCount() + forge.failedTaskCount())
        + "，原型流水线完成 " + pipeline.completedTaskCount() + "/" + pipeline.taskCount()
        + "，瓶颈阶段 " + safe(pipeline.bottleneckStep()) + "（P95 " + pipeline.bottleneckP95Millis()
        + " ms）；有效评分覆盖 " + feedback.ratedCount() + "/" + feedback.operationCount()
        + "，组合成功 " + feedback.combinedExecuteSuccessCount() + "、组合失败 "
        + feedback.combinedExecuteFailureCount() + "。";
  }

  private static List<Evidence> evidence(
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
                    Map.entry("failureReasonCounts", forge.failureReasonCounts()),
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

  private static List<GroundedConclusion.Claim> claims(
      EasyVGenerationFacts.Snapshot snapshot, List<Evidence> evidence) {
    EasyVGenerationFacts.ApplicationFacts application = snapshot.application();
    EasyVGenerationFacts.ForgeFacts forge = snapshot.forge();
    EasyVGenerationFacts.PipelineFacts pipeline = snapshot.pipeline();
    EasyVGenerationFacts.FeedbackFacts feedback = snapshot.feedback();
    String topFailure = topFailureReason(forge);
    return List.of(
        claim(
            "generation-quality",
            "覆盖 " + application.applicationCount() + " 个 AI 应用、" + application.prototypeCount()
                + " 个原型；Forge 生成完成率为 "
                + ratio(forge.completedTaskCount(), forge.completedTaskCount() + forge.failedTaskCount())
                + "；耗时覆盖 " + forge.timedTerminalTaskCount() + "/" + forge.terminalTaskCount()
                + " 个终态任务，取消任务单列。",
            ref(evidence.get(0), "applicationCount", application.applicationCount()),
            ref(evidence.get(0), "prototypeCount", application.prototypeCount()),
            ref(evidence.get(2), "completedTaskCount", forge.completedTaskCount()),
            ref(evidence.get(2), "failedTaskCount", forge.failedTaskCount())),
        claim(
            "stage-bottleneck",
            "原型阶段耗时瓶颈为 " + safe(pipeline.bottleneckStep()) + "，P95 为 " + pipeline.bottleneckP95Millis()
                + " 毫秒；耗时覆盖 " + pipeline.timedNodeCount() + "/" + pipeline.mainNodeCount() + " 个 MAIN 节点。",
            ref(evidence.get(1), "bottleneckStep", pipeline.bottleneckStep()),
            ref(evidence.get(1), "bottleneckP95Millis", pipeline.bottleneckP95Millis())),
        claim(
            "failure-concentration",
            "Forge 失败原因最多的是 " + topFailure + "；该结论描述失败集中分布，不表述为模型因果。",
            ref(evidence.get(2), "topFailureReason", topFailureReason(forge)),
            ref(evidence.get(2), "failedTaskCount", forge.failedTaskCount())),
        feedbackClaim(feedback, evidence.get(3)),
        claim(
            "business-success-settlement-distinct",
            "execute_result 组合成功记录 " + feedback.combinedExecuteSuccessCount() + "、组合失败记录 "
                + feedback.combinedExecuteFailureCount()
                + "；当前事实不能拆分模型/业务成功与积分结算失败，也不能据此推断二者任一原因。",
            ref(evidence.get(3), "combinedExecuteSuccessCount", feedback.combinedExecuteSuccessCount()),
            ref(evidence.get(3), "combinedExecuteFailureCount", feedback.combinedExecuteFailureCount())));
  }

  private static GroundedConclusion.Claim feedbackClaim(
      EasyVGenerationFacts.FeedbackFacts feedback, Evidence evidence) {
    if (feedback.ratedCount() > 0) {
      return claim(
          "feedback-association",
          "有效评分覆盖 " + feedback.ratedCount() + "/" + feedback.operationCount() + "，平均评分 "
              + feedback.averageRating() + "；另存行为仅作观察性相关。",
          ref(evidence, "ratedCount", feedback.ratedCount()),
          ref(evidence, "averageRating", feedback.averageRating()),
          ref(evidence, "saveAsEditCount", feedback.saveAsEditCount()));
    }
    return claim(
        "feedback-association",
        "有效评分覆盖 0/" + feedback.operationCount()
            + "：本期没有用户评分记录，不能给出平均评分；另存行为仅作观察性相关。",
        ref(evidence, "ratedCount", feedback.ratedCount()),
        ref(evidence, "saveAsEditCount", feedback.saveAsEditCount()));
  }

  private static GroundedConclusion.Claim claim(
      String kind, String text, GroundedConclusion.EvidenceReference... refs) {
    return new GroundedConclusion.Claim(kind, text, List.of(refs));
  }

  private static GroundedConclusion.EvidenceReference ref(Evidence evidence, String field, Object value) {
    return new GroundedConclusion.EvidenceReference(evidence.source(), 0, field, value);
  }

  private static String claimTitle(String kind) {
    return switch (kind) {
      case "generation-quality" -> "生成质量";
      case "stage-bottleneck" -> "阶段瓶颈";
      case "failure-concentration" -> "失败集中";
      case "feedback-association" -> "反馈关联";
      case "business-success-settlement-distinct" -> "业务成功与结算区分";
      default -> "结论";
    };
  }

  private static String topFailureReason(EasyVGenerationFacts.ForgeFacts forge) {
    return forge.failureReasonCounts().entrySet().stream()
        .max(Map.Entry.comparingByValue())
        .map(entry -> entry.getKey() + " (" + entry.getValue() + ")")
        .orElse("无已归类失败原因");
  }

  private static String ratio(long numerator, long denominator) {
    return denominator == 0 ? "不可计算（分母为 0）" : String.format(java.util.Locale.ROOT, "%.2f%%", numerator * 100.0 / denominator);
  }

  private static String safe(String value) {
    return value == null || value.isBlank() ? "未提供" : value;
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
        || java.time.temporal.ChronoUnit.DAYS.between(request.from(), request.to()) > 366) {
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
