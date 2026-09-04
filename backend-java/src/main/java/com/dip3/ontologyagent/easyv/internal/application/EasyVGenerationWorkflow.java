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
        || !Double.isFinite(feedback.averageRating())
        || feedback.averageRating() < 0
        || feedback.averageRating() > 5) {
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
    List<Evidence> evidence = evidence(snapshot);
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
            Map.of("id", "validate-scope-and-time", "order", 1, "kind", "deterministic-validation"),
            Map.of("id", "read-easyv-ai-application", "order", 2, "kind", "aggregate-facts"),
            Map.of("id", "read-easyv-pipeline-node", "order", 3, "kind", "aggregate-facts"),
            Map.of("id", "read-easyv-forge-task", "order", 4, "kind", "aggregate-facts"),
            Map.of("id", "read-easyv-generation-feedback", "order", 5, "kind", "aggregate-facts"),
            Map.of("id", "validate-evidence", "order", 6, "kind", "deterministic-validation"),
            Map.of("id", "render-grounded-claims", "order", 7, "kind", "deterministic-render"));
    Map<String, Object> plan =
        Map.of(
            "_executionContract", request.executionContract(),
            "_resolvedContext", resolvedContext,
            "_evidenceTypes", evidence.stream().map(Evidence::source).toList(),
            "summary", "EasyV 生成质量分析",
            "mode", "deterministic-read-only",
            "steps", steps);
    List<Map<String, Object>> blocks =
        claims.stream()
            .map(claim -> Map.<String, Object>of("type", "claim", "kind", claim.kind(), "text", claim.text()))
            .toList();
    return new EasyVGenerationResult(plan, evidence, claims, blocks);
  }

  private static List<Evidence> evidence(EasyVGenerationFacts.Snapshot snapshot) {
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
                "freshnessAt", application.window().freshnessAt().toString()))),
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
                    "freshnessAt", pipeline.window().freshnessAt().toString()))),
        new Evidence(
            "easyv-forge-task",
            "EasyV Forge 任务聚合",
            List.of(
                Map.of(
                    "taskCount", forge.taskCount(),
                    "completedTaskCount", forge.completedTaskCount(),
                    "failedTaskCount", forge.failedTaskCount(),
                    "cancelledTaskCount", forge.cancelledTaskCount(),
                    "terminalTaskCount", forge.terminalTaskCount(),
                    "timedTerminalTaskCount", forge.timedTerminalTaskCount(),
                    "p50DurationMillis", forge.p50DurationMillis(),
                    "p95DurationMillis", forge.p95DurationMillis(),
                    "failureReasonCounts", forge.failureReasonCounts(),
                    "freshnessAt", forge.window().freshnessAt().toString()))),
        new Evidence(
            "easyv-generation-feedback",
            "EasyV 生成反馈聚合",
            List.of(
                Map.of(
                    "operationCount", feedback.operationCount(),
                    "ratedCount", feedback.ratedCount(),
                    "averageRating", feedback.averageRating(),
                    "saveAsEditCount", feedback.saveAsEditCount(),
                    "combinedExecuteSuccessCount", feedback.combinedExecuteSuccessCount(),
                    "combinedExecuteFailureCount", feedback.combinedExecuteFailureCount(),
                    "freshnessAt", feedback.window().freshnessAt().toString()))));
  }

  private static List<GroundedConclusion.Claim> claims(
      EasyVGenerationFacts.Snapshot snapshot, List<Evidence> evidence) {
    EasyVGenerationFacts.ForgeFacts forge = snapshot.forge();
    EasyVGenerationFacts.PipelineFacts pipeline = snapshot.pipeline();
    EasyVGenerationFacts.FeedbackFacts feedback = snapshot.feedback();
    String topFailure =
        forge.failureReasonCounts().entrySet().stream()
            .max(Map.Entry.comparingByValue())
            .map(entry -> entry.getKey() + " (" + entry.getValue() + ")")
            .orElse("无已归类失败原因");
    return List.of(
        claim(
            "generation-quality",
            "Forge 生成完成率为 " + ratio(forge.completedTaskCount(), forge.completedTaskCount() + forge.failedTaskCount())
                + "；耗时覆盖 " + forge.timedTerminalTaskCount() + "/" + forge.terminalTaskCount()
                + " 个终态任务，取消任务单列。",
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
            ref(evidence.get(2), "failureReasonCounts", forge.failureReasonCounts()),
            ref(evidence.get(2), "failedTaskCount", forge.failedTaskCount())),
        claim(
            "feedback-association",
            "有效评分覆盖 " + feedback.ratedCount() + "/" + feedback.operationCount() + "，平均评分 " + feedback.averageRating() + "；另存行为仅作观察性相关。",
            ref(evidence.get(3), "ratedCount", feedback.ratedCount()),
            ref(evidence.get(3), "averageRating", feedback.averageRating()),
            ref(evidence.get(3), "saveAsEditCount", feedback.saveAsEditCount())),
        claim(
            "business-success-settlement-distinct",
            "execute_result 组合成功记录 " + feedback.combinedExecuteSuccessCount() + "、组合失败记录 "
                + feedback.combinedExecuteFailureCount()
                + "；当前事实不能拆分模型/业务成功与积分结算失败，也不能据此推断二者任一原因。",
            ref(evidence.get(3), "combinedExecuteSuccessCount", feedback.combinedExecuteSuccessCount()),
            ref(evidence.get(3), "combinedExecuteFailureCount", feedback.combinedExecuteFailureCount())));
  }

  private static GroundedConclusion.Claim claim(
      String kind, String text, GroundedConclusion.EvidenceReference... refs) {
    return new GroundedConclusion.Claim(kind, text, List.of(refs));
  }

  private static GroundedConclusion.EvidenceReference ref(Evidence evidence, String field, Object value) {
    return new GroundedConclusion.EvidenceReference(evidence.source(), 0, field, value);
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
