package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
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

  private final SemanticModel semantic = SemanticModel.discover();
  private final EasyVFollowUpPolicy policy =
      new EasyVFollowUpPolicy(semantic, new SemanticQueryCompiler(semantic));
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

  @Test
  void structuredPlanBuildsANewPlanFromEditedIntents() {
    Map<String, Object> plan =
        policy.structuredPlan(SOURCE_PLAN, List.of(Map.of("id", "q1", "intent", INTENT)));

    assertEquals(EasyVSemanticAgent.MODE, plan.get("mode"));
    assertEquals("按结构化调整执行", plan.get("summary"));
    assertEquals("java-follow-up-v1", plan.get("_executionContract"));
    assertEquals(SOURCE_PLAN.get("_resolvedContext"), plan.get("_resolvedContext"));
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> override = (List<Map<String, Object>>) plan.get("_queryOverride");
    assertEquals("q1", override.getFirst().get("id"));
    assertEquals("easyv-forge-task", ((Map<?, ?>) override.getFirst().get("intent")).get("object"));
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> steps = (List<Map<String, Object>>) plan.get("steps");
    assertEquals("query-q1", steps.getFirst().get("id"));
    assertEquals("semantic-query", steps.getFirst().get("kind"));
    assertEquals("应用生成任务 查询", steps.getFirst().get("title"));
  }

  @Test
  void structuredPlanCollectsAllViolationsBeforeFailing() {
    Map<String, Object> badIntent = Map.of("object", "easyv-forge-task",
        "measures", List.of("nope"),
        "time", Map.of("expression", Map.of("sourceText", "本周", "kind", "calendar", "unit", "week", "offset", 0)));

    BackendException error = assertThrows(BackendException.class, () -> policy.structuredPlan(SOURCE_PLAN,
        List.of(
            Map.of("intent", INTENT),
            Map.of("id", "q1", "intent", INTENT),
            Map.of("id", "q1", "intent", INTENT),
            Map.of("id", "q2", "intent", badIntent),
            Map.of("id", "q3", "intent", "不是对象"))));

    assertEquals("FOLLOW_UP_STRUCTURED_INVALID", error.code());
    String message = error.getMessage();
    assertTrue(message.contains("第 1 项缺少非空 id"));
    assertTrue(message.contains("查询 q1：id 重复"));
    assertTrue(message.contains("查询 q2：measures 中的指标不存在于对象 easyv-forge-task：nope"));
    assertTrue(message.contains("查询 q3："));
  }

  @Test
  void structuredPlanRejectsForeignObjectsAndAmbiguousExpressions() {
    String foreign = semantic.contributions().stream()
        .filter(item -> !EasyVGenerationOntology.DOMAIN_KEY.equals(item.domainKey()))
        .flatMap(item -> item.objects().stream()).map(object -> object.key()).findFirst()
        .orElse(null);
    if (foreign != null) {
      Map<String, Object> foreignIntent = Map.of("object", foreign, "measures", List.of("count"),
          "time", Map.of("expression", Map.of("sourceText", "全部", "kind", "all")));
      BackendException foreignError = assertThrows(BackendException.class, () ->
          policy.structuredPlan(SOURCE_PLAN, List.of(Map.of("id", "q1", "intent", foreignIntent))));
      assertEquals("FOLLOW_UP_STRUCTURED_INVALID", foreignError.code());
      assertTrue(foreignError.getMessage().contains("不属于 EasyV 领域"));
    }

    Map<String, Object> ambiguousIntent = Map.of("object", "easyv-forge-task",
        "measures", List.of("count"),
        "time", Map.of("expression", Map.of("sourceText", "前阵子", "kind", "ambiguous",
            "candidates", List.of(Map.of("sourceText", "最近 7 天", "kind", "relative", "unit", "day", "n", 7)))));
    BackendException ambiguousError = assertThrows(BackendException.class, () ->
        policy.structuredPlan(SOURCE_PLAN, List.of(Map.of("id", "q1", "intent", ambiguousIntent))));
    assertEquals("FOLLOW_UP_STRUCTURED_INVALID", ambiguousError.code());
    assertTrue(ambiguousError.getMessage().contains("ambiguous"));

    Map<String, Object> ambiguousCompare = Map.of("object", "easyv-forge-task",
        "measures", List.of("count"),
        "time", Map.of("expression", Map.of("sourceText", "最近 7 天", "kind", "relative", "unit", "day", "n", 7)),
        "compare", Map.of("sourceText", "之前", "kind", "ambiguous",
            "candidates", List.of(Map.of("sourceText", "上一个 7 天", "kind", "relative", "unit", "day", "n", 7))));
    BackendException compareError = assertThrows(BackendException.class, () ->
        policy.structuredPlan(SOURCE_PLAN, List.of(Map.of("id", "q1", "intent", ambiguousCompare))));
    assertEquals("FOLLOW_UP_STRUCTURED_INVALID", compareError.code());
    assertTrue(compareError.getMessage().contains("compare"));
  }

  @Test
  void structuredPlanRejectsEmptyOversizedAndLegacySources() {
    assertCode("FOLLOW_UP_STRUCTURED_INVALID", () -> policy.structuredPlan(SOURCE_PLAN, List.of()));
    assertCode("FOLLOW_UP_STRUCTURED_INVALID", () -> policy.structuredPlan(SOURCE_PLAN,
        List.of(Map.of("id", "q1", "intent", INTENT), Map.of("id", "q2", "intent", INTENT),
            Map.of("id", "q3", "intent", INTENT), Map.of("id", "q4", "intent", INTENT),
            Map.of("id", "q5", "intent", INTENT))));
    assertCode("FOLLOW_UP_LEGACY_EXECUTION",
        () -> policy.structuredPlan(Map.of("mode", "deterministic-read-only"), List.of()));
  }

  @Test
  void executableContextAttachesOverrideWhenCurrentPlanCarriesOne() {
    Map<String, Object> overridePlan = Map.of("_queryOverride",
        List.of(Map.of("id", "q1", "intent", INTENT)));

    Map<String, Object> context = policy.executableContext(SOURCE_PLAN, overridePlan, Map.of());

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> override = (List<Map<String, Object>>) context.get("override");
    assertEquals("q1", override.getFirst().get("id"));
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> queries = (List<Map<String, Object>>) context.get("queries");
    assertEquals("q1", queries.getFirst().get("id"));

    assertEquals(Map.of("queries", List.of(Map.of("id", "q1", "label", "生成任务 · 生成任务数", "intent", INTENT))),
        policy.executableContext(SOURCE_PLAN, Map.of(), Map.of()));
  }

  @SuppressWarnings("unchecked")
  private static Object value(Map<String, Object> context, String key) {
    return ((Map<String, Object>) context.get(key)).get("value");
  }

  private static void assertCode(String code, Supplier<?> action) {
    assertEquals(code, assertThrows(BackendException.class, action::get).code());
  }
}
