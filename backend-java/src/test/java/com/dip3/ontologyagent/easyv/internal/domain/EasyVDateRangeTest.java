package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class EasyVDateRangeTest {
  private static final Instant ANCHOR = Instant.parse("2026-08-19T03:00:00Z");

  @Test
  void resolvesExplicitIsoDatePair() {
    assertEquals(
        new EasyVDateRange(LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 15)),
        EasyVDateRange.resolve("分析 2026-08-01 至 2026-08-15 的大屏生成质量", ANCHOR));
  }

  @Test
  void resolvesSingleIsoDateAsOneBusinessDay() {
    assertEquals(
        new EasyVDateRange(LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 1)),
        EasyVDateRange.resolve("分析 2026-08-01 这一天的大屏生成质量", ANCHOR));
  }

  @Test
  void currentRelativePeriodsEndAtTheAnchorDay() {
    assertEquals(
        new EasyVDateRange(LocalDate.of(2026, 8, 17), LocalDate.of(2026, 8, 19)),
        EasyVDateRange.resolve("本周大屏生成情况", ANCHOR));
    assertEquals(
        new EasyVDateRange(LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 19)),
        EasyVDateRange.resolve("本月生成质量", ANCHOR));
    assertEquals(
        new EasyVDateRange(LocalDate.of(2026, 8, 10), LocalDate.of(2026, 8, 16)),
        EasyVDateRange.resolve("上周 Forge 失败情况", ANCHOR));
    assertEquals(
        new EasyVDateRange(LocalDate.of(2026, 8, 13), LocalDate.of(2026, 8, 19)),
        EasyVDateRange.resolve("近7天生成情况", ANCHOR));
  }

  @Test
  void missingOrOverSpecifiedRangeFailsLoudly() {
    assertEquals(
        "EASYV_TIME_RANGE_REQUIRED",
        assertThrows(BackendException.class, () -> EasyVDateRange.resolve("看一下 Forge 失败", ANCHOR)).code());
    assertEquals(
        "EASYV_TIME_RANGE_INVALID",
        assertThrows(BackendException.class, () -> EasyVDateRange.resolve(
            "比较 2026-08-01、2026-08-02 和 2026-08-03 的生成情况", ANCHOR)).code());
  }
}
