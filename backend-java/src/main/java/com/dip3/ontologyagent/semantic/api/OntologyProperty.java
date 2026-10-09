package com.dip3.ontologyagent.semantic.api;

/**
 * 对象类型的属性。sql 是以 {@code {CUBE}} 指代本对象的 SQL 表达式，只由领域包在编译期声明。
 */
public record OntologyProperty(
    String key, String label, String description, Type type, String sql, boolean primaryKey, boolean identifier) {

  public enum Type { STRING, NUMBER, BOOLEAN, TIME }

  public OntologyProperty {
    SemanticNames.requireMember(key, "属性");
    SemanticNames.requireText(label, "属性 " + key + " 的 label");
    SemanticNames.requireText(sql, "属性 " + key + " 的 sql");
    if (type == null) throw SemanticNames.invalid("属性 " + key + " 缺少 type");
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
