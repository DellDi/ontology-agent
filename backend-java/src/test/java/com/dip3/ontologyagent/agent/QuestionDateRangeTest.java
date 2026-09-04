package com.dip3.ontologyagent.agent;

import com.dip3.ontologyagent.property.internal.domain.QuestionDateRange;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class QuestionDateRangeTest {
    private static final Instant MARCH_2026 = Instant.parse("2026-03-15T04:00:00Z");

    @Test
    void resolvesExactlyTwoIsoDates() {
        assertRange("分析 2026-01-01 至 2026-01-31 收缴率",
                "2026-01-01", "2026-01-31");
        assertRange("分析 2026-01-01 截至 2026-06-30 收缴率",
                "2026-01-01", "2026-06-30");
    }

    @Test
    void resolvesOneChineseMonthIncludingLeapYearEnd() {
        assertRange("分析 2024 年 2 月项目收缴率", "2024-02-01", "2024-02-29");
        assertRange("分析 2026 年 7 月五月花园收缴率", "2026-07-01", "2026-07-31");
    }

    @Test
    void resolvesOneChineseYear() {
        assertRange("分析 2025 年项目收缴率", "2025-01-01", "2025-12-31");
        assertRange("分析去年五月花园收缴率", "2025-01-01", "2025-12-31");
    }

    @Test
    void resolvesCurrentAndPreviousMonthFromSessionCreationTime() {
        assertRange("分析本月项目收缴率", "2026-03-01", "2026-03-31");
        assertRange("分析上个月项目收缴率", "2026-02-01", "2026-02-28");
    }

    @Test
    void missingRangeFailsLoudly() {
        BackendException error = assertThrows(BackendException.class,
                () -> QuestionDateRange.resolve("分析项目收缴率", MARCH_2026));
        assertEquals("ANALYSIS_TIME_RANGE_REQUIRED", error.code());
    }

    @Test
    void ambiguousRangeFailsLoudly() {
        BackendException error = assertThrows(BackendException.class,
                () -> QuestionDateRange.resolve("分析本月和上月项目收缴率", MARCH_2026));
        assertEquals("ANALYSIS_TIME_RANGE_INVALID", error.code());
    }

    @Test
    void reversedIsoRangeFailsLoudly() {
        BackendException error = assertThrows(BackendException.class,
                () -> QuestionDateRange.resolve("分析 2026-02-01 至 2026-01-01 收缴率", MARCH_2026));
        assertEquals("ANALYSIS_TIME_RANGE_INVALID", error.code());
    }

    @Test
    void partialMonthIsoRangeIsRejectedForAccountingPeriodSemantics() {
        BackendException error = assertThrows(BackendException.class,
                () -> QuestionDateRange.resolve("分析 2026-01-02 至 2026-01-31 收缴率", MARCH_2026));
        assertEquals("ANALYSIS_TIME_RANGE_INVALID", error.code());
    }

    @Test
    void rangeLongerThanOneYearIsRejected() {
        BackendException error = assertThrows(BackendException.class,
                () -> QuestionDateRange.resolve("分析 2025-01-01 至 2026-02-28 收缴率", MARCH_2026));
        assertEquals("ANALYSIS_TIME_RANGE_INVALID", error.code());
    }

    @Test
    void halfYearAndQuarterPhrasesAreRejectedInsteadOfSilentlyExpandingToAFullYear() {
        for (String question : List.of("分析 2026 年上半年项目收缴率", "分析今年第一季度项目收缴率", "分析 Q2 收缴率",
                "分析截至 2026 年 6 月的收缴率", "分析 2026 年前 6 个月收缴率")) {
            BackendException error = assertThrows(BackendException.class,
                    () -> QuestionDateRange.resolve(question, MARCH_2026));
            assertEquals("ANALYSIS_TIME_RANGE_INVALID", error.code());
        }
        BackendException chineseNumber = assertThrows(BackendException.class,
                () -> QuestionDateRange.resolve("分析 2026 年前六个月收缴率", MARCH_2026));
        assertEquals("ANALYSIS_TIME_RANGE_INVALID", chineseNumber.code());
    }

    @Test
    void abbreviatedMonthRangeIsRejectedInsteadOfSilentlyUsingOneMonthOrOneYear() {
        for (String question : List.of("分析 2026 年 1 月至 3 月项目收缴率", "分析 2026 年 1-3 月项目收缴率",
                "分析今年 6 月项目收缴率", "分析 2026 年六月项目收缴率",
                "分析 2026 年 1 月和 2 月项目收缴率", "分析 2026 年 1 月还有 2 月项目收缴率",
                "分析 2026 年 1 月和二月份项目收缴率", "分析 2026 年 1 月至同年 3 月项目收缴率",
                "分析 2026 年 1 月至当年 3 月项目收缴率", "分析今年 1 月至 3 月项目收缴率",
                "分析 2026 年 1 月跟 2 月项目收缴率", "分析 2026 年 1 月/2 月项目收缴率",
                "分析 2026 年 1 月另 2 月项目收缴率", "分析 2026 年 1 月 2 月项目收缴率",
                "分析 2026 年 1 月 15 日项目收缴率", "分析 2026 年 1 月 1 日至 15 日收缴率",
                "分析 2026 年 1 月上旬项目收缴率", "分析 2026 年 1 月 15 日前项目收缴率",
                "分析 2026 年 1 月第一周项目收缴率", "分析从 2026 年 1 月起项目收缴率",
                "分析 2026 年 1 月以来项目收缴率")) {
            BackendException error = assertThrows(BackendException.class,
                    () -> QuestionDateRange.resolve(question, MARCH_2026));
            assertEquals("ANALYSIS_TIME_RANGE_INVALID", error.code());
        }
    }

    private static void assertRange(String question, String from, String to) {
        QuestionDateRange range = QuestionDateRange.resolve(question, MARCH_2026);
        assertEquals(LocalDate.parse(from), range.from());
        assertEquals(LocalDate.parse(to), range.to());
    }
}
