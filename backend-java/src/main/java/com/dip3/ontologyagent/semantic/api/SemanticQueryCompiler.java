package com.dip3.ontologyagent.semantic.api;

import com.dip3.ontologyagent.semantic.api.QueryIntent.Filter;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Operator;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 把 {@link QueryIntent} 校验并编译为受治理的 Cube 查询。校验失败汇总全部违规项
 * （{@link Result#violations()}），供模型一次纠正；时间以执行锚点与领域业务时区确定性解析。
 * 冻结版本、成员资格关联与授权范围不在此处拼装，由 Cube queryRewrite 按服务端签发的上下文强制注入。
 */
public final class SemanticQueryCompiler {
  /** 未指定 Top N 时的平台行数上限；结果达到上限视为截断失败。 */
  public static final int ROW_CAP = 5000;
  public static final int MAX_TOP_N = 1000;
  public static final String TIME_ORDER_MEMBER = "time";
  private static final int MAX_MEASURES = 8;
  private static final int MAX_DIMENSIONS = 4;
  private static final int MAX_FILTERS = 10;
  private static final int MAX_FILTER_VALUES = 100;

  private final SemanticModel model;

  public SemanticQueryCompiler(SemanticModel model) {
    this.model = model;
  }

  public Result compile(QueryIntent intent, Instant anchoredAt) {
    if (intent == null || anchoredAt == null) {
      throw new BackendException("QUERY_INTENT_INVALID", "查询意图或执行锚点缺失。");
    }
    List<String> violations = new ArrayList<>();
    OntologyObjectType root = intent.objectKey() == null ? null : model.find(intent.objectKey()).orElse(null);
    if (root == null) {
      violations.add("objectKey 不存在：" + intent.objectKey());
      return Result.rejected(violations);
    }
    ZoneId zone = model.businessZone(root.key());
    List<CompiledSemanticQuery.Column> columns = new ArrayList<>();
    Set<String> productKeys = new LinkedHashSet<>();
    collectProducts(root, productKeys);
    Map<String, Object> query = new LinkedHashMap<>();

    List<String> dimensionMembers = new ArrayList<>();
    if (intent.dimensions().size() > MAX_DIMENSIONS) violations.add("dimensions 最多 " + MAX_DIMENSIONS + " 个");
    for (String path : new LinkedHashSet<>(intent.dimensions())) {
      SemanticModel.ResolvedMember member = resolve(root, path, violations, "dimensions");
      if (member == null) continue;
      if (member.property().type() == OntologyProperty.Type.TIME) {
        violations.add("dimensions 不能直接使用时间属性 " + path + "，请使用 time.granularity 分桶");
        continue;
      }
      collectProducts(member.owner(), productKeys);
      dimensionMembers.add(member.cubeMember());
      columns.add(new CompiledSemanticQuery.Column(member.cubeMember(), path, member.property().label(),
          CompiledSemanticQuery.ColumnKind.DIMENSION, member.property().type()));
    }

    List<String> measureMembers = new ArrayList<>();
    List<CompiledSemanticQuery.Column> measureColumns = new ArrayList<>();
    if (intent.measures().isEmpty()) violations.add("measures 至少一个根对象指标");
    if (intent.measures().size() > MAX_MEASURES) violations.add("measures 最多 " + MAX_MEASURES + " 个");
    for (String key : new LinkedHashSet<>(intent.measures())) {
      OntologyMetric metric = root.findMetric(key).orElse(null);
      if (metric == null) {
        violations.add("measures 中的指标不存在于对象 " + root.key() + "：" + key);
        continue;
      }
      String member = root.cubeName() + "." + metric.key();
      measureMembers.add(member);
      measureColumns.add(new CompiledSemanticQuery.Column(member, key, metric.label(),
          CompiledSemanticQuery.ColumnKind.MEASURE, OntologyProperty.Type.NUMBER));
    }

    List<Map<String, Object>> filters = new ArrayList<>();
    if (intent.filters().size() > MAX_FILTERS) violations.add("filters 最多 " + MAX_FILTERS + " 个");
    for (Filter filter : intent.filters()) {
      Map<String, Object> compiled = filter(root, filter, violations, productKeys);
      if (compiled != null) filters.add(compiled);
    }

    ResolvedTimeRange range = null;
    ResolvedTimeRange compareRange = null;
    String timeMember = null;
    String granularity = null;
    SemanticModel.ResolvedMember timeProperty = null;
    QueryIntent.TimeSpec time = intent.time();
    if (time == null || time.expression() == null) {
      violations.add("time.expression 必填；用户未指定时间时使用 kind=all");
    } else {
      String path = time.dimension() == null || time.dimension().isBlank() ? root.defaultTimeProperty() : time.dimension();
      if (path == null) {
        violations.add("对象 " + root.key() + " 没有默认时间属性，time.dimension 必填");
      } else {
        timeProperty = resolve(root, path, violations, "time.dimension");
        if (timeProperty != null && timeProperty.property().type() != OntologyProperty.Type.TIME) {
          violations.add("time.dimension 必须是时间属性：" + path);
          timeProperty = null;
        }
      }
      if (timeProperty != null) {
        collectProducts(timeProperty.owner(), productKeys);
        timeMember = timeProperty.cubeMember();
        range = resolveTime(time.expression(), anchoredAt, zone, violations, "time.expression");
        granularity = time.granularity() == null ? null : time.granularity().name().toLowerCase(Locale.ROOT);
        if (intent.compare() != null) {
          if (range != null && range.allData()) violations.add("compare 需要有界的 time 区间，不能与 kind=all 同用");
          compareRange = resolveTime(intent.compare(), anchoredAt, zone, violations, "compare");
          if (compareRange != null && compareRange.allData()) violations.add("compare 必须是有界区间");
        }
      }
    }

    if (intent.limit() != null && (intent.limit() < 1 || intent.limit() > MAX_TOP_N)) {
      violations.add("limit 取值 1-" + MAX_TOP_N);
    }
    List<List<String>> order = new ArrayList<>();
    for (QueryIntent.Order item : intent.order()) {
      String member = orderMember(root, item, measureMembers, dimensionMembers, timeMember, granularity, violations);
      if (member != null) {
        order.add(List.of(member, item.direction() == QueryIntent.Direction.ASC ? "asc" : "desc"));
      }
    }
    if (!violations.isEmpty()) return Result.rejected(violations);

    query.put("measures", measureMembers);
    if (!dimensionMembers.isEmpty()) query.put("dimensions", dimensionMembers);
    if (!filters.isEmpty()) query.put("filters", filters);
    Map<String, Object> timeDimension = new LinkedHashMap<>();
    timeDimension.put("dimension", timeMember);
    if (compareRange != null) {
      timeDimension.put("compareDateRange", List.of(dateRange(range), dateRange(compareRange)));
    } else if (!range.allData()) {
      timeDimension.put("dateRange", dateRange(range));
    }
    if (granularity != null) {
      timeDimension.put("granularity", granularity);
      columns.add(new CompiledSemanticQuery.Column(timeMember + "." + granularity, TIME_ORDER_MEMBER,
          timeProperty.property().label(), CompiledSemanticQuery.ColumnKind.TIME, OntologyProperty.Type.TIME));
    }
    if (compareRange != null || !range.allData() || granularity != null) {
      query.put("timeDimensions", List.of(timeDimension));
    }
    if (!order.isEmpty()) query.put("order", order);
    query.put("limit", intent.limit() == null ? ROW_CAP : intent.limit());
    query.put("timezone", zone.getId());
    columns.addAll(measureColumns);
    CompiledSemanticQuery.CoverageProbe coverage = new CompiledSemanticQuery.CoverageProbe(
        timeProperty.owner().cubeName() + "." + OntologyObjectType.coverageFrom(timeProperty.property().key()),
        timeProperty.owner().cubeName() + "." + OntologyObjectType.coverageTo(timeProperty.property().key()));
    return new Result(new CompiledSemanticQuery(intent, root.key(), Map.copyOf(query), range, compareRange, timeMember,
        timeProperty.property().label(), granularity, List.copyOf(columns), List.copyOf(productKeys), coverage, zone),
        List.of());
  }

  private SemanticModel.ResolvedMember resolve(
      OntologyObjectType root, String path, List<String> violations, String field) {
    try {
      return model.resolve(root.key(), path);
    } catch (BackendException error) {
      violations.add(field + " 中的成员路径无效：" + path + "（可用属性与关系见目录）");
      return null;
    }
  }

  private Map<String, Object> filter(
      OntologyObjectType root, Filter filter, List<String> violations, Set<String> productKeys) {
    if (filter == null || filter.member() == null || filter.operator() == null) {
      violations.add("filters 每项需要 member 与 operator");
      return null;
    }
    String member;
    OntologyProperty.Type type;
    OntologyMetric metric = root.findMetric(filter.member()).orElse(null);
    if (metric != null) {
      member = root.cubeName() + "." + metric.key();
      type = OntologyProperty.Type.NUMBER;
    } else {
      SemanticModel.ResolvedMember resolved = resolve(root, filter.member(), violations, "filters");
      if (resolved == null) return null;
      if (resolved.property().type() == OntologyProperty.Type.TIME) {
        violations.add("filters 不能过滤时间属性 " + filter.member() + "，请使用 time");
        return null;
      }
      collectProducts(resolved.owner(), productKeys);
      member = resolved.cubeMember();
      type = resolved.property().type();
    }
    Operator operator = filter.operator();
    boolean noValues = operator == Operator.SET || operator == Operator.NOT_SET;
    if (noValues != filter.values().isEmpty()) {
      violations.add("filters." + filter.member() + "：" + (noValues ? "set/notSet 不接受 values" : "需要至少一个 value"));
      return null;
    }
    if (filter.values().size() > MAX_FILTER_VALUES || filter.values().stream().anyMatch(v -> v == null || v.isBlank())) {
      violations.add("filters." + filter.member() + "：values 最多 " + MAX_FILTER_VALUES + " 个且不能为空串");
      return null;
    }
    boolean comparison = operator == Operator.GT || operator == Operator.GTE || operator == Operator.LT || operator == Operator.LTE;
    if (comparison && type != OntologyProperty.Type.NUMBER) {
      violations.add("filters." + filter.member() + "：大小比较只适用于数值成员");
      return null;
    }
    if (operator == Operator.CONTAINS && type != OntologyProperty.Type.STRING) {
      violations.add("filters." + filter.member() + "：contains 只适用于文本成员");
      return null;
    }
    if (type == OntologyProperty.Type.NUMBER && !noValues) {
      for (String value : filter.values()) {
        try {
          Double.parseDouble(value);
        } catch (NumberFormatException error) {
          violations.add("filters." + filter.member() + "：数值成员的 value 必须是数字：" + value);
          return null;
        }
      }
    }
    if (type == OntologyProperty.Type.BOOLEAN && !noValues
        && filter.values().stream().anyMatch(v -> !v.equals("true") && !v.equals("false"))) {
      violations.add("filters." + filter.member() + "：布尔成员的 value 只能是 true/false");
      return null;
    }
    Map<String, Object> compiled = new LinkedHashMap<>();
    compiled.put("member", member);
    compiled.put("operator", cubeOperator(operator));
    if (!noValues) compiled.put("values", filter.values());
    return Map.copyOf(compiled);
  }

  private static String cubeOperator(Operator operator) {
    return switch (operator) {
      case EQUALS -> "equals";
      case NOT_EQUALS -> "notEquals";
      case CONTAINS -> "contains";
      case GT -> "gt";
      case GTE -> "gte";
      case LT -> "lt";
      case LTE -> "lte";
      case SET -> "set";
      case NOT_SET -> "notSet";
    };
  }

  private String orderMember(
      OntologyObjectType root, QueryIntent.Order item, List<String> measures, List<String> dimensions,
      String timeMember, String granularity, List<String> violations) {
    if (item == null || item.member() == null || item.direction() == null) {
      violations.add("order 每项需要 member 与 direction");
      return null;
    }
    if (TIME_ORDER_MEMBER.equals(item.member())) {
      if (timeMember == null || granularity == null) {
        violations.add("order 使用 time 时必须设置 time.granularity");
        return null;
      }
      return timeMember;
    }
    String metricMember = root.findMetric(item.member()).map(metric -> root.cubeName() + "." + metric.key()).orElse(null);
    if (metricMember != null && measures.contains(metricMember)) return metricMember;
    try {
      String dimension = model.resolve(root.key(), item.member()).cubeMember();
      if (dimensions.contains(dimension)) return dimension;
    } catch (BackendException ignored) {
      // 统一在下方给出可纠正的违规说明
    }
    violations.add("order 只能引用已选 measures、dimensions 或 time：" + item.member());
    return null;
  }

  private static ResolvedTimeRange resolveTime(
      TimeExpression expression, Instant anchoredAt, ZoneId zone, List<String> violations, String field) {
    if (expression.kind() == TimeExpression.Kind.AMBIGUOUS) {
      violations.add(field + " 为 ambiguous，需先向用户澄清，不能直接执行");
      return null;
    }
    return TimeExpressionResolver.resolve(expression, anchoredAt, zone);
  }

  private static List<String> dateRange(ResolvedTimeRange range) {
    return List.of(range.from().toString(), range.to().toString());
  }

  private void collectProducts(OntologyObjectType object, Set<String> productKeys) {
    if (!productKeys.add(object.productKey()) && object.requiredLinks().isEmpty()) return;
    for (String link : object.requiredLinks()) {
      OntologyObjectType target = model.require(object.requireLink(link).targetObjectKey());
      if (!productKeys.contains(target.productKey())) collectProducts(target, productKeys);
    }
  }

  /** 编译结果：query 与 violations 二选一；violations 为面向模型纠正的逐项说明。 */
  public record Result(CompiledSemanticQuery query, List<String> violations) {
    public Result {
      violations = List.copyOf(violations);
    }

    static Result rejected(List<String> violations) {
      return new Result(null, violations);
    }

    public boolean accepted() {
      return query != null;
    }

    public CompiledSemanticQuery require() {
      if (query == null) {
        throw new BackendException("QUERY_INTENT_INVALID", "查询意图无效：" + String.join("；", violations) + "。");
      }
      return query;
    }
  }
}
