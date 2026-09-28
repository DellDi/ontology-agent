package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.FollowUpPolicy;
import com.dip3.ontologyagent.semantic.api.QueryIntentCodec;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.support.BackendException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * EasyV 追问策略：追问以自然语言表达调整，由模型结合上一轮已执行的查询意图重新规划；
 * 平台侧不做字段级合并与重规划。展示上下文由来源计划的 _resolvedContext 派生；
 * 旧版分析链路的结论不支持追问。
 */
final class EasyVFollowUpPolicy implements FollowUpPolicy {
  private static final Pattern OUT_OF_DOMAIN = Pattern.compile("切换领域|物业");

  private final SemanticModel semantic;

  EasyVFollowUpPolicy(SemanticModel semantic) {
    this.semantic = semantic;
  }

  @Override
  public void validateQuestion(String question) {
    if (question == null || question.isBlank()) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "请输入追问内容。");
    }
    if (OUT_OF_DOMAIN.matcher(question).find()) {
      throw new BackendException("FOLLOW_UP_CAPABILITY_UNSUPPORTED", "EasyV 追问不支持切换到其他业务领域，请发起新的分析。");
    }
  }

  @Override
  public Map<String, Object> inheritedContext(Map<String, Object> sourcePlan) {
    Map<String, Object> resolved = resolvedContext(sourcePlan);
    List<Map<String, Object>> queries = queries(resolved);
    Set<String> labels = new LinkedHashSet<>();
    Set<String> objects = new LinkedHashSet<>();
    Set<String> ranges = new LinkedHashSet<>();
    Set<String> comparisons = new LinkedHashSet<>();
    for (Map<String, Object> query : queries) {
      labels.add(String.valueOf(query.get("label")));
      ranges.add(String.valueOf(query.get("range")));
      if (query.get("compareRange") instanceof String compare) comparisons.add(compare);
      if (query.get("intent") instanceof Map<?, ?> intent && intent.get("object") instanceof String objectKey) {
        objects.add(semantic.find(objectKey).map(object -> object.label()).orElse(objectKey));
      }
    }
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("targetMetric", field("分析指标", String.join("；", labels)));
    context.put("entity", field("分析对象", objects.isEmpty() ? "EasyV 数据" : String.join("、", objects)));
    context.put("timeRange", field("时间范围", String.join("；", ranges)));
    context.put("comparison", field("比较方式", comparisons.isEmpty() ? "无需比较" : "对比 " + String.join("；", comparisons)));
    context.put("constraints", List.of(Map.of("label", "数据范围", "value", String.valueOf(resolved.get("dataScope")))));
    return Map.copyOf(context);
  }

  @Override
  public Map<String, Object> applyQuestionContext(
      String question, Map<String, Object> inheritedContext, AuthSession principal) {
    return inheritedContext;
  }

  @Override
  public FollowUpAdjustment adjust(Map<String, Object> inheritedContext, Map<String, Object> mergedContext,
                                   Map<String, String> draft, boolean confirmConflicts) {
    throw replanUnsupported();
  }

  @Override
  public Map<String, Object> replan(Map<String, Object> previousPlan, Map<String, Object> inheritedContext,
                                    Map<String, Object> mergedContext, AuthSession principal, String followUpId,
                                    String referencedExecutionId) {
    throw replanUnsupported();
  }

  /** 执行上下文：来源执行已执行的查询意图，供模型在其基础上理解追问。 */
  @Override
  public Map<String, Object> executableContext(Map<String, Object> sourcePlan, Map<String, Object> currentPlan,
                                               Map<String, Object> mergedContext) {
    List<Map<String, Object>> intents = new ArrayList<>();
    for (Map<String, Object> query : queries(resolvedContext(sourcePlan))) {
      Object intent = query.get("intent");
      if (!QueryIntentCodec.read(intent).accepted()) {
        throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "来源执行的查询意图 " + query.get("id") + " 无效。");
      }
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("id", query.get("id"));
      item.put("label", query.get("label"));
      item.put("intent", intent);
      intents.add(Map.copyOf(item));
    }
    return Map.of("queries", List.copyOf(intents));
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> resolvedContext(Map<String, Object> sourcePlan) {
    Object raw = sourcePlan == null ? null : sourcePlan.get("_resolvedContext");
    if (!(raw instanceof Map<?, ?> map) || !(map.get("queries") instanceof List<?>)
        || !(map.get("dataScope") instanceof String)) {
      throw new BackendException("FOLLOW_UP_LEGACY_EXECUTION", "该结论由旧版分析链路生成，不支持追问，请发起新的分析。");
    }
    return (Map<String, Object>) map;
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> queries(Map<String, Object> resolved) {
    List<?> list = (List<?>) resolved.get("queries");
    if (list.isEmpty() || list.stream().anyMatch(item -> !(item instanceof Map<?, ?> map)
        || !(map.get("id") instanceof String) || !(map.get("label") instanceof String)
        || !(map.get("range") instanceof String) || !(map.get("intent") instanceof Map<?, ?>))) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "来源执行缺少有效的查询意图，无法承接追问。");
    }
    return list.stream().map(item -> (Map<String, Object>) item).toList();
  }

  private static Map<String, Object> field(String label, String value) {
    return Map.of("label", label, "value", value, "state", "confirmed");
  }

  private static BackendException replanUnsupported() {
    return new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED",
        "EasyV 追问请直接用自然语言描述调整（例如“改看上个月”“按周拆分”），无需手动调整上下文。");
  }
}
