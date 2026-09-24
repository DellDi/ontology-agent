package com.dip3.ontologyagent.semantic.api;

/**
 * 对象上的指标口径。expression/filter 为以 {@code {CUBE}} 指代本对象的 SQL 片段；
 * COUNT 可省略 expression，其余聚合必须声明。
 */
public record OntologyMetric(
    String key, String label, String description, Aggregation aggregation, String expression, String filter) {

  public enum Aggregation { COUNT, COUNT_DISTINCT, SUM, AVG, MIN, MAX, PERCENTILE_50, PERCENTILE_95 }

  public OntologyMetric {
    SemanticNames.requireMember(key, "指标");
    SemanticNames.requireText(label, "指标 " + key + " 的 label");
    if (aggregation == null) throw SemanticNames.invalid("指标 " + key + " 缺少 aggregation");
    if (aggregation != Aggregation.COUNT) SemanticNames.requireText(expression, "指标 " + key + " 的 expression");
    if (filter != null) SemanticNames.requireText(filter, "指标 " + key + " 的 filter");
  }
}
