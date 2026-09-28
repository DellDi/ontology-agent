package com.dip3.ontologyagent.semantic.api;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/**
 * 由本体声明生成 Cube 模型（YAML，按领域分目录）与访问策略索引。生成物入库，
 * 由漂移测试保证与声明一致；Cube 模型不手写。
 */
public final class CubeModelGenerator {
  /**
   * cube.js queryRewrite 读取：cubeName → {productKey, requiredMembers, scopeMembers}，
   * 用于强制注入冻结数据版本、成员资格关联与授权范围过滤。
   */
  public static final String ACCESS_POLICY_FILE = "semantic-access-policy.json";
  public static final String MODEL_DIR = "model";

  /** @return 相对 cube/conf 的路径 → 内容（按路径排序） */
  public static Map<String, String> generate(SemanticModel model) {
    Map<String, OntologyObjectType> byKey = new HashMap<>();
    model.objects().forEach(object -> byKey.put(object.key(), object));
    Map<String, String> files = new TreeMap<>();
    Map<String, OntologyObjectType> byCube = new TreeMap<>();
    for (OntologyObjectType object : model.objects()) {
      files.put(MODEL_DIR + "/" + model.domainKey(object.key()) + "/" + object.cubeName() + ".yml", yaml(object, byKey));
      byCube.put(object.cubeName(), object);
    }
    files.put(ACCESS_POLICY_FILE, accessPolicy(model, byCube));
    return files;
  }

  private static String accessPolicy(SemanticModel model, Map<String, OntologyObjectType> byCube) {
    StringBuilder json = new StringBuilder("{\n");
    int remaining = byCube.size();
    for (OntologyObjectType object : byCube.values()) {
      json.append("  ").append(quote(object.cubeName())).append(": {\n");
      json.append("    \"productKey\": ").append(quote(object.productKey())).append(",\n");
      json.append("    \"requiredMembers\": [");
      List<String> required = object.requiredLinks().stream()
          .map(link -> model.requiredLinkMember(object, link)).sorted().toList();
      for (int index = 0; index < required.size(); index += 1) {
        json.append(index == 0 ? "" : ", ").append(quote(required.get(index)));
      }
      json.append("],\n");
      json.append("    \"scopeMembers\": {");
      Map<String, String> scopes = new TreeMap<>();
      object.scopeBindings().forEach((dimension, path) ->
          scopes.put(dimension, model.resolve(object.key(), path).cubeMember()));
      int left = scopes.size();
      for (Map.Entry<String, String> entry : scopes.entrySet()) {
        json.append(left == scopes.size() ? "\n" : "").append("      ").append(quote(entry.getKey())).append(": ")
            .append(quote(entry.getValue())).append(--left > 0 ? ",\n" : "\n    ");
      }
      json.append("}\n  }").append(--remaining > 0 ? ",\n" : "\n");
    }
    return json.append("}\n").toString();
  }

  private static String yaml(OntologyObjectType object, Map<String, OntologyObjectType> byKey) {
    StringBuilder out = new StringBuilder("# 由本体声明生成（CubeModelGenerator），请勿手工修改。\ncubes:\n");
    out.append("  - name: ").append(quote(object.cubeName())).append('\n');
    line(out, 4, "title", object.label());
    if (object.description() != null) line(out, 4, "description", object.description());
    if (object.baseFilter() == null) {
      line(out, 4, "sql_table", object.table());
    } else {
      line(out, 4, "sql", "select * from " + object.table() + " where " + object.baseFilter());
    }
    out.append("    meta:\n");
    line(out, 6, "ontologyObject", object.key());
    line(out, 6, "productKey", object.productKey());
    if (!object.links().isEmpty()) {
      out.append("    joins:\n");
      for (OntologyLink link : object.links()) {
        OntologyObjectType target = byKey.get(link.targetObjectKey());
        if (target == null) {
          throw SemanticNames.invalid("对象 " + object.key() + " 的关系 " + link.key() + " 指向不存在的对象 "
              + link.targetObjectKey());
        }
        String source = object.requireProperty(link.sourceProperty()).sql();
        String targetSql = target.requireProperty(link.targetProperty()).sql()
            .replace("{CUBE}", "{" + target.cubeName() + "}");
        out.append("      - name: ").append(quote(target.cubeName())).append('\n');
        line(out, 8, "relationship", link.cardinality().name().toLowerCase(Locale.ROOT));
        line(out, 8, "sql", source + " = " + targetSql);
      }
    }
    out.append("    dimensions:\n");
    out.append("      - name: ").append(quote(OntologyObjectType.VERSION_MEMBER)).append('\n');
    line(out, 8, "sql", "{CUBE}.product_version_id");
    line(out, 8, "type", "string");
    out.append("        public: false\n");
    for (OntologyProperty property : object.properties()) {
      out.append("      - name: ").append(quote(property.key())).append('\n');
      line(out, 8, "title", property.label());
      if (property.description() != null) line(out, 8, "description", property.description());
      line(out, 8, "sql", property.sql());
      line(out, 8, "type", property.type().name().toLowerCase(Locale.ROOT));
      if (property.primaryKey()) out.append("        primary_key: true\n        public: true\n");
    }
    List<OntologyProperty> times = object.properties().stream()
        .filter(property -> property.type() == OntologyProperty.Type.TIME).toList();
    if (!object.metrics().isEmpty() || !times.isEmpty()) {
      out.append("    measures:\n");
      for (OntologyMetric metric : object.metrics()) {
        out.append("      - name: ").append(quote(metric.key())).append('\n');
        line(out, 8, "title", metric.label());
        if (metric.description() != null) line(out, 8, "description", metric.description());
        measure(out, metric);
      }
      for (OntologyProperty time : times) {
        coverage(out, OntologyObjectType.coverageFrom(time.key()), time.label() + "（最早）", "min", time.sql());
        coverage(out, OntologyObjectType.coverageTo(time.key()), time.label() + "（最晚）", "max", time.sql());
      }
    }
    return out.toString();
  }

  private static void coverage(StringBuilder out, String name, String title, String function, String sql) {
    out.append("      - name: ").append(quote(name)).append('\n');
    line(out, 8, "title", title);
    line(out, 8, "sql", "extract(epoch from " + function + "(" + sql + "))");
    line(out, 8, "type", "number");
    out.append("        meta:\n");
    line(out, 10, "coverage", "true");
  }

  private static void measure(StringBuilder out, OntologyMetric metric) {
    switch (metric.aggregation()) {
      case RATIO -> {
        List<String> operands = metric.ratioOperands();
        line(out, 8, "sql", "round(100.0 * {" + operands.get(0) + "} / nullif({" + operands.get(1) + "}, 0), 2)");
        line(out, 8, "type", "number");
      }
      case PERCENTILE_50, PERCENTILE_95 -> {
        String fraction = metric.aggregation() == OntologyMetric.Aggregation.PERCENTILE_50 ? "0.50" : "0.95";
        String filter = metric.filter() == null ? "" : " filter (where " + metric.filter() + ")";
        line(out, 8, "sql", "ceil(percentile_cont(" + fraction + ") within group (order by "
            + metric.expression() + ")" + filter + ")");
        line(out, 8, "type", "number");
      }
      default -> {
        if (metric.expression() != null) line(out, 8, "sql", metric.expression());
        line(out, 8, "type", metric.aggregation().name().toLowerCase(Locale.ROOT));
        if (metric.filter() != null) {
          out.append("        filters:\n");
          line(out, 10, "- sql", metric.filter());
        }
      }
    }
  }

  private static void line(StringBuilder out, int indent, String key, String value) {
    out.append(" ".repeat(indent)).append(key).append(": ").append(quote(value)).append('\n');
  }

  private static String quote(String value) {
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  private CubeModelGenerator() {}
}
