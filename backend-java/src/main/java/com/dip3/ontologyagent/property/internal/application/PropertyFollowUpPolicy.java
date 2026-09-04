package com.dip3.ontologyagent.property.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.FollowUpPolicy;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.property.internal.domain.AnalysisCapabilityPolicy;
import com.dip3.ontologyagent.support.BackendException;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Property capability's complete follow-up language and planning policy. */
final class PropertyFollowUpPolicy implements FollowUpPolicy {
  private static final List<String> CONTEXT_FIELDS =
      List.of("targetMetric", "entity", "timeRange", "comparison");
  private static final Map<String, String> FIELD_LABELS =
      Map.of("targetMetric", "目标指标", "entity", "实体对象", "timeRange", "时间范围", "comparison", "比较方式");
  private static final Pattern FULL_MONTH =
      Pattern.compile("(?<!\\d)(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月份?");
  private static final Pattern CONTEXT_MONTH =
      Pattern.compile("(?<![\\d年])(\\d{1,2}|[一二三四五六七八九十]+)\\s*月份?(?=$|呢|[?？,，。])");
  private static final Pattern ISO_DATE = Pattern.compile("(?<!\\d)(\\d{4}-\\d{2}-\\d{2})(?!\\d)");
  private static final Pattern TIME_REFERENCE =
      Pattern.compile(
          "\\d{4}\\s*年|(?:\\d{1,2}|[一二三四五六七八九十]+)\\s*月份?(?=$|呢|[?？,，。])|"
              + "本月|上月|上个月|今年|去年|\\d{4}-\\d{2}-\\d{2}");
  private static final Pattern PROJECT_ID_REFERENCE =
      Pattern.compile("(?i)(?<![a-z0-9_-])project[-_][a-z0-9_-]+(?![a-z0-9_-])");
  private static final Pattern PROJECT_NAME_REFERENCE =
      Pattern.compile("[\\p{IsHan}a-zA-Z0-9_-]{1,40}(?:项目|小区|花园|园区)");
  private static final List<String> GENERIC_PROJECT_REFERENCES =
      List.of("所有项目", "全部项目", "当前项目", "这个项目", "该项目", "项目整体", "各项目");
  private static final List<String> FULL_SCOPE_REFERENCES =
      List.of("所有项目", "全部项目", "全体项目", "各项目", "项目整体", "全范围");

  private final PropertyProjectScopeResolver scopedProjects;

  PropertyFollowUpPolicy(PropertyProjectScopeResolver scopedProjects) {
    this.scopedProjects = Objects.requireNonNull(scopedProjects, "scopedProjects");
  }

  @Override
  public void validateQuestion(String question) {
    if (!AnalysisCapabilityPolicy.supportsFollowUp(question)) {
      throw new BackendException(
          "FOLLOW_UP_CAPABILITY_UNSUPPORTED", "当前追问仍只支持项目收缴率及应收账期口径，不能切换指标、尾欠口径或实收日期语义。");
    }
  }

  @Override
  public Map<String, Object> inheritedContext(Map<String, Object> sourcePlan) {
    Object raw = sourcePlan == null ? null : sourcePlan.get("_resolvedContext");
    if (!(raw instanceof Map<?, ?> source)) {
      throw new BackendException("FOLLOW_UP_CONTEXT_MISSING", "来源执行缺少 _resolvedContext，无法安全承接追问。");
    }
    String entity = required(source.get("entityKey"), "entityKey");
    String metric = required(source.get("metricDefinitionKey"), "metricDefinitionKey");
    String variant = required(source.get("metricVariantKey"), "metricVariantKey");
    String time = required(source.get("timeSemanticKey"), "timeSemanticKey");
    String from = required(source.get("from"), "from");
    String to = required(source.get("to"), "to");
    Object idsRaw = source.get("projectIds");
    if (!(idsRaw instanceof List<?> ids)
        || ids.stream().anyMatch(item -> !(item instanceof String value) || value.isBlank())) {
      throw new BackendException(
          "FOLLOW_UP_CONTEXT_INVALID", "来源执行的 _resolvedContext.projectIds 无效。");
    }
    List<String> projectIds = ids.stream().map(String.class::cast).toList();
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("targetMetric", field("目标指标", variant, "confirmed"));
    context.put(
        "entity",
        field("实体对象", projectIds.isEmpty() ? entity : String.join(",", projectIds), "confirmed"));
    context.put("timeRange", field("时间范围", from + "/" + to, "confirmed"));
    context.put("comparison", field("比较方式", "无需比较", "confirmed"));
    List<Map<String, Object>> constraints = new ArrayList<>();
    constraints.add(Map.of("label", "实体 business key", "value", entity));
    constraints.add(Map.of("label", "指标定义 business key", "value", metric));
    constraints.add(Map.of("label", "指标口径 business key", "value", variant));
    constraints.add(Map.of("label", "时间语义 business key", "value", time));
    projectIds.forEach(id -> constraints.add(Map.of("label", "项目 ID", "value", id)));
    context.put("constraints", List.copyOf(constraints));
    return Map.copyOf(context);
  }

  @Override
  public Map<String, Object> applyQuestionContext(
      String question, Map<String, Object> inherited, AuthSession owner) {
    Map<String, Object> merged = inherited;
    DateRange dateRange = dateRange(question, inherited);
    if (dateRange != null) merged = withTimeRange(merged, dateRange);
    List<PropertyProjectScopeResolver.ProjectTarget> targets = scopedProjects.targets(owner);
    boolean fullScope = FULL_SCOPE_REFERENCES.stream().anyMatch(question::contains);
    List<PropertyProjectScopeResolver.ProjectTarget> matches =
        targets.stream().filter(target -> containsTarget(question, target)).toList();
    LinkedHashSet<String> ids = new LinkedHashSet<>();
    matches.forEach(target -> ids.add(target.id()));
    if (ids.size() > 1)
      throw new BackendException("FOLLOW_UP_SCOPE_INVALID", "追问中的项目名称或 ID 不唯一，请明确一个授权项目。");
    if (fullScope && (!ids.isEmpty() || hasExplicitProjectReference(question))) {
      throw new BackendException("FOLLOW_UP_SCOPE_INVALID", "追问同时指定了全部项目和单个项目，范围不唯一。");
    }
    if (fullScope)
      return withProjects(
          merged, targets.stream().map(PropertyProjectScopeResolver.ProjectTarget::id).toList());
    if (ids.size() == 1) return withProject(merged, ids.getFirst());
    if (hasExplicitProjectReference(question)) {
      throw new BackendException("FOLLOW_UP_SCOPE_INVALID", "追问中的项目未唯一匹配当前账号授权范围。");
    }
    return merged;
  }

  @Override
  public FollowUpAdjustment adjust(
      Map<String, Object> inherited,
      Map<String, Object> current,
      Map<String, String> draft,
      boolean confirmConflicts) {
    Map<String, String> changes = new LinkedHashMap<>();
    for (String field : CONTEXT_FIELDS) {
      String value = normalize(draft.get(field));
      validateAdjustmentValue(value);
      if (!value.isEmpty()) changes.put(field, value);
    }
    String factor = normalize(draft.get("factor"));
    validateAdjustmentValue(factor);
    if (changes.isEmpty() && factor.isEmpty()) {
      throw new BackendException("INVALID_FOLLOW_UP_ADJUSTMENT", "至少需要补充一个因素或范围条件。");
    }
    List<Map<String, Object>> conflicts = conflicts(current, changes);
    if (!conflicts.isEmpty() && !confirmConflicts) throw new ConflictException(conflicts);
    Map<String, Object> merged = mutableContext(current);
    changes.forEach(
        (key, value) -> merged.put(key, field(FIELD_LABELS.get(key), value, "confirmed")));
    if (!factor.isEmpty()) addFactor(merged, factor);
    boolean changed = !Objects.equals(merged, current);
    Map<String, Object> next = immutableContext(merged);
    if (!changed) next = current;
    return new FollowUpAdjustment(next, contextDiff(inherited, next));
  }

  @Override
  public Map<String, Object> replan(
      Map<String, Object> previous,
      Map<String, Object> inherited,
      Map<String, Object> context,
      AuthSession owner,
      String followUpId,
      String referencedExecutionId) {
    if (!(previous.get("steps") instanceof List<?> steps)) {
      throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "上一轮计划步骤无效，无法重规划。");
    }
    Object raw = previous.get("_resolvedContext");
    if (!(raw instanceof Map<?, ?> resolvedRaw)) {
      throw new BackendException("FOLLOW_UP_CONTEXT_MISSING", "上一轮计划缺少 _resolvedContext，无法安全重规划。");
    }
    Map<String, Object> resolved = new LinkedHashMap<>((Map<String, Object>) resolvedRaw);
    String targetMetric = fieldValue(context, "targetMetric");
    if (!targetMetric.equals(fieldValue(inherited, "targetMetric"))) {
      throw new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED", "当前 Workflow 尚不支持改变目标指标。");
    }
    String entity = fieldValue(context, "entity");
    if (!entity.equals(fieldValue(inherited, "entity"))) {
      List<String> requested =
          List.of(entity.split(",")).stream()
              .map(String::trim)
              .filter(value -> !value.isEmpty())
              .toList();
      List<String> authorized = scopedProjects.resolve(owner);
      if (requested.isEmpty() || !authorized.containsAll(requested)) {
        throw new BackendException(
            "FOLLOW_UP_REPLAN_UNSUPPORTED", "当前 Workflow 仅支持切换到账号已授权的项目 ID 子集。");
      }
      resolved.put("projectIds", requested);
    }
    String timeRange = fieldValue(context, "timeRange");
    if (!timeRange.equals(fieldValue(inherited, "timeRange"))) {
      String[] boundaries = timeRange.split("/", -1);
      if (boundaries.length != 2)
        throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "时间范围必须使用 yyyy-MM-dd/yyyy-MM-dd。");
      try {
        LocalDate from = LocalDate.parse(boundaries[0].trim());
        LocalDate to = LocalDate.parse(boundaries[1].trim());
        if (from.isAfter(to)) throw new DateTimeParseException("from > to", timeRange, 0);
        resolved.put("from", from.toString());
        resolved.put("to", to.toString());
      } catch (DateTimeParseException error) {
        throw new BackendException(
            "FOLLOW_UP_REPLAN_INVALID", "时间范围必须使用有效的 yyyy-MM-dd/yyyy-MM-dd。", error);
      }
    }
    if (!fieldValue(context, "comparison").equals(fieldValue(inherited, "comparison"))) {
      throw new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED", "当前 Workflow 尚不支持改变比较方式。");
    }
    Map<String, Object> next = new LinkedHashMap<>(previous);
    next.put("summary", "追问重规划：基于本轮确认上下文重新执行，不复用上一轮步骤结果。");
    next.put(
        "steps",
        steps.stream().map(item -> new LinkedHashMap<>((Map<String, Object>) item)).toList());
    next.put("_executionContract", ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT);
    next.put("_followUpId", followUpId);
    next.put("_referencedExecutionId", referencedExecutionId);
    next.put("_resolvedContext", Map.copyOf(resolved));
    return Map.copyOf(next);
  }

  @Override
  @SuppressWarnings("unchecked")
  public Map<String, Object> executableContext(
      Map<String, Object> plan, Map<String, Object> mergedContext) {
    Object resolved = plan == null ? null : plan.get("_resolvedContext");
    Map<String, Object> context = new LinkedHashMap<>(mergedContext);
    if (resolved instanceof Map<?, ?> map) {
      context.putAll((Map<String, Object>) map);
      return Map.copyOf(context);
    }
    Object constraints = context.get("constraints");
    if (!(constraints instanceof List<?> list))
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问上下文缺少受控约束。");
    for (Object item : list) {
      if (!(item instanceof Map<?, ?> entry)) continue;
      String label = text(entry.get("label"));
      Object value = entry.get("value");
      if ("实体 business key".equals(label)) context.put("entityKey", value);
      else if ("指标定义 business key".equals(label)) context.put("metricDefinitionKey", value);
      else if ("指标口径 business key".equals(label)) context.put("metricVariantKey", value);
      else if ("时间语义 business key".equals(label)) context.put("timeSemanticKey", value);
    }
    String[] range = fieldValue(context, "timeRange").split("/", -1);
    if (range.length != 2)
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问时间范围必须使用 yyyy-MM-dd/yyyy-MM-dd。");
    context.put("from", range[0]);
    context.put("to", range[1]);
    context.put(
        "projectIds",
        list.stream()
            .filter(Map.class::isInstance)
            .map(Map.class::cast)
            .filter(entry -> "项目 ID".equals(entry.get("label")))
            .map(entry -> text(entry.get("value")))
            .filter(value -> value != null && !value.isBlank())
            .toList());
    if (List.of("entityKey", "metricDefinitionKey", "metricVariantKey", "timeSemanticKey").stream()
        .anyMatch(key -> blank(text(context.get(key))))) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问上下文缺少受控本体键。");
    }
    return Map.copyOf(context);
  }

  private static DateRange dateRange(String question, Map<String, Object> inherited) {
    List<String> iso = matches(ISO_DATE, question, 1), full = matches(FULL_MONTH, question, 0);
    List<String> contextMonths =
        matches(CONTEXT_MONTH, FULL_MONTH.matcher(question).replaceAll(" "), 1);
    int categories =
        (iso.isEmpty() ? 0 : 1) + (full.isEmpty() ? 0 : 1) + (contextMonths.isEmpty() ? 0 : 1);
    if (categories > 1
        || !iso.isEmpty() && iso.size() != 2
        || !full.isEmpty() && full.size() != 1
        || !contextMonths.isEmpty() && contextMonths.size() != 1) {
      throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "追问中的时间范围不唯一或格式无效。");
    }
    try {
      if (!iso.isEmpty()) {
        LocalDate from = LocalDate.parse(iso.get(0)), to = LocalDate.parse(iso.get(1));
        if (from.isAfter(to)) throw new DateTimeParseException("from > to", question, 0);
        return new DateRange(from, to);
      }
      if (!full.isEmpty()) {
        Matcher m = FULL_MONTH.matcher(full.getFirst());
        if (!m.find()) throw new DateTimeParseException("month", question, 0);
        return month(YearMonth.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2))));
      }
      if (!contextMonths.isEmpty()) {
        String[] b = fieldValue(inherited, "timeRange").split("/", -1);
        if (b.length != 2)
          throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "来源时间范围格式无效。");
        LocalDate from = LocalDate.parse(b[0]), to = LocalDate.parse(b[1]);
        if (from.getYear() != to.getYear())
          throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "省略年份的月份无法从跨年来源范围唯一确定年份。");
        return month(YearMonth.of(from.getYear(), monthNumber(contextMonths.getFirst())));
      }
    } catch (BackendException error) {
      throw error;
    } catch (NumberFormatException | java.time.DateTimeException error) {
      throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "追问中的时间范围格式无效。", error);
    }
    if (TIME_REFERENCE.matcher(question).find())
      throw new BackendException(
          "FOLLOW_UP_TIME_RANGE_INVALID", "追问时间范围必须提供完整年月、可从来源年份确定的单月，或两个 ISO 日期。");
    return null;
  }

  private static List<String> matches(Pattern pattern, String value, int group) {
    List<String> out = new ArrayList<>();
    Matcher m = pattern.matcher(value);
    while (m.find()) out.add(m.group(group));
    return out;
  }

  private static DateRange month(YearMonth month) {
    return new DateRange(month.atDay(1), month.atEndOfMonth());
  }

  private static int monthNumber(String value) {
    if (value.chars().allMatch(Character::isDigit)) return Integer.parseInt(value);
    return switch (value) {
      case "一" -> 1;
      case "二" -> 2;
      case "三" -> 3;
      case "四" -> 4;
      case "五" -> 5;
      case "六" -> 6;
      case "七" -> 7;
      case "八" -> 8;
      case "九" -> 9;
      case "十" -> 10;
      case "十一" -> 11;
      case "十二" -> 12;
      default -> throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "追问月份格式无效。");
    };
  }

  private static boolean containsTarget(String q, PropertyProjectScopeResolver.ProjectTarget t) {
    return !blank(t.id()) && containsIdentifier(q, t.id())
        || !blank(t.name()) && containsProjectName(q, t.name());
  }

  private static boolean containsIdentifier(String q, String id) {
    return Pattern.compile("(?i)(?<![a-z0-9_-])" + Pattern.quote(id) + "(?![a-z0-9_-])")
        .matcher(q)
        .find();
  }

  private static boolean containsProjectName(String q, String name) {
    return q.contains(name)
        && Pattern.compile(
                "(?:^|(?:改看|看|分析|换成|那|查|对比|比较))\\s*" + Pattern.quote(name) + "(?=$|呢|[?？,，。])")
            .matcher(q)
            .find();
  }

  private static boolean hasExplicitProjectReference(String q) {
    String x = q;
    for (String generic : GENERIC_PROJECT_REFERENCES) x = x.replace(generic, "");
    return PROJECT_ID_REFERENCE.matcher(q).find()
        || PROJECT_NAME_REFERENCE.matcher(x).find()
        || Pattern.compile("项目(?:\\d+|[一二三四五六七八九十]+|[a-zA-Z][a-zA-Z0-9_-]*)").matcher(x).find();
  }

  private static Map<String, Object> withProject(Map<String, Object> c, String id) {
    return withProjects(c, List.of(id));
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> withProjects(Map<String, Object> c, List<String> ids) {
    Map<String, Object> n = mutableContext(c);
    n.put("entity", field("实体对象", String.join(",", ids), "confirmed"));
    List<Map<String, Object>> cs = (List<Map<String, Object>>) n.get("constraints");
    cs.removeIf(i -> "项目 ID".equals(i.get("label")));
    ids.forEach(id -> cs.add(Map.of("label", "项目 ID", "value", id)));
    n.put("constraints", List.copyOf(cs));
    return immutableContext(n);
  }

  private static Map<String, Object> withTimeRange(Map<String, Object> c, DateRange r) {
    Map<String, Object> n = new LinkedHashMap<>(c);
    n.put("timeRange", field("时间范围", r.from() + "/" + r.to(), "confirmed"));
    return immutableContext(n);
  }

  private static void validateAdjustmentValue(String v) {
    if (v.length() > 200)
      throw new BackendException("INVALID_FOLLOW_UP_ADJUSTMENT", "追问上下文单个字段不能超过 200 个字符。");
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> mutableContext(Map<String, Object> s) {
    Map<String, Object> c = new LinkedHashMap<>(s);
    Object x = s.get("constraints");
    c.put(
        "constraints",
        x instanceof List<?> l
            ? new ArrayList<>(
                l.stream().map(i -> new LinkedHashMap<>((Map<String, Object>) i)).toList())
            : new ArrayList<>());
    return c;
  }

  @SuppressWarnings("unchecked")
  private static void addFactor(Map<String, Object> c, String f) {
    List<Map<String, Object>> cs = (List<Map<String, Object>>) c.get("constraints");
    if (cs.stream().noneMatch(i -> "候选因素".equals(i.get("label")) && f.equals(i.get("value"))))
      cs.add(Map.of("label", "候选因素", "value", f));
  }

  private static List<Map<String, Object>> conflicts(
      Map<String, Object> c, Map<String, String> changes) {
    List<Map<String, Object>> out = new ArrayList<>();
    changes.forEach(
        (k, v) -> {
          Map<?, ?> f = c.get(k) instanceof Map<?, ?> m ? m : Map.of();
          String old = text(f.get("value"));
          if ("confirmed".equals(f.get("state")) && !Objects.equals(old, v))
            out.add(change("field", k, FIELD_LABELS.get(k), old, v));
        });
    return List.copyOf(out);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> contextDiff(Map<String, Object> a, Map<String, Object> b) {
    List<Map<String, Object>> overridden = new ArrayList<>(), added = new ArrayList<>();
    for (String k : CONTEXT_FIELDS) {
      Map<String, Object> x = (Map<String, Object>) a.get(k), y = (Map<String, Object>) b.get(k);
      if (!Objects.equals(x.get("value"), y.get("value")))
        overridden.add(
            change("field", k, FIELD_LABELS.get(k), text(x.get("value")), text(y.get("value"))));
    }
    List<Map<String, Object>> ac = (List<Map<String, Object>>) b.get("constraints"),
        bc = (List<Map<String, Object>>) a.get("constraints");
    ac.stream()
        .filter(i -> !bc.contains(i))
        .forEach(
            i ->
                added.add(
                    Map.of(
                        "type",
                        "constraint",
                        "key",
                        i.get("label") + ":" + i.get("value"),
                        "label",
                        i.get("label"),
                        "nextValue",
                        i.get("value"))));
    return Map.of("added", added, "overridden", overridden);
  }

  private static String fieldValue(Map<String, Object> c, String k) {
    if (!(c.get(k) instanceof Map<?, ?> f) || blank(text(f.get("value"))))
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问上下文字段 " + k + " 无效。");
    return text(f.get("value"));
  }

  private static String required(Object value, String key) {
    String resolved = text(value);
    if (blank(resolved)) {
      throw new BackendException(
          "FOLLOW_UP_CONTEXT_INVALID", "来源执行的 _resolvedContext." + key + " 无效。");
    }
    return resolved;
  }

  private static Map<String, Object> immutableContext(Map<String, Object> c) {
    return Map.copyOf(c);
  }

  private static Map<String, Object> field(String l, String v, String s) {
    return Map.of("label", l, "value", v, "state", s);
  }

  private static Map<String, Object> change(String t, String k, String l, String p, String n) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", t);
    m.put("key", k);
    m.put("label", l);
    m.put("previousValue", p);
    m.put("nextValue", n);
    return m;
  }

  private static String normalize(String v) {
    return v == null
        ? ""
        : Normalizer.normalize(v, Normalizer.Form.NFKC).replaceAll("[\\s\\u3000]+", " ").trim();
  }

  private static String text(Object v) {
    return v == null ? null : v.toString();
  }

  private static boolean blank(String v) {
    return v == null || v.isBlank();
  }

  private record DateRange(LocalDate from, LocalDate to) {}
}
