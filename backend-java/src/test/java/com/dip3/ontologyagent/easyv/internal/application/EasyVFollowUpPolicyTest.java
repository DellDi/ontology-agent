package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EasyVFollowUpPolicyTest {
  private final EasyVFollowUpPolicy policy = new EasyVFollowUpPolicy();
  private final AuthSession owner =
      new AuthSession("auth-1", "123", "用户", new AccessScope("org", List.of(), List.of(), List.of()), Instant.MAX);

  @Test
  void createContextParsesOnlyDeterministicDatesAndRejectsScopeOrMetricChanges() {
    Map<String, Object> changed = policy.applyQuestionContext(
        "请看 2026-08-10 到 2026-08-18 的生成质量", context(), owner);
    assertEquals("2026-08-10", changed.get("from"));
    assertEquals("2026-08-18", changed.get("to"));
    Map<String, Object> singleDay = policy.applyQuestionContext("只看 2026-08-18", context(), owner);
    assertEquals("2026-08-18", singleDay.get("from"));
    assertEquals("2026-08-18", singleDay.get("to"));
    assertEquals(
        "FOLLOW_UP_CAPABILITY_UNSUPPORTED",
        assertThrows(BackendException.class, () -> policy.applyQuestionContext("切换领域到物业", context(), owner)).code());
  }

  @Test
  void replanCopiesPlanAndSubmitUsesTheFrozenUpdatedContext() {
    Map<String, Object> previous = plan(context());
    Map<String, Object> updated = new java.util.LinkedHashMap<>(context());
    updated.put("from", "2026-08-10");
    updated.put("to", "2026-08-18");
    Map<String, Object> replanned = policy.replan(previous, context(), updated, owner, "fu-1", "execution-1");

    assertEquals("java-follow-up-v1", replanned.get("_executionContract"));
    assertEquals("fu-1", replanned.get("_followUpId"));
    assertEquals("execution-1", replanned.get("_referencedExecutionId"));
    assertEquals(previous.get("steps"), replanned.get("steps"));
    assertEquals(updated, replanned.get("_resolvedContext"));
    assertEquals(updated, policy.executableContext(replanned, updated));
    Map<String, Object> tamperedMerged = new java.util.LinkedHashMap<>(updated);
    tamperedMerged.put("to", "2026-08-19");
    assertEquals(updated, policy.executableContext(replanned, tamperedMerged));
    assertEquals(updated, policy.executableContext(null, updated));
  }

  @Test
  void rejectsExtraContextKeysAndTamperedOwnerOrDomain() {
    Map<String, Object> extra = new java.util.LinkedHashMap<>(context());
    extra.put("teamId", "team-1");
    assertEquals("FOLLOW_UP_CONTEXT_INVALID", assertThrows(BackendException.class, () -> policy.executableContext(null, extra)).code());
    assertEquals(
        "FOLLOW_UP_SCOPE_INVALID",
        assertThrows(
                BackendException.class,
                () -> policy.applyQuestionContext("2026-08-10 2026-08-18", context(), owner("124")))
            .code());
    Map<String, Object> tampered = new java.util.LinkedHashMap<>(context());
    tampered.put("metric", "collection-rate");
    assertEquals("FOLLOW_UP_CONTEXT_INVALID", assertThrows(BackendException.class, () -> policy.executableContext(null, tampered)).code());
    assertEquals(
        "FOLLOW_UP_REPLAN_UNSUPPORTED",
        assertThrows(
                BackendException.class,
                () -> policy.adjust(context(), context(), Map.of("metric", "collection-rate"), false))
            .code());
  }

  private static Map<String, Object> context() {
    return Map.of(
        "entity", "easyv-ai-application",
        "metric", "easyv-generation-quality",
        "time", "easyv-generation-time",
        "from", "2026-08-01",
        "to", "2026-08-18",
        "accessMode", "creator-owned",
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
