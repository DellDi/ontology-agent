package com.dip3.ontologyagent.semantic.api;

import com.dip3.ontologyagent.semantic.api.TimeExpression.Unit;
import com.dip3.ontologyagent.support.BackendException;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;

/** 以执行锚点与业务时区把 {@link TimeExpression} 确定性解析为闭区间日期。 */
public final class TimeExpressionResolver {

  public static ResolvedTimeRange resolve(TimeExpression expression, Instant anchoredAt, ZoneId zone) {
    if (expression == null || anchoredAt == null || zone == null) {
      throw new BackendException("TIME_EXPRESSION_INVALID", "时间解析缺少表达式、锚点或业务时区。");
    }
    LocalDate anchor = anchoredAt.atZone(zone).toLocalDate();
    String text = expression.sourceText();
    return switch (expression.kind()) {
      case RELATIVE -> new ResolvedTimeRange(
          minus(anchor, expression.unit(), expression.n()).plusDays(1), anchor, false, text);
      case CALENDAR -> {
        LocalDate start = minus(periodStart(anchor, expression.unit()), expression.unit(), -expression.offset());
        LocalDate end = expression.offset() == 0 ? anchor : minus(plus(start, expression.unit()), Unit.DAY, 1);
        yield new ResolvedTimeRange(start, end, false, text);
      }
      case TO_DATE -> new ResolvedTimeRange(periodStart(anchor, expression.unit()), anchor, false, text);
      case ABSOLUTE -> new ResolvedTimeRange(expression.from(), expression.to(), false, text);
      case ALL -> new ResolvedTimeRange(null, anchor, true, text);
      case AMBIGUOUS -> throw new BackendException("TIME_EXPRESSION_AMBIGUOUS",
          "时间表达“" + text + "”存在歧义，需要用户确认。");
    };
  }

  private static LocalDate periodStart(LocalDate anchor, Unit unit) {
    return switch (unit) {
      case DAY -> anchor;
      case WEEK -> anchor.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
      case MONTH -> anchor.withDayOfMonth(1);
      case QUARTER -> anchor.withMonth((anchor.getMonthValue() - 1) / 3 * 3 + 1).withDayOfMonth(1);
      case YEAR -> anchor.withDayOfYear(1);
    };
  }

  private static LocalDate minus(LocalDate date, Unit unit, long amount) {
    return switch (unit) {
      case DAY -> date.minusDays(amount);
      case WEEK -> date.minusWeeks(amount);
      case MONTH -> date.minusMonths(amount);
      case QUARTER -> date.minusMonths(amount * 3);
      case YEAR -> date.minusYears(amount);
    };
  }

  private static LocalDate plus(LocalDate date, Unit unit) {
    return minus(date, unit, -1);
  }

  private TimeExpressionResolver() {}
}
