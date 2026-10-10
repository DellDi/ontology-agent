package com.dip3.ontologyagent.semantic.api;

import java.util.Map;

/**
 * 对象类型的属性。sql 是以 {@code {CUBE}} 指代本对象的 SQL 表达式，只由领域包在编译期声明。
 */
public record OntologyProperty(
    String key, String label, String description, Type type, String sql, boolean primaryKey, boolean identifier, boolean detailOnly,
    boolean title, boolean prominent, Map<String, String> valueLabels) {

  public enum Type { STRING, NUMBER, BOOLEAN, TIME }

  public OntologyProperty {
    SemanticNames.requireMember(key, "属性");
    SemanticNames.requireText(label, "属性 " + key + " 的 label");
    SemanticNames.requireText(sql, "属性 " + key + " 的 sql");
    if (detailOnly && (primaryKey || identifier || type != Type.STRING)) throw SemanticNames.invalid("详情文本不能作为标识或非文本属性");
    if (type == null) throw SemanticNames.invalid("属性 " + key + " 缺少 type");
    valueLabels = valueLabels == null ? Map.of() : Map.copyOf(valueLabels);
    valueLabels.forEach((value, display) -> {
      SemanticNames.requireText(value, "属性 " + key + " 的值");
      SemanticNames.requireText(display, "属性 " + key + " 的值标签");
    });
  }

  public OntologyProperty(String key, String label, String description, Type type, String sql,
      boolean primaryKey, boolean identifier, boolean detailOnly) {
    this(key, label, description, type, sql, primaryKey, identifier, detailOnly, false, false, Map.of());
  }

  /** 展示语义由属性所属领域声明，不改变原始值、查询或授权。 */
  public OntologyProperty display(boolean title, boolean prominent, Map<String, String> valueLabels) {
    return new OntologyProperty(key, label, description, type, sql, primaryKey, identifier, detailOnly,
        title, prominent, valueLabels);
  }

  public OntologyProperty(String key, String label, String description, Type type, String sql,
      boolean primaryKey, boolean identifier) {
    this(key, label, description, type, sql, primaryKey, identifier, false);
  }

  /** 原文只允许单对象详情读取，不进入 Cube、列表、筛选或排序。 */
  public static OntologyProperty detailText(String key, String label, String description, String sql) {
    return new OntologyProperty(key, label, description, Type.STRING, sql, false, false, true);
  }

  public OntologyProperty(String key, String label, String description, Type type, String sql, boolean primaryKey) {
    this(key, label, description, type, sql, primaryKey, primaryKey);
  }

  /** 不作为主键的身份/结构签名；用于展示语义，不改变查询、聚合或授权。 */
  public static OntologyProperty identifier(String key, String label, String description, String column) {
    return new OntologyProperty(key, label, description, Type.STRING, "{CUBE}." + column, false, true);
  }

  public static OntologyProperty column(String key, String label, String description, Type type, String column) {
    return new OntologyProperty(key, label, description, type, "{CUBE}." + column, false);
  }

  public static OntologyProperty key(String key, String label, String column) {
    return new OntologyProperty(key, label, null, Type.STRING, "{CUBE}." + column, true);
  }
}
