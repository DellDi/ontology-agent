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
import java.util.Objects;
import java.util.Set;

/**
 * V1 follow-up policy: only a new, validated date range may change.
 *
 * <p>追问行的 inheritedContext/mergedContext 采用平台统一的 AnalysisContext 展示形态
 * （targetMetric/entity/timeRange/comparison 字段 + constraints），与 Property 域一致；
 * 域键（entity/metric/time/accessMode/userId）以受控约束项随行，可无损还原为
 * 执行用的 _resolvedContext 域形态。</p>
 */
final class EasyVFollowUpPolicy implements FollowUpPolicy {
  private static final Set<String> CONTEXT_KEYS =
      Set.of("entity", "metric", "time", "from", "to", "accessMode", "userId");
  private static final List<String> DISPLAY_FIELDS =
      List.of("targetMetric", "entity", "timeRange", "comparison");
  private static final String METRIC_LABEL = "生成质量分析";
  private static final String ENTITY_LABEL = "AI 大屏应用";

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
    return displayContext(validateDomain(copyContext(context)));
  }

  @Override
  public Map<String, Object> applyQuestionContext(
      String question, Map<String, Object> inheritedContext, AuthSession principal) {
    validateQuestion(question);
    Map<String, Object> domain = domainContext(inheritedContext);
    validateOwner(domain, principal);
    EasyVDateRange range = resolveFollowUpRange(question, domain);
    Map<String, Object> next = mutableContext(displayContext(domain));
    if (range != null) {
      next.put("timeRange", field("时间范围", range.describe(), "confirmed"));
    }
    return immutableContext(next);
  }

  @Override
  public FollowUpAdjustment adjust(
      Map<String, Object> inheritedContext,
      Map<String, Object> mergedContext,
      Map<String, String> draft,
      boolean confirmConflicts) {
    String timeRange = draft == null ? "" : normalize(draft.get("timeRange"));
    if (draft != null && draft.entrySet().stream()
        .anyMatch(entry -> !"timeRange".equals(entry.getKey())
            && entry.getValue() != null && !entry.getValue().isBlank())) {
      throw new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED", "EasyV 追问只允许修改时间范围。");
    }
    if (timeRange.isEmpty()) {
      throw new BackendException("INVALID_FOLLOW_UP_ADJUSTMENT", "至少需要补充一个范围条件。");
    }
    EasyVDateRange.parseDisplay(timeRange);
    Map<String, Object> next = mutableContext(mergedContext);
    String previous = fieldValue(mergedContext, "timeRange");
    next.put("timeRange", field("时间范围", timeRange, "confirmed"));
    Map<String, Object> diff = Objects.equals(previous, timeRange)
        ? Map.of("added", List.of(), "overridden", List.of())
        : Map.of(
            "added", List.of(),
            "overridden", List.of(Map.of(
                "type", "field", "key", "timeRange", "label", "时间范围",
                "previousValue", previous, "nextValue", timeRange)));
    return new FollowUpAdjustment(immutableContext(next), diff);
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
    Map<String, Object> previousResolved = domainContext(previousPlan.get("_resolvedContext"));
    Map<String, Object> inherited = domainContext(inheritedContext);
    if (!previousResolved.equals(inherited)) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问继承上下文与上一轮冻结上下文不一致。");
    }
    validateOwner(inherited, principal);
    Map<String, Object> merged = domainContext(mergedContext);
    Map<String, Object> resolved = new LinkedHashMap<>(inherited);
    for (Map.Entry<String, Object> entry : merged.entrySet()) {
      if ("from".equals(entry.getKey()) || "to".equals(entry.getKey())) {
        resolved.put(entry.getKey(), entry.getValue());
      } else if (!Objects.equals(resolved.get(entry.getKey()), entry.getValue())) {
        throw new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED", "EasyV 追问只允许修改时间范围。");
      }
    }
    Map<String, Object> validated = validateDomain(resolved);
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
      return domainContext(currentPlan.get("_resolvedContext"));
    }
    return domainContext(mergedContext);
  }

  // ---------------------------------------------------------------------------
  // 展示形态 <-> 域形态 转换
  // ---------------------------------------------------------------------------

  private static Map<String, Object> displayContext(Map<String, Object> domain) {
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("targetMetric", field("目标指标", METRIC_LABEL, "confirmed"));
    context.put("entity", field("实体对象", ENTITY_LABEL, "confirmed"));
    context.put("timeRange", field("时间范围", describeRange(domain), "confirmed"));
    context.put("comparison", field("比较方式", "无需比较", "confirmed"));
    context.put("constraints", List.of(
        Map.of("label", "实体 business key", "value", String.valueOf(domain.get("entity"))),
        Map.of("label", "指标 business key", "value", String.valueOf(domain.get("metric"))),
        Map.of("label", "时间语义 business key", "value", String.valueOf(domain.get("time"))),
        Map.of("label", "数据范围", "value", "全量数据"),
        Map.of("label", "访问模式", "value", String.valueOf(domain.get("accessMode"))),
        Map.of("label", "执行账号 ID", "value", String.valueOf(domain.get("userId")))));
    return Map.copyOf(context);
  }

  /** 展示形态或域形态统一还原为域上下文；缺字段/多字段/取值越界一律拒绝。 */
  private static Map<String, Object> domainContext(Object context) {
    if (!(context instanceof Map<?, ?> raw)) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问上下文缺失。");
    }
    Map<String, Object> source = copyContext(raw);
    if (source.containsKey("entity") && source.containsKey("metric") && !source.containsKey("targetMetric")) {
      return validateDomain(source);
    }
    if (!source.keySet().equals(Set.of("targetMetric", "entity", "timeRange", "comparison", "constraints"))) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问上下文不符合展示契约形态。");
    }
    for (String key : DISPLAY_FIELDS) fieldValue(source, key);
    Map<String, Object> domain = new LinkedHashMap<>();
    domain.put("entity", constraintValue(source, "实体 business key"));
    domain.put("metric", constraintValue(source, "指标 business key"));
    domain.put("time", constraintValue(source, "时间语义 business key"));
    domain.put("accessMode", constraintValue(source, "访问模式"));
    domain.put("userId", constraintValue(source, "执行账号 ID"));
    EasyVDateRange range;
    try {
      range = EasyVDateRange.parseDisplay(fieldValue(source, "timeRange"));
    } catch (BackendException error) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", error.getMessage(), error);
    }
    domain.put("from", range.from().toString());
    domain.put("to", range.to().toString());
    return validateDomain(domain);
  }

  private static Map<String, Object> validateDomain(Map<String, ?> context) {
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

  private static EasyVDateRange resolveFollowUpRange(String question, Map<String, Object> domain) {
    try {
      LocalDate anchor = LocalDate.parse(String.valueOf(domain.get("to")));
      Instant anchoredAt = anchor.atStartOfDay(EasyVDateRange.BUSINESS_ZONE).toInstant();
      return EasyVDateRange.resolve(question, anchoredAt);
    } catch (BackendException error) {
      // 追问不含时间表达时继承上一轮窗口，而不是把整轮打死。
      if ("EASYV_TIME_RANGE_REQUIRED".equals(error.code())) return null;
      throw error;
    } catch (RuntimeException error) {
      throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "EasyV 追问时间范围无效。", error);
    }
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

  private static void validateOwner(Map<String, Object> domain, AuthSession principal) {
    if (principal == null || !principal.userId().equals(domain.get("userId"))) {
      throw new BackendException("FOLLOW_UP_SCOPE_INVALID", "EasyV 追问不能改变执行者身份。");
    }
  }

  private static String describeRange(Map<String, Object> domain) {
    return new EasyVDateRange(
            LocalDate.parse(String.valueOf(domain.get("from"))),
            LocalDate.parse(String.valueOf(domain.get("to"))))
        .describe();
  }

  private static Map<String, Object> field(String label, String value, String state) {
    return Map.of("label", label, "value", value, "state", state);
  }

  private static String fieldValue(Map<String, Object> context, String key) {
    Object raw = context.get(key);
    if (raw instanceof Map<?, ?> field && field.get("value") instanceof String value && !value.isBlank()) {
      return value;
    }
    throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问上下文缺少字段：" + key);
  }

  private static String constraintValue(Map<String, Object> context, String label) {
    Object raw = context.get("constraints");
    if (raw instanceof List<?> list) {
      for (Object item : list) {
        if (item instanceof Map<?, ?> entry && label.equals(entry.get("label"))
            && entry.get("value") instanceof String value && !value.isBlank()) {
          return value;
        }
      }
    }
    throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问上下文缺少受控约束：" + label);
  }

  private static Map<String, Object> mutableContext(Map<String, Object> source) {
    Map<String, Object> copy = new LinkedHashMap<>(source);
    Object constraints = source.get("constraints");
    copy.put("constraints", constraints instanceof List<?> list
        ? list.stream().map(item -> item instanceof Map<?, ?> map
            ? new LinkedHashMap<>(copyContext(map)) : item).toList()
        : List.of());
    return copy;
  }

  private static Map<String, Object> immutableContext(Map<String, Object> source) {
    for (String key : DISPLAY_FIELDS) fieldValue(source, key);
    return Map.copyOf(source);
  }

  private static Map<String, Object> copyContext(Map<?, ?> source) {
    Map<String, Object> copy = new LinkedHashMap<>();
    source.forEach((key, value) -> {
      if (key instanceof String) copy.put((String) key, value);
    });
    return copy;
  }

  private static String normalize(String value) {
    return value == null ? "" : value.trim();
  }

  private static String requiredText(Object value, String code, String message) {
    if (!(value instanceof String text) || text.isBlank()) throw new BackendException(code, message);
    return text;
  }
}
