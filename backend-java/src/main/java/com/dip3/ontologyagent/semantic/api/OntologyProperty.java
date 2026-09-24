package com.dip3.ontologyagent.semantic.api;

/**
 * 对象类型的属性。sql 是以 {@code {CUBE}} 指代本对象的 SQL 表达式，只由领域包在编译期声明。
 */
public record OntologyProperty(
    String key, String label, String description, Type type, String sql, boolean primaryKey) {

  public enum Type { STRING, NUMBER, BOOLEAN, TIME }

  public OntologyProperty {
    SemanticNames.requireMember(key, "属性");
    SemanticNames.requireText(label, "属性 " + key + " 的 label");
    SemanticNames.requireText(sql, "属性 " + key + " 的 sql");
    if (type == null) throw SemanticNames.invalid("属性 " + key + " 缺少 type");
  }

  public static OntologyProperty column(String key, String label, String description, Type type, String column) {
    return new OntologyProperty(key, label, description, type, "{CUBE}." + column, false);
  }

  public static OntologyProperty key(String key, String label, String column) {
    return new OntologyProperty(key, label, null, Type.STRING, "{CUBE}." + column, true);
  }
}
