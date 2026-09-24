package com.dip3.ontologyagent.semantic.api;

import com.dip3.ontologyagent.support.BackendException;
import java.time.LocalDate;
import java.util.List;

/**
 * 模型输出的结构化时间语义：只描述“用户说的是哪段时间”，不做日期运算。
 * 日期由 {@link TimeExpressionResolver} 以执行锚点与业务时区确定性解析。
 *
 * <ul>
 *   <li>RELATIVE：最近 n 个 unit，含锚点当天</li>
 *   <li>CALENDAR：锚点所在自然周期偏移 offset（0=本期截至锚点，-1=上期完整区间）</li>
 *   <li>TO_DATE：本期起点至锚点（本周/本月/本季度/今年以来）</li>
 *   <li>ABSOLUTE：显式起止日期（节假日、“9月上旬”等兜底），依据保留在 sourceText</li>
 *   <li>ALL：用户未指定时间，显式按全部数据</li>
 *   <li>AMBIGUOUS：无法确定，交给用户在 candidates 中澄清</li>
 * </ul>
 */
public record TimeExpression(
    String sourceText,
    Kind kind,
    Unit unit,
    Integer n,
    Integer offset,
    LocalDate from,
    LocalDate to,
    List<TimeExpression> candidates) {

  public enum Kind { RELATIVE, CALENDAR, TO_DATE, ABSOLUTE, ALL, AMBIGUOUS }

  public enum Unit { DAY, WEEK, MONTH, QUARTER, YEAR }

  /** 单个表达式允许回溯的最大单位数；超出视为模型输出异常而非业务需求。 */
  public static final int MAX_UNITS = 1000;

  public TimeExpression {
    candidates = candidates == null ? null : List.copyOf(candidates);
    require(sourceText != null && !sourceText.isBlank(), "sourceText 必须保留用户原话");
    require(kind != null, "kind 必填");
    switch (kind) {
      case RELATIVE -> {
        require(unit != null && n != null && n >= 1 && n <= MAX_UNITS, "relative 需要 unit 与 1-" + MAX_UNITS + " 的 n");
        require(offset == null && from == null && to == null && candidates == null, "relative 只允许 unit 与 n");
      }
      case CALENDAR -> {
        require(unit != null && offset != null && offset <= 0 && offset >= -MAX_UNITS,
            "calendar 需要 unit 与 0 至 -" + MAX_UNITS + " 的 offset");
        require(n == null && from == null && to == null && candidates == null, "calendar 只允许 unit 与 offset");
      }
      case TO_DATE -> {
        require(unit != null && unit != Unit.DAY, "to-date 需要 week/month/quarter/year");
        require(n == null && offset == null && from == null && to == null && candidates == null,
            "to-date 只允许 unit");
      }
      case ABSOLUTE -> {
        require(from != null && to != null && !from.isAfter(to), "absolute 需要 from ≤ to");
        require(unit == null && n == null && offset == null && candidates == null, "absolute 只允许 from 与 to");
      }
      case ALL -> require(unit == null && n == null && offset == null && from == null && to == null
          && candidates == null, "all 不允许附加字段");
      case AMBIGUOUS -> {
        require(candidates != null && !candidates.isEmpty(), "ambiguous 需要至少一个候选");
        require(candidates.stream().noneMatch(item -> item.kind() == Kind.AMBIGUOUS), "候选不能再是 ambiguous");
        require(unit == null && n == null && offset == null && from == null && to == null,
            "ambiguous 只允许 candidates");
      }
    }
  }

  public TimeExpression withSourceText(String text) {
    return new TimeExpression(text, kind, unit, n, offset, from, to, candidates);
  }

  private static void require(boolean condition, String message) {
    if (!condition) {
      throw new BackendException("TIME_EXPRESSION_INVALID", "时间表达式无效：" + message + "。");
    }
  }
}
