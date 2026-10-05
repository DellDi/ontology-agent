package com.dip3.ontologyagent.semantic.internal.adapter.out.postgres;

import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.BackendException;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/** 直接读取 canonical facts；所有 SQL 标识/表达式取自编译期本体，用户值只用绑定参数。 */
@Repository
public class PostgresObjectQueryAdapter implements ObjectQueryPort {
  private final NamedParameterJdbcTemplate jdbc;
  private final SemanticModel model;

  public PostgresObjectQueryAdapter(JdbcTemplate jdbc, SemanticModel model) {
    this.jdbc = new NamedParameterJdbcTemplate(jdbc);
    this.model = model;
  }

  @Override
  public Page query(Query query, SemanticQueryPort.AccessContext access) {
    return query(query, access, null);
  }

  private Page query(Query query, SemanticQueryPort.AccessContext access, QueryIntent.Filter relationFilter) {
    if (query == null || query.limit() < 1 || query.limit() > 200 || query.offset() < 0
        || query.offset() > 10000 || query.filters().size() > 10 || query.order().size() > 4) {
      throw invalid("分页要求 limit=1..200、offset=0..10000，filters 最多 10 项、order 最多 4 项。");
    }
    OntologyObjectType root = model.require(query.objectKey());
    Plan plan = new Plan(access);
    List<String> where = new ArrayList<>();
    where.add(plan.membership(root, "o", new HashSet<>()));
    where.add(plan.scope(root, "o"));
    for (QueryIntent.Filter filter : query.filters()) where.add(plan.filter(root, filter));
    if (relationFilter != null) where.add(plan.filter(root, relationFilter));
    List<String> order = new ArrayList<>();
    for (QueryIntent.Order item : query.order()) {
      if (item == null || item.direction() == null) throw invalid("排序方向不能为空。");
      order.add(expression(root.requireProperty(item.member()), "o") + " " + item.direction().name());
    }
    // 主键是最后的确定性排序键；冻结事实不会在翻页期间改变。
    order.add(expression(root.primaryKey(), "o") + " ASC");
    String columns = String.join(",", root.properties().stream().map(property ->
        expression(property, "o") + " AS \"" + property.key() + "\"").toList());
    String sql = "SELECT " + columns + " FROM " + root.table() + " o WHERE "
        + String.join(" AND ", where) + " ORDER BY " + String.join(",", order)
        + " LIMIT " + plan.parameter(query.limit() + 1) + " OFFSET " + plan.parameter(query.offset());
    List<Row> rows = jdbc.query(sql, plan.parameters, (result, index) -> {
      Map<String, Object> values = new LinkedHashMap<>();
      for (OntologyProperty property : root.properties()) {
        Object value = result.getObject(property.key());
        if (value instanceof Timestamp time) value = time.toInstant().toString();
        values.put(property.key(), value);
      }
      return new Row(new Reference(root.key(), String.valueOf(values.get(root.primaryKey().key())),
          plan.version(root)), values);
    });
    boolean more = rows.size() > query.limit();
    return new Page(root.key(), more ? rows.subList(0, query.limit()) : rows,
        query.limit(), query.offset(), more);
  }

  @Override
  public Row require(String objectKey, String objectId, SemanticQueryPort.AccessContext access) {
    if (objectId == null || objectId.isBlank() || objectId.length() > 500) throw invalid("对象 ID 无效。");
    OntologyObjectType object = model.require(objectKey);
    Page page = query(new Query(objectKey, List.of(new QueryIntent.Filter(object.primaryKey().key(),
        QueryIntent.Operator.EQUALS, List.of(objectId))), List.of(), 2, 0), access);
    if (page.rows().isEmpty()) throw new BackendException("OBJECT_NOT_FOUND", "对象不存在或不在授权范围内。");
    if (page.rows().size() != 1) throw new BackendException("OBJECT_IDENTITY_VIOLATION", "冻结数据中的对象主键不唯一。");
    return page.rows().getFirst();
  }

  @Override
  public Page related(String objectKey, String objectId, String linkKey, Query query,
                      SemanticQueryPort.AccessContext access) {
    OntologyObjectType object = model.require(objectKey);
    OntologyLink link = object.requireLink(linkKey);
    if (query == null || !link.targetObjectKey().equals(query.objectKey())) {
      throw invalid("关系目标必须与本体声明一致。");
    }
    Row source = require(objectKey, objectId, access);
    Object value = source.properties().get(link.sourceProperty());
    if (value == null) return new Page(query.objectKey(), List.of(), query.limit(), query.offset(), false);
    return query(query, access, new QueryIntent.Filter(link.targetProperty(),
        QueryIntent.Operator.EQUALS, List.of(value.toString())));
  }

  private final class Plan {
    private final SemanticQueryPort.AccessContext access;
    private final Map<String, Object> parameters = new LinkedHashMap<>();
    private int aliasIndex;
    Plan(SemanticQueryPort.AccessContext access) {
      if (access == null) throw invalid("缺少冻结版本与范围上下文。");
      this.access = access;
    }
    String parameter(Object value) {
      String key = "p" + parameters.size();
      parameters.put(key, value);
      return ":" + key;
    }
    String version(OntologyObjectType object) {
      String version = access.productVersions().get(object.productKey());
      if (version == null || version.isBlank()) throw new BackendException("DATASET_VERSION_SET_INCOMPLETE",
          "冻结集合缺少对象产品：" + object.productKey());
      return version;
    }
    String membership(OntologyObjectType object, String alias, Set<String> ancestors) {
      if (!ancestors.add(object.key())) throw new BackendException("OBJECT_MODEL_INVALID", "成员资格关系存在循环。");
      List<String> clauses = new ArrayList<>();
      clauses.add(alias + ".product_version_id=" + parameter(version(object)));
      if (object.baseFilter() != null) {
        // baseFilter 只引用本表列；在仅含此表的相关子查询内求值，避免外层列混淆。
        clauses.add("EXISTS (SELECT 1 FROM " + object.table() + " WHERE product_version_id="
            + alias + ".product_version_id AND " + expression(object.primaryKey(), object.table())
            + "=" + expression(object.primaryKey(), alias) + " AND (" + object.baseFilter() + "))");
      }
      for (String linkKey : object.requiredLinks()) {
        OntologyLink link = object.requireLink(linkKey);
        OntologyObjectType target = model.require(link.targetObjectKey());
        String targetAlias = "m" + ++aliasIndex;
        clauses.add("EXISTS (SELECT 1 FROM " + target.table() + " " + targetAlias + " WHERE "
            + expression(target.requireProperty(link.targetProperty()), targetAlias) + "="
            + expression(object.requireProperty(link.sourceProperty()), alias) + " AND "
            + membership(target, targetAlias, new HashSet<>(ancestors)) + ")");
      }
      return "(" + String.join(" AND ", clauses) + ")";
    }
    String scope(OntologyObjectType object, String alias) {
      if (access.scope().all()) return "TRUE";
      List<String> clauses = new ArrayList<>();
      access.scope().values().forEach((dimension, values) -> {
        String path = object.scopeBindings().get(dimension);
        if (path == null) throw new BackendException("OBJECT_SCOPE_FORBIDDEN", "对象未声明授权范围维度：" + dimension);
        String[] parts = path.split("\\.");
        if (values.isEmpty()) { clauses.add("FALSE"); return; }
        if (parts.length == 1) {
          clauses.add(expression(object.requireProperty(path), alias) + " IN (" + parameters(values) + ")");
        } else {
          OntologyLink link = object.requireLink(parts[0]);
          OntologyObjectType target = model.require(link.targetObjectKey());
          String targetAlias = "s" + ++aliasIndex;
          clauses.add("EXISTS (SELECT 1 FROM " + target.table() + " " + targetAlias + " WHERE "
              + expression(target.requireProperty(link.targetProperty()), targetAlias) + "="
              + expression(object.requireProperty(link.sourceProperty()), alias) + " AND "
              + membership(target, targetAlias, new HashSet<>()) + " AND "
              + expression(target.requireProperty(parts[1]), targetAlias) + " IN (" + parameters(values) + "))");
        }
      });
      return "(" + String.join(" AND ", clauses) + ")";
    }
    String parameters(List<String> values) { return String.join(",", values.stream().map(this::parameter).toList()); }
    String filter(OntologyObjectType root, QueryIntent.Filter filter) {
      if (filter == null || filter.operator() == null) throw invalid("过滤条件缺少成员或操作符。");
      OntologyProperty property = root.requireProperty(filter.member());
      String sql = expression(property, "o");
      var operator = filter.operator();
      boolean noValues = operator == QueryIntent.Operator.SET || operator == QueryIntent.Operator.NOT_SET;
      if (noValues) {
        if (!filter.values().isEmpty()) throw invalid("set/notSet 不接受 values。");
        return sql + (operator == QueryIntent.Operator.SET ? " IS NOT NULL" : " IS NULL");
      }
      if (filter.values().isEmpty() || filter.values().size() > 100) throw invalid("过滤值需要 1..100 项。");
      List<String> values = filter.values().stream().map(value -> parameter(convert(property.type(), value))).toList();
      if (operator == QueryIntent.Operator.EQUALS || operator == QueryIntent.Operator.NOT_EQUALS) {
        return sql + (operator == QueryIntent.Operator.EQUALS ? " IN (" : " NOT IN (") + String.join(",", values) + ")";
      }
      if (values.size() != 1) throw invalid("contains/大小比较需要一个值。");
      if (operator == QueryIntent.Operator.CONTAINS) {
        if (property.type() != OntologyProperty.Type.STRING) throw invalid("contains 只适用于文本属性。");
        return "position(" + values.getFirst() + " in " + sql + ") > 0";
      }
      if (property.type() != OntologyProperty.Type.NUMBER && property.type() != OntologyProperty.Type.TIME) {
        throw invalid("大小比较只适用于数值或时间属性。");
      }
      String comparison = switch (operator) { case GT -> ">"; case GTE -> ">="; case LT -> "<"; case LTE -> "<=";
        default -> throw invalid("不支持的过滤操作。"); };
      return sql + comparison + values.getFirst();
    }
  }

  private static Object convert(OntologyProperty.Type type, String value) {
    if (value == null || value.isBlank() || value.length() > 500) throw invalid("过滤值为空或过长。");
    try {
      return switch (type) {
        case STRING -> value;
        case NUMBER -> new BigDecimal(value);
        case BOOLEAN -> {
          if (!value.equals("true") && !value.equals("false")) throw invalid("布尔值必须为 true/false。");
          yield Boolean.valueOf(value);
        }
        case TIME -> OffsetDateTime.parse(value);
      };
    } catch (NumberFormatException | java.time.format.DateTimeParseException error) {
      throw invalid("过滤值不符合属性类型 " + type + "。");
    }
  }
  private static String expression(OntologyProperty property, String alias) { return property.sql().replace("{CUBE}", alias); }
  private static BackendException invalid(String message) { return new BackendException("OBJECT_QUERY_INVALID", message); }
}
