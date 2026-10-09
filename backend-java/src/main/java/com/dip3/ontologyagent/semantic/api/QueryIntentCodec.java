package com.dip3.ontologyagent.semantic.api;

import com.dip3.ontologyagent.semantic.api.QueryIntent.Direction;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Filter;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Granularity;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Operator;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Order;
import com.dip3.ontologyagent.semantic.api.QueryIntent.TimeSpec;
import com.dip3.ontologyagent.semantic.api.TimeExpression.Kind;
import com.dip3.ontologyagent.semantic.api.TimeExpression.Unit;
import com.dip3.ontologyagent.support.BackendException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 查询意图的 JSON 契约：模型输出（camelCase 键、小写枚举）与 {@link QueryIntent} 互转，
 * 并为提示词输出领域本体目录。解析失败汇总全部违规，供模型单轮纠正。
 */
public final class QueryIntentCodec {

  private QueryIntentCodec() {}

  /** 解析结果：intent 与 violations 二者择一。 */
  public record Parsed(QueryIntent intent, List<String> violations) {
    public Parsed {
      violations = List.copyOf(violations);
    }

    public boolean accepted() {
      return intent != null && violations.isEmpty();
    }
  }

  public static Parsed read(Object raw) {
    List<String> violations = new ArrayList<>();
    if (!(raw instanceof Map<?, ?> map)) {
      return new Parsed(null, List.of("查询意图必须是 JSON 对象"));
    }
    String objectKey = text(map.get("object"), "object", violations, true);
    List<String> measures = strings(map.get("measures"), "measures", violations);
    List<String> dimensions = strings(map.get("dimensions"), "dimensions", violations);
    List<Filter> filters = new ArrayList<>();
    for (Object item : list(map.get("filters"), "filters", violations)) {
      if (!(item instanceof Map<?, ?> filter)) {
        violations.add("filters 的元素必须是对象");
        continue;
      }
      String member = text(filter.get("member"), "filters.member", violations, true);
      Operator operator = enumValue(Operator.class, filter.get("operator"), "filters.operator", violations, true);
      List<String> values = new ArrayList<>();
      for (Object value : list(filter.get("values"), "filters.values", violations)) {
        if (value instanceof String || value instanceof Number || value instanceof Boolean) {
          values.add(String.valueOf(value));
        } else {
          violations.add("filters.values 只能包含字符串、数字或布尔值");
        }
      }
      filters.add(new Filter(member, operator, values));
    }
    TimeSpec time = null;
    if (!(map.get("time") instanceof Map<?, ?> timeMap)) {
      violations.add("time 必填；用户未指定时间时 expression.kind=all");
    } else {
      if (timeMap.containsKey("compare")) {
        violations.add("compare 必须与 time 同级，不能写在 time.compare；请将对比时间表达式写入查询意图的 compare");
      }
      timeMap.keySet().stream().filter(key -> !Set.of("dimension", "expression", "granularity", "compare").contains(key))
          .forEach(key -> violations.add("time 不接受字段：" + key));
      if (timeMap.get("expression") == null && timeMap.get("kind") != null) {
        violations.add("time 下缺少 expression：sourceText/kind/unit/n/offset/from/to 必须嵌套写在 time.expression 中，"
            + "不能直接写在 time 下；收到 time=" + timeMap);
      }
      TimeExpression expression = expression(timeMap.get("expression"), "time.expression", violations);
      String dimension = text(timeMap.get("dimension"), "time.dimension", violations, false);
      Granularity granularity =
          enumValue(Granularity.class, timeMap.get("granularity"), "time.granularity", violations, false);
      time = new TimeSpec(dimension, expression, granularity);
    }
    TimeExpression compare =
        map.get("compare") == null ? null : expression(map.get("compare"), "compare", violations);
    List<Order> order = new ArrayList<>();
    for (Object item : list(map.get("order"), "order", violations)) {
      if (!(item instanceof Map<?, ?> entry)) {
        violations.add("order 的元素必须是对象");
        continue;
      }
      order.add(new Order(text(entry.get("member"), "order.member", violations, true),
          enumValue(Direction.class, entry.get("direction"), "order.direction", violations, true)));
    }
    Integer limit = null;
    if (map.get("limit") instanceof Number number) {
      limit = number.intValue();
    } else if (map.get("limit") != null) {
      violations.add("limit 必须是整数");
    }
    if (!violations.isEmpty()) {
      return new Parsed(null, violations);
    }
    return new Parsed(new QueryIntent(objectKey, measures, dimensions, filters, time, compare, order, limit),
        List.of());
  }

  public static Map<String, Object> write(QueryIntent intent) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("object", intent.objectKey());
    out.put("measures", intent.measures());
    out.put("dimensions", intent.dimensions());
    out.put("filters", intent.filters().stream().map(filter -> Map.of(
        "member", filter.member(), "operator", lower(filter.operator()), "values", filter.values())).toList());
    Map<String, Object> time = new LinkedHashMap<>();
    if (intent.time().dimension() != null) time.put("dimension", intent.time().dimension());
    time.put("expression", write(intent.time().expression()));
    if (intent.time().granularity() != null) time.put("granularity", lower(intent.time().granularity()));
    out.put("time", time);
    if (intent.compare() != null) out.put("compare", write(intent.compare()));
    out.put("order", intent.order().stream().map(order -> Map.of(
        "member", order.member(), "direction", lower(order.direction()))).toList());
    if (intent.limit() != null) out.put("limit", intent.limit());
    return out;
  }

  public static Map<String, Object> write(TimeExpression expression) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("sourceText", expression.sourceText());
    out.put("kind", lower(expression.kind()));
    if (expression.unit() != null) out.put("unit", lower(expression.unit()));
    if (expression.n() != null) out.put("n", expression.n());
    if (expression.offset() != null) out.put("offset", expression.offset());
    if (expression.from() != null) out.put("from", expression.from().toString());
    if (expression.to() != null) out.put("to", expression.to().toString());
    if (expression.candidates() != null) {
      out.put("candidates", expression.candidates().stream().map(QueryIntentCodec::write).toList());
    }
    return out;
  }

  /** 提示词用领域本体目录：对象、属性、关系、指标与默认时间属性，不含任何 SQL 或 Cube 名称。 */
  public static List<Map<String, Object>> catalog(SemanticModel model, String domainKey) {
    return model.objects(domainKey).stream().map(object -> {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("object", object.key());
      out.put("label", object.label());
      out.put("description", object.description());
      out.put("defaultTime", object.defaultTimeProperty());
      out.put("properties", object.properties().stream().map(property -> {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("key", property.key());
        item.put("label", property.label());
        item.put("type", lower(property.type()));
        item.put("identifier", property.identifier());
        if (property.description() != null) item.put("description", property.description());
        return item;
      }).toList());
      out.put("links", object.links().stream().map(link -> Map.of(
          "key", link.key(), "target", link.targetObjectKey(), "cardinality", lower(link.cardinality()))).toList());
      out.put("metrics", object.metrics().stream().map(metric -> {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("key", metric.key());
        item.put("label", metric.label());
        if (metric.description() != null) item.put("description", metric.description());
        return item;
      }).toList());
      return out;
    }).toList();
  }

  private static TimeExpression expression(Object raw, String field, List<String> violations) {
    if (!(raw instanceof Map<?, ?> map)) {
      violations.add(field + " 必须是时间表达式对象（如 {\"sourceText\":\"上个月\",\"kind\":\"calendar\",\"unit\":\"month\","
          + "\"offset\":-1}），收到 " + (raw == null ? "null" : raw));
      return null;
    }
    List<String> local = new ArrayList<>();
    String sourceText = text(map.get("sourceText"), field + ".sourceText", local, true);
    Kind kind = enumValue(Kind.class, map.get("kind"), field + ".kind", local, true);
    Unit unit = enumValue(Unit.class, map.get("unit"), field + ".unit", local, false);
    Integer n = integer(map.get("n"), field + ".n", local);
    Integer offset = integer(map.get("offset"), field + ".offset", local);
    LocalDate from = date(map.get("from"), field + ".from", local);
    LocalDate to = date(map.get("to"), field + ".to", local);
    List<TimeExpression> candidates = null;
    if (map.get("candidates") != null) {
      candidates = new ArrayList<>();
      for (Object candidate : list(map.get("candidates"), field + ".candidates", local)) {
        TimeExpression parsed = expression(candidate, field + ".candidates", local);
        if (parsed != null) candidates.add(parsed);
      }
    }
    if (!local.isEmpty()) {
      violations.addAll(local);
      return null;
    }
    try {
      return new TimeExpression(sourceText, kind, unit, n, offset, from, to, candidates);
    } catch (BackendException error) {
      violations.add(field + "：" + error.getMessage());
      return null;
    }
  }

  private static String text(Object raw, String field, List<String> violations, boolean required) {
    if (raw == null) {
      if (required) violations.add(field + " 必填");
      return null;
    }
    if (!(raw instanceof String value) || value.isBlank()) {
      violations.add(field + " 必须是非空字符串");
      return null;
    }
    return value.trim();
  }

  private static List<?> list(Object raw, String field, List<String> violations) {
    if (raw == null) return List.of();
    if (raw instanceof List<?> items) return items;
    violations.add(field + " 必须是数组");
    return List.of();
  }

  private static List<String> strings(Object raw, String field, List<String> violations) {
    List<String> out = new ArrayList<>();
    for (Object item : list(raw, field, violations)) {
      if (item instanceof String value && !value.isBlank()) {
        out.add(value.trim());
      } else {
        violations.add(field + " 只能包含非空字符串");
      }
    }
    return out;
  }

  private static Integer integer(Object raw, String field, List<String> violations) {
    if (raw == null) return null;
    if (raw instanceof Number number && number.doubleValue() == Math.rint(number.doubleValue())) {
      return number.intValue();
    }
    violations.add(field + " 必须是整数");
    return null;
  }

  private static LocalDate date(Object raw, String field, List<String> violations) {
    if (raw == null) return null;
    try {
      return LocalDate.parse(String.valueOf(raw));
    } catch (DateTimeParseException error) {
      violations.add(field + " 必须是 yyyy-MM-dd 日期");
      return null;
    }
  }

  private static <E extends Enum<E>> E enumValue(
      Class<E> type, Object raw, String field, List<String> violations, boolean required) {
    if (raw == null) {
      if (required) violations.add(field + " 必填");
      return null;
    }
    String value = String.valueOf(raw).trim().replace('-', '_').toUpperCase(Locale.ROOT);
    for (E constant : type.getEnumConstants()) {
      if (constant.name().equals(value)) return constant;
    }
    List<String> allowed = new ArrayList<>();
    for (E constant : type.getEnumConstants()) allowed.add(lower(constant));
    violations.add(field + " 只允许 " + String.join("/", allowed) + "，收到 " + raw);
    return null;
  }

  private static String lower(Enum<?> value) {
    return value.name().toLowerCase(Locale.ROOT).replace('_', '-');
  }
}
