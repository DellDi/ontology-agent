package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EasyVFollowUpPolicyTest {
  private final EasyVFollowUpPolicy policy = new EasyVFollowUpPolicy();
  private final AuthSession owner =
      new AuthSession("auth-1", "123", "用户", new AccessScope("org", List.of(), List.of(), List.of()), Instant.MAX);

  @Test
  void inheritedContextUsesDisplayShapeAndCarriesDomainKeysInConstraints() {
    Map<String, Object> inherited = policy.inheritedContext(plan(domainContext()));

    assertField(inherited, "targetMetric", "目标指标", "生成质量分析");
    assertField(inherited, "entity", "实体对象", "AI 大屏应用");
    assertField(inherited, "timeRange", "时间范围", "2026-08-01/2026-08-18");
    assertField(inherited, "comparison", "比较方式", "无需比较");
    assertConstraint(inherited, "实体 business key", "easyv-ai-application");
    assertConstraint(inherited, "指标 business key", "easyv-generation-quality");
    assertConstraint(inherited, "时间语义 business key", "easyv-generation-time");
    assertConstraint(inherited, "访问模式", "all");
    assertConstraint(inherited, "执行账号 ID", "123");
  }

  @Test
  void createContextParsesDatesInheritsQuietQuestionsAndRejectsScopeOrDomainChanges() {
    Map<String, Object> inherited = policy.inheritedContext(plan(domainContext()));

    Map<String, Object> changed = policy.applyQuestionContext(
        "请看 2026-08-10 到 2026-08-18 的生成质量", inherited, owner);
    assertEquals("2026-08-10/2026-08-18", fieldValue(changed, "timeRange"));

    Map<String, Object> singleDay = policy.applyQuestionContext("只看 2026-08-18", inherited, owner);
    assertEquals("2026-08-18/2026-08-18", fieldValue(singleDay, "timeRange"));

    // 不含时间表达的追问继承上一轮时间窗口
    Map<String, Object> inheritedQuiet =
        policy.applyQuestionContext("失败原因主要分布在哪些阶段", inherited, owner);
    assertEquals(inherited, inheritedQuiet);

    assertEquals(
        "FOLLOW_UP_CAPABILITY_UNSUPPORTED",
        assertThrows(BackendException.class, () -> policy.applyQuestionContext("切换领域到物业", inherited, owner)).code());
    assertEquals(
        "FOLLOW_UP_SCOPE_INVALID",
        assertThrows(
                BackendException.class,
                () -> policy.applyQuestionContext("近7天", inherited, owner("124")))
            .code());
  }

  @Test
  void replanCopiesPlanAndExecutableContextStaysFrozen() {
    Map<String, Object> previous = plan(domainContext());
    Map<String, Object> inherited = policy.inheritedContext(previous);
    Map<String, Object> merged = policy.applyQuestionContext("2026-08-10 到 2026-08-18", inherited, owner);

    Map<String, Object> replanned = policy.replan(previous, inherited, merged, owner, "fu-1", "execution-1");

    assertEquals("java-follow-up-v1", replanned.get("_executionContract"));
    assertEquals("fu-1", replanned.get("_followUpId"));
    assertEquals("execution-1", replanned.get("_referencedExecutionId"));
    assertEquals(previous.get("steps"), replanned.get("steps"));

    Map<String, Object> resolved = resolvedContext(replanned);
    assertEquals("2026-08-10", resolved.get("from"));
    assertEquals("2026-08-18", resolved.get("to"));
    assertEquals("all", resolved.get("accessMode"));
    assertEquals("123", resolved.get("userId"));

    assertEquals(resolved, policy.executableContext(replanned, merged));
    // plan 冻结后 merged 的篡改不能覆盖执行上下文
    Map<String, Object> tampered = new LinkedHashMap<>(merged);
    tampered.put("timeRange", Map.of("label", "时间范围", "value", "2026-08-10/2026-08-19", "state", "confirmed"));
    assertEquals(resolved, policy.executableContext(replanned, tampered));
    // 计划缺失时回退到 merged 的域还原
    Map<String, Object> fallback = policy.executableContext(null, merged);
    assertEquals("2026-08-10", fallback.get("from"));
    assertEquals("easyv-generation-quality", fallback.get("metric"));
  }

  @Test
  void rejectsTamperedContextAndNonTimeRangeAdjustments() {
    Map<String, Object> inherited = policy.inheritedContext(plan(domainContext()));

    // 展示形态缺字段
    Map<String, Object> missing = new LinkedHashMap<>(inherited);
    missing.remove("comparison");
    assertEquals(
        "FOLLOW_UP_CONTEXT_INVALID",
        assertThrows(BackendException.class, () -> policy.executableContext(null, missing)).code());

    // 约束里的域键被篡改
    Map<String, Object> tamperedConstraints = new LinkedHashMap<>(inherited);
    tamperedConstraints.put("constraints", List.of(
        Map.of("label", "实体 business key", "value", "easyv-ai-application"),
        Map.of("label", "指标 business key", "value", "collection-rate"),
        Map.of("label", "时间语义 business key", "value", "easyv-generation-time"),
        Map.of("label", "访问模式", "value", "all"),
        Map.of("label", "执行账号 ID", "value", "123")));
    assertEquals(
        "FOLLOW_UP_CONTEXT_INVALID",
        assertThrows(BackendException.class, () -> policy.executableContext(null, tamperedConstraints)).code());

    // 只允许改 timeRange
    assertEquals(
        "FOLLOW_UP_REPLAN_UNSUPPORTED",
        assertThrows(
                BackendException.class,
                () -> policy.adjust(inherited, inherited, Map.of("targetMetric", "收缴率"), false))
            .code());
    assertEquals(
        "FOLLOW_UP_TIME_RANGE_INVALID",
        assertThrows(
                BackendException.class,
                () -> policy.adjust(inherited, inherited, Map.of("timeRange", "2026-08-18/2026-08-10"), false))
            .code());

    // 正常调整 timeRange
    var adjustment = policy.adjust(inherited, inherited, Map.of("timeRange", "2026-08-10/2026-08-12"), false);
    assertNotNull(adjustment);
    assertEquals("2026-08-10/2026-08-12", fieldValue(adjustment.mergedContext(), "timeRange"));

    // replan 拒绝冻结上下文不一致
    Map<String, Object> drifted = new LinkedHashMap<>(inherited);
    drifted.put("timeRange", Map.of("label", "时间范围", "value", "2026-07-01/2026-07-31", "state", "confirmed"));
    assertEquals(
        "FOLLOW_UP_CONTEXT_INVALID",
        assertThrows(
                BackendException.class,
                () -> policy.replan(plan(domainContext()), drifted, drifted, owner, "fu-1", "execution-1"))
            .code());
  }

  private static void assertField(Map<String, Object> context, String key, String label, String value) {
    Object raw = context.get(key);
    org.junit.jupiter.api.Assertions.assertInstanceOf(Map.class, raw);
    Map<?, ?> field = (Map<?, ?>) raw;
    assertEquals(label, field.get("label"));
    assertEquals(value, field.get("value"));
    assertEquals("confirmed", field.get("state"));
  }

  private static String fieldValue(Map<String, Object> context, String key) {
    Map<?, ?> field = (Map<?, ?>) context.get(key);
    assertNotNull(field, "缺少字段 " + key);
    return String.valueOf(field.get("value"));
  }

  private static void assertConstraint(Map<String, Object> context, String label, String value) {
    List<?> constraints = (List<?>) context.get("constraints");
    assertNotNull(constraints);
    boolean found = constraints.stream().anyMatch(item -> item instanceof Map<?, ?> entry
        && label.equals(entry.get("label")) && value.equals(entry.get("value")));
    org.junit.jupiter.api.Assertions.assertTrue(found, "缺少约束 " + label + "=" + value);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> resolvedContext(Map<String, Object> plan) {
    return (Map<String, Object>) plan.get("_resolvedContext");
  }

  private static Map<String, Object> domainContext() {
    return Map.of(
        "entity", "easyv-ai-application",
        "metric", "easyv-generation-quality",
        "time", "easyv-generation-time",
        "from", "2026-08-01",
        "to", "2026-08-18",
        "accessMode", "all",
        "userId", "123");
  }

  private static Map<String, Object> plan(Map<String, Object> context) {
    return Map.of(
        "_executionContract", "java-initial-v1",
        "_resolvedContext", context,
        "summary", "EasyV 生成质量分析",
        "mode", "deterministic-read-only",
        "steps", List.of(Map.of("id", "validate-scope-and-time", "order", 1)));
  }

  private static AuthSession owner(String userId) {
    return new AuthSession("auth-1", userId, "用户", new AccessScope("org", List.of(), List.of(), List.of()), Instant.MAX);
  }
}
