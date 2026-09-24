package com.dip3.ontologyagent.semantic.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.semantic.api.TimeExpression.Kind;
import com.dip3.ontologyagent.semantic.api.TimeExpression.Unit;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

class TimeExpressionResolverTest {
  private static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");
  /** 2026-09-24（周四）上海时间 10:00。 */
  private static final Instant ANCHOR = Instant.parse("2026-09-24T02:00:00Z");

  static Stream<Arguments> expressions() {
    return Stream.of(
        row("最近30天", relative(Unit.DAY, 30), "2026-08-26", "2026-09-24"),
        row("近7天", relative(Unit.DAY, 7), "2026-09-18", "2026-09-24"),
        row("今天", relative(Unit.DAY, 1), "2026-09-24", "2026-09-24"),
        row("昨天", calendar(Unit.DAY, -1), "2026-09-23", "2026-09-23"),
        row("前天", calendar(Unit.DAY, -2), "2026-09-22", "2026-09-22"),
        row("过去两周", relative(Unit.WEEK, 2), "2026-09-11", "2026-09-24"),
        row("最近一个月", relative(Unit.MONTH, 1), "2026-08-25", "2026-09-24"),
        row("近半年", relative(Unit.MONTH, 6), "2026-03-25", "2026-09-24"),
        row("最近一个季度", relative(Unit.QUARTER, 1), "2026-06-25", "2026-09-24"),
        row("最近一年", relative(Unit.YEAR, 1), "2025-09-25", "2026-09-24"),
        row("本周", calendar(Unit.WEEK, 0), "2026-09-21", "2026-09-24"),
        row("上周", calendar(Unit.WEEK, -1), "2026-09-14", "2026-09-20"),
        row("上上周", calendar(Unit.WEEK, -2), "2026-09-07", "2026-09-13"),
        row("上个月", calendar(Unit.MONTH, -1), "2026-08-01", "2026-08-31"),
        row("本月", toDate(Unit.MONTH), "2026-09-01", "2026-09-24"),
        row("本季度", toDate(Unit.QUARTER), "2026-07-01", "2026-09-24"),
        row("上季度", calendar(Unit.QUARTER, -1), "2026-04-01", "2026-06-30"),
        row("今年以来", toDate(Unit.YEAR), "2026-01-01", "2026-09-24"),
        row("去年", calendar(Unit.YEAR, -1), "2025-01-01", "2025-12-31"),
        row("本周至今", toDate(Unit.WEEK), "2026-09-21", "2026-09-24"),
        row("9月上旬", absolute("2026-09-01", "2026-09-10"), "2026-09-01", "2026-09-10"),
        row("8.1-8.15", absolute("2026-08-01", "2026-08-15"), "2026-08-01", "2026-08-15"),
        row("2026-09-10", absolute("2026-09-10", "2026-09-10"), "2026-09-10", "2026-09-10"));
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("expressions")
  void resolvesExpressionAgainstShanghaiAnchor(
      String sourceText, TimeExpression expression, String from, String to) {
    ResolvedTimeRange range = TimeExpressionResolver.resolve(expression, ANCHOR, SHANGHAI);

    assertEquals(LocalDate.parse(from), range.from());
    assertEquals(LocalDate.parse(to), range.to());
    assertEquals(sourceText, range.sourceText());
  }

  @Test
  void monthArithmeticClampsToMonthEnd() {
    Instant march31 = Instant.parse("2026-03-31T02:00:00Z");
    assertRange(relative(Unit.MONTH, 1), march31, "2026-03-01", "2026-03-31");
    assertRange(calendar(Unit.MONTH, -1), march31, "2026-02-01", "2026-02-28");
    assertRange(calendar(Unit.MONTH, -1), Instant.parse("2028-03-01T02:00:00Z"),
        "2028-02-01", "2028-02-29");
  }

  @Test
  void calendarWeekCrossesYearBoundaryFromMonday() {
    assertRange(calendar(Unit.WEEK, -1), Instant.parse("2026-01-05T02:00:00Z"),
        "2025-12-29", "2026-01-04");
  }

  @Test
  void anchorUsesBusinessZoneNotUtcDate() {
    // UTC 仍是 09-23，但上海已是 09-24 00:30。
    assertRange(relative(Unit.DAY, 1), Instant.parse("2026-09-23T16:30:00Z"),
        "2026-09-24", "2026-09-24");
  }

  @Test
  void allDataIsExplicitAndUnboundedBelow() {
    ResolvedTimeRange range = TimeExpressionResolver.resolve(
        new TimeExpression("（未指定时间）", Kind.ALL, null, null, null, null, null, null),
        ANCHOR, SHANGHAI);

    assertTrue(range.allData());
    assertNull(range.from());
    assertEquals(LocalDate.parse("2026-09-24"), range.to());
    assertEquals("全部数据（截至 2026-09-24）", range.description());
  }

  @Test
  void describesBoundedRangeWithSourceText() {
    ResolvedTimeRange range = TimeExpressionResolver.resolve(
        relative(Unit.DAY, 30).withSourceText("最近30天"), ANCHOR, SHANGHAI);

    assertEquals("最近30天（2026-08-26 至 2026-09-24）", range.description());
  }

  @Test
  void ambiguousExpressionCannotBeResolved() {
    TimeExpression ambiguous = new TimeExpression("那段时间", Kind.AMBIGUOUS, null, null, null,
        null, null, List.of(calendar(Unit.WEEK, -1), calendar(Unit.MONTH, -1)));

    BackendException error = assertThrows(BackendException.class,
        () -> TimeExpressionResolver.resolve(ambiguous, ANCHOR, SHANGHAI));
    assertEquals("TIME_EXPRESSION_AMBIGUOUS", error.code());
  }

  static Stream<Arguments> invalidExpressions() {
    return Stream.of(
        invalid("缺少原话", () -> new TimeExpression(" ", Kind.RELATIVE, Unit.DAY, 7, null, null, null, null)),
        invalid("缺少 kind", () -> new TimeExpression("x", null, Unit.DAY, 7, null, null, null, null)),
        invalid("relative 缺少 n", () -> new TimeExpression("x", Kind.RELATIVE, Unit.DAY, null, null, null, null, null)),
        invalid("relative n=0", () -> new TimeExpression("x", Kind.RELATIVE, Unit.DAY, 0, null, null, null, null)),
        invalid("relative 缺少 unit", () -> new TimeExpression("x", Kind.RELATIVE, null, 7, null, null, null, null)),
        invalid("relative 多余 from", () -> new TimeExpression("x", Kind.RELATIVE, Unit.DAY, 7, null,
            LocalDate.parse("2026-09-01"), null, null)),
        invalid("calendar 正偏移", () -> new TimeExpression("x", Kind.CALENDAR, Unit.MONTH, null, 1, null, null, null)),
        invalid("calendar 缺少 offset", () -> new TimeExpression("x", Kind.CALENDAR, Unit.MONTH, null, null, null, null, null)),
        invalid("to-date 带 n", () -> new TimeExpression("x", Kind.TO_DATE, Unit.MONTH, 3, null, null, null, null)),
        invalid("to-date 按天", () -> new TimeExpression("x", Kind.TO_DATE, Unit.DAY, null, null, null, null, null)),
        invalid("absolute 起止颠倒", () -> new TimeExpression("x", Kind.ABSOLUTE, null, null, null,
            LocalDate.parse("2026-09-10"), LocalDate.parse("2026-09-01"), null)),
        invalid("absolute 缺少 to", () -> new TimeExpression("x", Kind.ABSOLUTE, null, null, null,
            LocalDate.parse("2026-09-10"), null, null)),
        invalid("all 带 unit", () -> new TimeExpression("x", Kind.ALL, Unit.DAY, null, null, null, null, null)),
        invalid("ambiguous 无候选", () -> new TimeExpression("x", Kind.AMBIGUOUS, null, null, null, null, null, List.of())),
        invalid("ambiguous 嵌套", () -> new TimeExpression("x", Kind.AMBIGUOUS, null, null, null, null, null,
            List.of(new TimeExpression("y", Kind.AMBIGUOUS, null, null, null, null, null,
                List.of(calendar(Unit.DAY, -1)))))));
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("invalidExpressions")
  void rejectsMalformedExpression(String name, Runnable construct) {
    BackendException error = assertThrows(BackendException.class, construct::run);
    assertEquals("TIME_EXPRESSION_INVALID", error.code());
  }

  @Test
  void coverageReportsFullPartialAndNone() {
    LocalDate dataFrom = LocalDate.parse("2026-09-05");
    LocalDate dataTo = LocalDate.parse("2026-09-23");

    TimeCoverage full = range("2026-09-10", "2026-09-20").coverage(dataFrom, dataTo);
    assertEquals(TimeCoverage.Status.FULL, full.status());
    assertEquals(LocalDate.parse("2026-09-10"), full.effectiveFrom());

    TimeCoverage partial = range("2026-08-26", "2026-09-24").coverage(dataFrom, dataTo);
    assertEquals(TimeCoverage.Status.PARTIAL, partial.status());
    assertEquals(LocalDate.parse("2026-09-05"), partial.effectiveFrom());
    assertEquals(LocalDate.parse("2026-09-23"), partial.effectiveTo());

    TimeCoverage none = range("2026-01-01", "2026-01-31").coverage(dataFrom, dataTo);
    assertEquals(TimeCoverage.Status.NONE, none.status());
    assertNull(none.effectiveFrom());

    TimeCoverage all = TimeExpressionResolver.resolve(
        new TimeExpression("全部", Kind.ALL, null, null, null, null, null, null), ANCHOR, SHANGHAI)
        .coverage(dataFrom, dataTo);
    assertEquals(TimeCoverage.Status.FULL, all.status());
    assertEquals(dataFrom, all.effectiveFrom());
    assertEquals(dataTo, all.effectiveTo());
  }

  @Test
  void coverageWithoutDataIsNone() {
    TimeCoverage none = range("2026-09-10", "2026-09-20").coverage(null, null);
    assertEquals(TimeCoverage.Status.NONE, none.status());
  }

  private static ResolvedTimeRange range(String from, String to) {
    return TimeExpressionResolver.resolve(absolute(from, to), ANCHOR, SHANGHAI);
  }

  private static void assertRange(TimeExpression expression, Instant anchor, String from, String to) {
    ResolvedTimeRange range = TimeExpressionResolver.resolve(expression, anchor, SHANGHAI);
    assertEquals(LocalDate.parse(from), range.from());
    assertEquals(LocalDate.parse(to), range.to());
  }

  private static Arguments row(String sourceText, TimeExpression expression, String from, String to) {
    return Arguments.of(sourceText, expression.withSourceText(sourceText), from, to);
  }

  private static Arguments invalid(String name, Runnable construct) {
    return Arguments.of(name, construct);
  }

  private static TimeExpression relative(Unit unit, int n) {
    return new TimeExpression("t", Kind.RELATIVE, unit, n, null, null, null, null);
  }

  private static TimeExpression calendar(Unit unit, int offset) {
    return new TimeExpression("t", Kind.CALENDAR, unit, null, offset, null, null, null);
  }

  private static TimeExpression toDate(Unit unit) {
    return new TimeExpression("t", Kind.TO_DATE, unit, null, null, null, null, null);
  }

  private static TimeExpression absolute(String from, String to) {
    return new TimeExpression("t", Kind.ABSOLUTE, null, null, null,
        LocalDate.parse(from), LocalDate.parse(to), null);
  }
}
