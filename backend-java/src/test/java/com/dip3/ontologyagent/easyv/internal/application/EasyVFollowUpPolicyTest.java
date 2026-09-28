package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

class EasyVFollowUpPolicyTest {
  private static final Map<String, Object> INTENT =
      Map.of("object", "easyv-forge-task", "measures", List.of("count"),
          "time", Map.of("expression", Map.of("sourceText", "最近 7 天", "kind", "relative", "unit", "day", "n", 7)));
  private static final Map<String, Object> SOURCE_PLAN = Map.of("_resolvedContext", Map.of(
      "userId", "7", "accessMode", "all", "dataScope", "全部数据",
      "queries", List.of(Map.of("id", "q1", "label", "生成任务 · 生成任务数", "intent", INTENT,
          "range", "最近 7 天", "compareRange", "上一个 7 天"))));

  private final EasyVFollowUpPolicy policy = new EasyVFollowUpPolicy(SemanticModel.discover());
  private final AuthSession principal = new AuthSession("auth-1", "7", "用户",
      new AccessScope("org-1", List.of(), List.of(), List.of()), Instant.MAX);

  @Test
  void questionValidationRejectsBlankAndOtherDomains() {
    policy.validateQuestion("按周拆分");
    assertCode("FOLLOW_UP_CONTEXT_INVALID", () -> {
      policy.validateQuestion(" ");
      return null;
    });
    assertCode("FOLLOW_UP_CAPABILITY_UNSUPPORTED", () -> {
      policy.validateQuestion("切换领域看物业收缴率");
      return null;
    });
  }

  @Test
  void inheritedContextIsDerivedFromExecutedQueries() {
    Map<String, Object> context = policy.inheritedContext(SOURCE_PLAN);

    assertEquals("生成任务 · 生成任务数", value(context, "targetMetric"));
    assertEquals("最近 7 天", value(context, "timeRange"));
    assertEquals("对比 上一个 7 天", value(context, "comparison"));
    assertEquals(List.of(Map.of("label", "数据范围", "value", "全部数据")), context.get("constraints"));
    assertSame(context, policy.applyQuestionContext("按周", context, principal));
  }

  @Test
  void executableContextCarriesPreviousIntents() {
    assertEquals(Map.of("queries", List.of(Map.of("id", "q1", "label", "生成任务 · 生成任务数", "intent", INTENT))),
        policy.executableContext(SOURCE_PLAN, Map.of(), Map.of()));
  }

  @Test
  void legacyOrInvalidSourcePlansAndManualReplanAreRejected() {
    assertCode("FOLLOW_UP_LEGACY_EXECUTION", () -> policy.inheritedContext(Map.of("mode", "deterministic-read-only")));
    assertCode("FOLLOW_UP_CONTEXT_INVALID", () -> policy.inheritedContext(
        Map.of("_resolvedContext", Map.of("dataScope", "全部数据", "queries", List.of()))));
    assertCode("FOLLOW_UP_CONTEXT_INVALID", () -> policy.executableContext(
        Map.of("_resolvedContext", Map.of("dataScope", "全部数据", "queries", List.of(Map.of("id", "q1",
            "label", "x", "range", "全部", "intent", Map.of("object", ""))))), Map.of(), Map.of()));
    assertCode("FOLLOW_UP_REPLAN_UNSUPPORTED", () -> policy.adjust(Map.of(), Map.of(), Map.of(), false));
    assertCode("FOLLOW_UP_REPLAN_UNSUPPORTED",
        () -> policy.replan(SOURCE_PLAN, Map.of(), Map.of(), principal, "follow-up-1", "execution-1"));
  }

  @SuppressWarnings("unchecked")
  private static Object value(Map<String, Object> context, String key) {
    return ((Map<String, Object>) context.get(key)).get("value");
  }

  private static void assertCode(String code, Supplier<?> action) {
    assertEquals(code, assertThrows(BackendException.class, action::get).code());
  }
}
