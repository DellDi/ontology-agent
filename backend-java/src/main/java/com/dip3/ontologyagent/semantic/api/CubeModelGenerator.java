package com.dip3.ontologyagent.semantic.api;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/**
 * 由本体对象声明生成 Cube 模型（YAML）与版本强制索引。生成物入库，
 * 由领域包的漂移测试保证与声明一致；Cube 模型不手写。
 */
public final class CubeModelGenerator {
  /** cube.js queryRewrite 读取：cubeName → productKey。 */
  public static final String VERSIONED_INDEX_FILE = "versioned-cubes.json";

  /** @return 文件名 → 内容（按文件名排序） */
  public static Map<String, String> generate(List<OntologyObjectType> objects) {
    Map<String, OntologyObjectType> byKey = new HashMap<>();
    Map<String, String> index = new TreeMap<>();
    for (OntologyObjectType object : objects) {
      if (byKey.put(object.key(), object) != null || index.put(object.cubeName(), object.productKey()) != null) {
        throw SemanticNames.invalid("对象或 Cube 名称重复：" + object.key() + " / " + object.cubeName());
      }
    }
    Map<String, String> files = new TreeMap<>();
    for (OntologyObjectType object : objects) {
      files.put(object.cubeName() + ".yml", yaml(object, byKey));
    }
    StringBuilder json = new StringBuilder("{\n");
    int remaining = index.size();
    for (Map.Entry<String, String> entry : index.entrySet()) {
      json.append("  ").append(quote(entry.getKey())).append(": ").append(quote(entry.getValue()))
          .append(--remaining > 0 ? ",\n" : "\n");
    }
    files.put(VERSIONED_INDEX_FILE, json.append("}\n").toString());
    return files;
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
    if (!object.metrics().isEmpty()) {
      out.append("    measures:\n");
      for (OntologyMetric metric : object.metrics()) {
        out.append("      - name: ").append(quote(metric.key())).append('\n');
        line(out, 8, "title", metric.label());
        if (metric.description() != null) line(out, 8, "description", metric.description());
        measure(out, metric);
      }
    }
    return out.toString();
  }

  private static void measure(StringBuilder out, OntologyMetric metric) {
    switch (metric.aggregation()) {
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
