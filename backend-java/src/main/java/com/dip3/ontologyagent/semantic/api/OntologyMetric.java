package com.dip3.ontologyagent.semantic.api;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 对象上的指标口径。expression/filter 为以 {@code {CUBE}} 指代本对象的 SQL 片段；
 * COUNT 可省略 expression，其余聚合必须声明。RATIO 为同对象两个非比率指标之比（百分数，两位小数），
 * expression 固定为 {@code {分子指标}/{分母指标}}，分母为零时结果为空。
 */
public record OntologyMetric(
    String key, String label, String description, Aggregation aggregation, String expression, String filter) {

  public enum Aggregation { COUNT, COUNT_DISTINCT, SUM, AVG, MIN, MAX, PERCENTILE_50, PERCENTILE_95, RATIO }

  private static final Pattern RATIO = Pattern.compile("\\{([a-z][A-Za-z0-9]*)}/\\{([a-z][A-Za-z0-9]*)}");

  public OntologyMetric {
    SemanticNames.requireMember(key, "指标");
    SemanticNames.requireText(label, "指标 " + key + " 的 label");
    if (aggregation == null) throw SemanticNames.invalid("指标 " + key + " 缺少 aggregation");
    if (aggregation != Aggregation.COUNT) SemanticNames.requireText(expression, "指标 " + key + " 的 expression");
    if (filter != null) SemanticNames.requireText(filter, "指标 " + key + " 的 filter");
    if (aggregation == Aggregation.RATIO) {
      if (!RATIO.matcher(expression).matches()) {
        throw SemanticNames.invalid("比率指标 " + key + " 的 expression 必须为 {分子指标}/{分母指标}");
      }
      if (filter != null) throw SemanticNames.invalid("比率指标 " + key + " 不能声明 filter");
    }
  }

  public static OntologyMetric ratio(
      String key, String label, String description, String numeratorKey, String denominatorKey) {
    return new OntologyMetric(key, label, description, Aggregation.RATIO,
        "{" + numeratorKey + "}/{" + denominatorKey + "}", null);
  }

  /** RATIO 的 [分子, 分母] 指标 key。 */
  public List<String> ratioOperands() {
    if (aggregation != Aggregation.RATIO) throw SemanticNames.invalid("指标 " + key + " 不是比率指标");
    Matcher matcher = RATIO.matcher(expression);
    if (!matcher.matches()) throw SemanticNames.invalid("比率指标 " + key + " 的 expression 无效");
    return List.of(matcher.group(1), matcher.group(2));
  }
}
