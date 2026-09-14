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
  /** Sentinel lower bound meaning "all collected data" for free-form questions. */
  public static final LocalDate UNBOUNDED_FROM = LocalDate.of(2000, 1, 1);
  private static final Pattern ISO_DATE =
      Pattern.compile("(?<!\\d)(\\d{4}-\\d{2}-\\d{2})(?!\\d)");
  private static final Pattern ALL_DATA_PATTERN =
      Pattern.compile("截至 (\\d{4}-\\d{2}-\\d{2}) 的全部已采集数据");

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

  public boolean coversAllData() {
    return !from.isAfter(UNBOUNDED_FROM);
  }

  public String describe() {
    if (coversAllData()) return "截至 " + to + " 的全部已采集数据";
    return from + "/" + to;
  }

  /** Parses a display value produced by {@link #describe()} back into a range. */
  public static EasyVDateRange parseDisplay(String raw) {
    String value = raw == null ? "" : raw.trim();
    Matcher all = ALL_DATA_PATTERN.matcher(value);
    try {
      if (all.matches()) {
        return new EasyVDateRange(UNBOUNDED_FROM, LocalDate.parse(all.group(1)));
      }
      String[] boundaries = value.split("/", -1);
      if (boundaries.length != 2) {
        throw new BackendException(
            "FOLLOW_UP_TIME_RANGE_INVALID", "时间范围必须使用 yyyy-MM-dd/yyyy-MM-dd。");
      }
      LocalDate from = LocalDate.parse(boundaries[0].trim());
      LocalDate to = LocalDate.parse(boundaries[1].trim());
      if (from.isAfter(to)) {
        throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "时间范围起始日期不能晚于结束日期。");
      }
      return new EasyVDateRange(from, to);
    } catch (java.time.format.DateTimeParseException | IllegalArgumentException error) {
      throw new BackendException(
          "FOLLOW_UP_TIME_RANGE_INVALID", "时间范围必须使用有效日期。", error);
    }
  }

  private static List<String> isoDates(String question) {
    Matcher matcher = ISO_DATE.matcher(question);
    java.util.ArrayList<String> dates = new java.util.ArrayList<>();
    while (matcher.find()) dates.add(matcher.group(1));
    return dates;
  }
}
