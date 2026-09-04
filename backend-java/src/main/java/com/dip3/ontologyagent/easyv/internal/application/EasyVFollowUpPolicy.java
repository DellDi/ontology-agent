package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.FollowUpPolicy;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVDateRange;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** V1 follow-up policy: only a new, validated date range may change. */
final class EasyVFollowUpPolicy implements FollowUpPolicy {
  private static final Set<String> CONTEXT_KEYS =
      Set.of("entity", "metric", "time", "from", "to", "accessMode", "userId");

  @Override
  public void validateQuestion(String question) {
    if (question == null || question.isBlank()) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问不能为空。");
    }
    if (question.contains("切换领域") || question.contains("物业") || question.contains("扩大范围")) {
      throw new BackendException("FOLLOW_UP_CAPABILITY_UNSUPPORTED", "EasyV 追问不能切换领域或扩大授权范围。");
    }
  }

  @Override
  public Map<String, Object> inheritedContext(Map<String, Object> sourcePlan) {
    Object raw = sourcePlan == null ? null : sourcePlan.get("_resolvedContext");
    if (!(raw instanceof Map<?, ?> context)) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 来源执行缺少冻结上下文。");
    }
    return validateContext(copyContext(context));
  }

  @Override
  public Map<String, Object> applyQuestionContext(
      String question, Map<String, Object> inheritedContext, AuthSession principal) {
    validateQuestion(question);
    Map<String, Object> inherited = validateContext(inheritedContext);
    validateOwner(inherited, principal);
    EasyVDateRange range = resolveFollowUpRange(question, inherited);
    Map<String, Object> next = new LinkedHashMap<>(inherited);
    next.put("from", range.from().toString());
    next.put("to", range.to().toString());
    return validateContext(next);
  }

  @Override
  public FollowUpAdjustment adjust(
      Map<String, Object> inheritedContext,
      Map<String, Object> mergedContext,
      Map<String, String> draft,
      boolean confirmConflicts) {
    Map<String, Object> current = validateContext(inheritedContext);
    Map<String, Object> next = new LinkedHashMap<>(current);
    if (mergedContext != null) {
      for (Map.Entry<String, Object> entry : mergedContext.entrySet()) {
        if (!"from".equals(entry.getKey()) && !"to".equals(entry.getKey())
            && !java.util.Objects.equals(current.get(entry.getKey()), entry.getValue())) {
          throw new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED", "EasyV 追问只允许修改时间范围。");
        }
        if ("from".equals(entry.getKey()) || "to".equals(entry.getKey())) next.put(entry.getKey(), entry.getValue());
      }
    }
    if (draft != null && draft.values().stream().anyMatch(value -> value != null && !value.isBlank())) {
      if (draft.entrySet().stream()
          .anyMatch(entry -> !"from".equals(entry.getKey()) && !"to".equals(entry.getKey())
              && entry.getValue() != null && !entry.getValue().isBlank())) {
        throw new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED", "EasyV 追问只允许修改时间范围。");
      }
      String from = draft.get("from");
      String to = draft.get("to");
      if (from != null) next.put("from", from);
      if (to != null) next.put("to", to);
    }
    validateDate(next);
    return new FollowUpAdjustment(validateContext(next), Map.of("from", next.get("from"), "to", next.get("to")));
  }

  @Override
  public Map<String, Object> replan(
      Map<String, Object> previousPlan,
      Map<String, Object> inheritedContext,
      Map<String, Object> mergedContext,
      AuthSession principal,
      String followUpId,
      String referencedExecutionId) {
    if (previousPlan == null || !(previousPlan.get("steps") instanceof List<?> steps) || steps.isEmpty()) {
      throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "上一轮计划步骤无效，无法重规划。");
    }
    if (!(previousPlan.get("_executionContract") instanceof String contract)
        || !ExecutionRepository.isJavaContract(contract)) {
      throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "上一轮计划执行契约无效，无法重规划。");
    }
    String summary = requiredText(previousPlan.get("summary"), "FOLLOW_UP_REPLAN_INVALID", "上一轮计划摘要缺失。");
    String mode = requiredText(previousPlan.get("mode"), "FOLLOW_UP_REPLAN_INVALID", "上一轮计划模式缺失。");
    Map<String, Object> previousResolved = inheritedContext(previousPlan);
    Map<String, Object> inherited = validateContext(inheritedContext);
    if (!previousResolved.equals(inherited)) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问继承上下文与上一轮冻结上下文不一致。");
    }
    validateOwner(inherited, principal);
    Map<String, Object> resolved = new LinkedHashMap<>(inherited);
    if (mergedContext != null) {
      for (Map.Entry<String, Object> entry : mergedContext.entrySet()) {
        if ("from".equals(entry.getKey()) || "to".equals(entry.getKey())) resolved.put(entry.getKey(), entry.getValue());
        else if (!java.util.Objects.equals(resolved.get(entry.getKey()), entry.getValue())) {
          throw new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED", "EasyV 追问只允许修改时间范围。");
        }
      }
    }
    Map<String, Object> validated = validateContext(resolved);
    Map<String, Object> next = new LinkedHashMap<>(previousPlan);
    next.put("summary", summary);
    next.put("mode", mode);
    next.put("steps", steps.stream().map(item -> {
      if (!(item instanceof Map<?, ?> map)) {
        throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "上一轮计划步骤格式无效。");
      }
      return Map.copyOf(copyContext(map));
    }).toList());
    next.put("_executionContract", ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT);
    next.put("_followUpId", requiredText(followUpId, "FOLLOW_UP_REPLAN_INVALID", "追问 ID 缺失。"));
    next.put("_referencedExecutionId", requiredText(referencedExecutionId, "FOLLOW_UP_REPLAN_INVALID", "来源执行 ID 缺失。"));
    next.put("_resolvedContext", validated);
    return Map.copyOf(next);
  }

  @Override
  public Map<String, Object> executableContext(
      Map<String, Object> currentPlan, Map<String, Object> mergedContext) {
    // Once a plan exists, its resolved context is the immutable execution input;
    // merged UI context is only used before planning and cannot silently override it.
    if (currentPlan != null && currentPlan.get("_resolvedContext") != null) {
      return inheritedContext(currentPlan);
    }
    return validateContext(mergedContext);
  }

  private static EasyVDateRange resolveFollowUpRange(String question, Map<String, Object> inherited) {
    try {
      LocalDate anchor = LocalDate.parse(requiredText(inherited.get("to"), "FOLLOW_UP_CONTEXT_INVALID", "来源时间范围无效。"));
      Instant anchoredAt = anchor.atStartOfDay(EasyVDateRange.BUSINESS_ZONE).toInstant();
      return EasyVDateRange.resolve(question, anchoredAt);
    } catch (BackendException error) {
      throw error;
    } catch (RuntimeException error) {
      throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "EasyV 追问时间范围无效。", error);
    }
  }

  private static Map<String, Object> validateContext(Map<String, ?> context) {
    if (context == null) throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问上下文缺失。");
    Map<String, Object> copy = copyContext(context);
    if (!copy.keySet().equals(CONTEXT_KEYS)
        || !EasyVGenerationOntology.ENTITY_KEY.equals(copy.get("entity"))
        || !EasyVGenerationOntology.METRIC_KEY.equals(copy.get("metric"))
        || !EasyVGenerationOntology.TIME_KEY.equals(copy.get("time"))
        || !EasyVScopeResolver.ACCESS_MODE.equals(copy.get("accessMode"))
        || !(copy.get("userId") instanceof String userId) || !userId.matches("[1-9][0-9]*")) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问上下文不符合冻结领域契约。");
    }
    validateDate(copy);
    return Map.copyOf(copy);
  }

  private static void validateDate(Map<String, Object> context) {
    try {
      LocalDate from = LocalDate.parse(requiredText(context.get("from"), "FOLLOW_UP_CONTEXT_INVALID", "EasyV 起始日期缺失。"));
      LocalDate to = LocalDate.parse(requiredText(context.get("to"), "FOLLOW_UP_CONTEXT_INVALID", "EasyV 结束日期缺失。"));
      if (from.isAfter(to)) throw new IllegalArgumentException("from > to");
    } catch (BackendException error) {
      throw error;
    } catch (RuntimeException error) {
      throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "EasyV 追问时间范围必须是有效日期。", error);
    }
  }

  private static void validateOwner(Map<String, Object> context, AuthSession principal) {
    if (principal == null || !principal.userId().equals(context.get("userId"))) {
      throw new BackendException("FOLLOW_UP_SCOPE_INVALID", "EasyV 追问不能改变 creator-owned 用户范围。");
    }
  }

  private static Map<String, Object> copyContext(Map<?, ?> source) {
    Map<String, Object> copy = new LinkedHashMap<>();
    source.forEach((key, value) -> {
      if (key instanceof String) copy.put((String) key, value);
    });
    return copy;
  }

  private static String requiredText(Object value, String code, String message) {
    if (!(value instanceof String text) || text.isBlank()) throw new BackendException(code, message);
    return text;
  }
}
