package com.dip3.ontologyagent.property.internal.domain;

import com.dip3.ontologyagent.support.BackendException;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Year;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public record QuestionDateRange(LocalDate from, LocalDate to) {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Taipei");
    private static final Pattern ISO_DATE = Pattern.compile("(?<!\\d)(\\d{4}-\\d{2}-\\d{2})(?!\\d)");
    private static final Pattern MONTH = Pattern.compile("(?<!\\d)(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月");
    private static final Pattern REMAINING_MONTH_TOKEN = Pattern.compile(
            "(?:(?:\\d{4}\\s*年|今年|去年|同年|当年)\\s*)?"
                    + "(?:\\d{1,2}|[一二三四五六七八九十]+)\\s*月份?"
                    + "(?=$|[\\s，,。；;、/跟和与及或另至到~—–-]|(?:项目)?(?:收缴率|收费率|回款率))");
    private static final Pattern REMAINING_DAY_TOKEN = Pattern.compile(
            "(?:\\d{1,2}|[一二三四五六七八九十]+)\\s*[日号]"
                    + "(?=$|[\\s，,。；;、/跟和与及或另至到前后内起以之~—–-]|(?:项目)?(?:收缴率|收费率|回款率))");
    private static final Pattern YEAR = Pattern.compile("(?<!\\d)(\\d{4})\\s*年(?!\\s*\\d{1,2}\\s*月)");
    private static final Pattern UNSUPPORTED_PARTIAL_PERIOD = Pattern.compile(
            "(?i)(上半年|下半年|前\\s*(?:\\d+|[一二三四五六七八九十百]+)\\s*个月|第?[一二三四1234]\\s*季度|Q\\s*[1-4]|"
                    + "上旬|中旬|下旬|月初|月中|月末|前半月|后半月|"
                    + "第?\\s*(?:\\d+|[一二三四五六七八九十]+)\\s*(?:周|星期)|"
                    + "\\d{4}\\s*年\\s*\\d{1,2}\\s*(?:月\\s*)?(?:至|到|[-~—–])\\s*\\d{1,2}\\s*月)");
    private static final Pattern UNSUPPORTED_OPEN_PERIOD = Pattern.compile(
            "(?:从|自)\\s*(?:\\d{4}\\s*年(?:\\s*\\d{1,2}\\s*月)?|本月|上月|今年|去年)"
                    + "\\s*(?:起|开始|以来|至今)|"
                    + "(?:\\d{4}\\s*年\\s*\\d{1,2}\\s*月|本月|上月|今年|去年)"
                    + "\\s*(?:前|后|以前|之前|以后|之后|以来|至今)");

    public static QuestionDateRange resolve(String question, Instant createdAt) {
        try {
            String normalized = Normalizer.normalize(question == null ? "" : question, Normalizer.Form.NFKC);
            if (UNSUPPORTED_PARTIAL_PERIOD.matcher(normalized).find()
                    || UNSUPPORTED_OPEN_PERIOD.matcher(normalized).find()) {
                throw new BackendException("ANALYSIS_TIME_RANGE_INVALID",
                        "当前分析不支持半年、季度或省略年份的月份区间，请提供一个完整年月或两个 ISO 日期。");
            }
            List<LocalDate> isoDates = matches(ISO_DATE, normalized).stream().map(LocalDate::parse).toList();
            if (normalized.contains("截至") && isoDates.size() != 2) {
                throw new BackendException("ANALYSIS_TIME_RANGE_INVALID", "截至日期必须同时提供完整的 ISO 起止日期。");
            }
            List<YearMonth> months = matches(MONTH, normalized).stream().map(value -> {
                String[] parts = value.split(":");
                return YearMonth.of(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]));
            }).toList();
            if (REMAINING_MONTH_TOKEN.matcher(MONTH.matcher(normalized).replaceAll(" ")).find()) {
                throw new BackendException("ANALYSIS_TIME_RANGE_INVALID",
                        "月份必须使用唯一的四位年份和阿拉伯数字月份。");
            }
            if (REMAINING_DAY_TOKEN.matcher(ISO_DATE.matcher(normalized).replaceAll(" ")).find()) {
                throw new BackendException("ANALYSIS_TIME_RANGE_INVALID",
                        "项目收缴率只支持完整自然月，日粒度范围必须使用两个完整 ISO 日期。");
            }
            List<Year> years = matches(YEAR, normalized).stream().map(value -> Year.of(Integer.parseInt(value))).toList();
            LocalDate anchor = createdAt.atZone(BUSINESS_ZONE).toLocalDate();
            List<QuestionDateRange> relative = new ArrayList<>();
            if (normalized.contains("本月")) relative.add(month(YearMonth.from(anchor)));
            if (normalized.contains("上月") || normalized.contains("上个月")) {
                relative.add(month(YearMonth.from(anchor).minusMonths(1)));
            }
            if (normalized.contains("今年")) relative.add(year(Year.from(anchor)));
            if (normalized.contains("去年")) relative.add(year(Year.from(anchor).minusYears(1)));

            int categories = (isoDates.isEmpty() ? 0 : 1) + (months.isEmpty() ? 0 : 1)
                    + (years.isEmpty() ? 0 : 1) + (relative.isEmpty() ? 0 : 1);
            if (categories == 0) {
                throw new BackendException("ANALYSIS_TIME_RANGE_REQUIRED",
                        "问题必须明确提供分析时间范围，例如 2026 年 7 月或两个 ISO 日期。");
            }
            if (categories > 1 || !months.isEmpty() && months.size() != 1
                    || !years.isEmpty() && years.size() != 1 || !relative.isEmpty() && relative.size() != 1
                    || !isoDates.isEmpty() && isoDates.size() != 2) {
                throw new BackendException("ANALYSIS_TIME_RANGE_INVALID", "问题中的分析时间范围不唯一或格式无效。");
            }
            if (!isoDates.isEmpty()) return range(isoDates.get(0), isoDates.get(1));
            if (!months.isEmpty()) return month(months.get(0));
            if (!years.isEmpty()) return year(years.get(0));
            return relative.get(0);
        } catch (BackendException error) {
            throw error;
        } catch (DateTimeException | NumberFormatException error) {
            throw new BackendException("ANALYSIS_TIME_RANGE_INVALID", "问题中的分析时间范围格式无效。", error);
        }
    }

    private static List<String> matches(Pattern pattern, String question) {
        List<String> values = new ArrayList<>();
        Matcher matcher = pattern.matcher(question == null ? "" : question);
        while (matcher.find()) {
            values.add(matcher.groupCount() == 1 ? matcher.group(1) : matcher.group(1) + ":" + matcher.group(2));
        }
        return values;
    }

    private static QuestionDateRange month(YearMonth month) {
        return new QuestionDateRange(month.atDay(1), month.atEndOfMonth());
    }

    private static QuestionDateRange year(Year year) {
        return new QuestionDateRange(year.atDay(1), year.atMonth(12).atEndOfMonth());
    }

    private static QuestionDateRange range(LocalDate from, LocalDate to) {
        if (from.isAfter(to)) throw new BackendException("ANALYSIS_TIME_RANGE_INVALID", "分析开始日期不能晚于结束日期。");
        if (from.getDayOfMonth() != 1 || !to.equals(YearMonth.from(to).atEndOfMonth())
                || ChronoUnit.DAYS.between(from, to) > 366) {
            throw new BackendException("ANALYSIS_TIME_RANGE_INVALID",
                    "项目收缴率仅支持不超过一年的完整自然月时间范围。");
        }
        return new QuestionDateRange(from, to);
    }
}
