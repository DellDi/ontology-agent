package com.dip3.ontologyagent.property.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PropertyFollowUpPolicyTest {
  private final PropertyProjectScopeResolver scopedProjects = mock(PropertyProjectScopeResolver.class);
  private final AuthSession owner =
      new AuthSession(
          "auth-1",
          "user-1",
          "用户",
          new AccessScope(
              "org-1", List.of("project-1", "project-2"), List.of(), List.of("analyst")),
          Instant.MAX);
  private final PropertyFollowUpPolicy policy = new PropertyFollowUpPolicy(scopedProjects);

  @BeforeEach
  void setUp() {
    when(scopedProjects.resolve(owner)).thenReturn(owner.scope().projectIds());
    when(scopedProjects.targets(owner))
        .thenReturn(
            List.of(
                new PropertyProjectScopeResolver.ProjectTarget("project-1", "项目一"),
                new PropertyProjectScopeResolver.ProjectTarget("project-2", "项目二")));
  }

  @Test
  void inheritedContextUsesOnlyResolvedPlanFacts() {
    Map<String, Object> inherited = policy.inheritedContext(plan());

    assertEquals("collection-rate", fieldValue(inherited, "targetMetric"));
    assertEquals("project-1", fieldValue(inherited, "entity"));
    assertEquals("2026-01-01/2026-01-31", fieldValue(inherited, "timeRange"));
    assertEquals("property-project", constraint(inherited, "实体 business key"));
  }

  @Test
  void questionContextKeepsCapabilityFixedWhileApplyingAuthorizedScopeAndTime() {
    Map<String, Object> inherited = policy.inheritedContext(plan());

    Map<String, Object> scoped = policy.applyQuestionContext("项目二呢", inherited, owner);
    assertEquals("project-2", fieldValue(scoped, "entity"));
    assertEquals(List.of("project-2"), projectIds(scoped));

    Map<String, Object> month = policy.applyQuestionContext("改看2026年2月", inherited, owner);
    assertEquals("2026-02-01/2026-02-28", fieldValue(month, "timeRange"));

    BackendException error =
        assertThrows(
            BackendException.class,
            () -> policy.applyQuestionContext("所有项目和项目一呢", inherited, owner));
    assertEquals("FOLLOW_UP_SCOPE_INVALID", error.code());
  }

  @Test
  void replanPreservesFollowUpContractAndUpdatesOnlyConfirmedTimeRange() {
    Map<String, Object> inherited = policy.inheritedContext(plan());
    Map<String, Object> merged = new java.util.LinkedHashMap<>(inherited);
    merged.put(
        "timeRange",
        Map.of("label", "时间范围", "value", "2026-02-01/2026-02-28", "state", "confirmed"));

    Map<String, Object> result =
        policy.replan(plan(), inherited, merged, owner, "follow-1", "execution-root");

    assertEquals(ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, result.get("_executionContract"));
    assertEquals("follow-1", result.get("_followUpId"));
    assertEquals("execution-root", result.get("_referencedExecutionId"));
    Map<?, ?> resolved = (Map<?, ?>) result.get("_resolvedContext");
    assertEquals("2026-02-01", resolved.get("from"));
    assertEquals("2026-02-28", resolved.get("to"));
  }

  private static Map<String, Object> plan() {
    return Map.of(
        "_resolvedContext",
        Map.of(
            "entityKey",
            "property-project",
            "metricDefinitionKey",
            "collection-rate-definition",
            "metricVariantKey",
            "collection-rate",
            "timeSemanticKey",
            "receivable-period",
            "projectIds",
            List.of("project-1"),
            "from",
            "2026-01-01",
            "to",
            "2026-01-31"),
        "steps",
        List.of(Map.of("id", "step-1", "order", 1, "dependencyIds", List.of())));
  }

  private static Object fieldValue(Map<String, Object> context, String key) {
    return ((Map<?, ?>) context.get(key)).get("value");
  }

  private static Object constraint(Map<String, Object> context, String label) {
    return ((List<?>) context.get("constraints"))
        .stream()
        .map(Map.class::cast)
        .filter(item -> label.equals(item.get("label")))
        .map(item -> item.get("value"))
        .findFirst()
        .orElseThrow();
  }

  private static List<String> projectIds(Map<String, Object> context) {
    return ((List<?>) context.get("constraints"))
        .stream()
        .map(Map.class::cast)
        .filter(item -> "项目 ID".equals(item.get("label")))
        .map(item -> item.get("value").toString())
        .toList();
  }
}
