package com.dip3.ontologyagent.semantic.api;

import java.util.List;

/**
 * 模型输出的受约束查询意图：以一个本体对象为根，measures 为根对象指标 key，
 * dimensions / filters / order 使用成员路径（{@code propertyKey} 或 {@code linkKey.propertyKey}）。
 * 时间只以 {@link TimeExpression} 描述，日期由 Java 确定性解析；意图本身不含任何 SQL 或 Cube 名称。
 *
 * @param time 必填；用户未指定时间时 expression.kind=ALL
 * @param compare 可选，对比区间（环比/同比），要求 time 为有界区间
 * @param limit 可选 Top N（1-1000）；未指定时按平台上限返回，达到上限视为截断失败
 */
public record QueryIntent(
    String objectKey,
    List<String> measures,
    List<String> dimensions,
    List<Filter> filters,
    TimeSpec time,
    TimeExpression compare,
    List<Order> order,
    Integer limit) {

  public QueryIntent {
    measures = measures == null ? List.of() : List.copyOf(measures);
    dimensions = dimensions == null ? List.of() : List.copyOf(dimensions);
    filters = filters == null ? List.of() : List.copyOf(filters);
    order = order == null ? List.of() : List.copyOf(order);
  }

  public enum Operator { EQUALS, NOT_EQUALS, CONTAINS, GT, GTE, LT, LTE, SET, NOT_SET }

  public enum Granularity { DAY, WEEK, MONTH, QUARTER, YEAR }

  public enum Direction { ASC, DESC }

  /** member 为属性路径或根对象指标 key（指标过滤即 HAVING）。 */
  public record Filter(String member, Operator operator, List<String> values) {
    public Filter {
      values = values == null ? List.of() : List.copyOf(values);
    }
  }

  /** dimension 为空时使用根对象默认时间属性；granularity 为空表示不分桶。 */
  public record TimeSpec(String dimension, TimeExpression expression, Granularity granularity) {}

  /** member 为已选指标、维度路径，或 {@code time} 表示时间分桶。 */
  public record Order(String member, Direction direction) {}
}
