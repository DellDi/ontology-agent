package com.dip3.ontologyagent.easyv.internal.domain;

import com.dip3.ontologyagent.support.BackendException;
import java.text.Normalizer;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** EasyV business dates use Asia/Shanghai and inclusive local-date boundaries. */
public record EasyVDateRange(LocalDate from, LocalDate to) {
  public static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
  private static final Pattern ISO_DATE =
      Pattern.compile("(?<!\\d)(\\d{4}-\\d{2}-\\d{2})(?!\\d)");

  public EasyVDateRange {
    if (from == null || to == null || from.isAfter(to)) {
      throw new BackendException("EASYV_TIME_RANGE_INVALID", "EasyV 分析时间范围无效。");
    }
  }

  public static EasyVDateRange resolve(String rawQuestion, Instant anchoredAt) {
    if (anchoredAt == null) {
      throw new BackendException("EASYV_TIME_RANGE_INVALID", "EasyV 日期解析缺少固定时间锚点。");
    }
    String question = Normalizer.normalize(rawQuestion == null ? "" : rawQuestion, Normalizer.Form.NFKC);
    LocalDate anchor = anchoredAt.atZone(BUSINESS_ZONE).toLocalDate();
    List<String> iso = isoDates(question);
    if (iso.size() == 1) {
      LocalDate day = LocalDate.parse(iso.getFirst());
      return new EasyVDateRange(day, day);
    }
    if (iso.size() == 2) return new EasyVDateRange(LocalDate.parse(iso.get(0)), LocalDate.parse(iso.get(1)));
    if (!iso.isEmpty()) {
      throw new BackendException("EASYV_TIME_RANGE_INVALID", "EasyV ISO 日期只能提供单日或一组起止日期。");
    }
    if (question.contains("近7天") || question.contains("近 7 天")) {
      return new EasyVDateRange(anchor.minusDays(6), anchor);
    }
    if (question.contains("上周")) {
      LocalDate start = anchor.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).minusWeeks(1);
      return new EasyVDateRange(start, start.plusDays(6));
    }
    if (question.contains("本周")) {
      LocalDate start = anchor.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
      return new EasyVDateRange(start, anchor);
    }
    if (question.contains("本月")) {
      YearMonth month = YearMonth.from(anchor);
      return new EasyVDateRange(month.atDay(1), anchor);
    }
    throw new BackendException(
        "EASYV_TIME_RANGE_REQUIRED", "EasyV 问题必须提供单日、两个 ISO 日期、本周、上周、近7天或本月。");
  }

  private static List<String> isoDates(String question) {
    Matcher matcher = ISO_DATE.matcher(question);
    java.util.ArrayList<String> dates = new java.util.ArrayList<>();
    while (matcher.find()) dates.add(matcher.group(1));
    return dates;
  }
}
