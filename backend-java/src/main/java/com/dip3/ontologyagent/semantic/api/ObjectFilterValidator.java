package com.dip3.ontologyagent.semantic.api;

import com.dip3.ontologyagent.semantic.api.QueryIntent.Filter;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Operator;
import com.dip3.ontologyagent.support.BackendException;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/**
 * 对象查询过滤条件与值类型的唯一校验/转换规则，供规划阶段（{@code EASYV_PLAN_INVALID}）与
 * 数据库执行阶段（{@code OBJECT_QUERY_INVALID}）共享，避免两处口径漂移。
 */
public final class ObjectFilterValidator {
  private static final int MAX_VALUES = 100;
  private static final int MAX_VALUE_LENGTH = 500;
  private static final int PREVIEW_LENGTH = 64;

  private ObjectFilterValidator() {}

  /** 校验单个过滤条件与属性类型的兼容性，并把字符串过滤值转换为对应强类型参数。 */
  public static List<Object> validateAndConvert(
      OntologyProperty property, Filter filter, Function<String, BackendException> invalid) {
    if (property == null || filter == null || filter.operator() == null) {
      throw invalid.apply("过滤条件缺少属性或操作符。");
    }
    if (property.detailOnly()) {
      throw invalid.apply("原文属性 " + property.key() + " 只允许单对象详情读取，不能用于过滤或排序。");
    }
    Operator operator = filter.operator();
    boolean noValues = operator == Operator.SET || operator == Operator.NOT_SET;
    if (noValues) {
      if (!filter.values().isEmpty()) {
        throw invalid.apply("SET/NOT_SET 只判断是否存在且 values 必须为空；多值匹配使用 EQUALS。");
      }
      return List.of();
    }
    if (filter.values().isEmpty() || filter.values().size() > MAX_VALUES) {
      throw invalid.apply("属性 " + property.key() + " 的过滤值需要 1.." + MAX_VALUES + " 项。");
    }
    if (operator != Operator.EQUALS && operator != Operator.NOT_EQUALS && filter.values().size() != 1) {
      throw invalid.apply("属性 " + property.key() + " 的 " + operator + " 过滤只能有一个值。");
    }
    if (operator == Operator.CONTAINS && property.type() != OntologyProperty.Type.STRING) {
      throw invalid.apply("CONTAINS 只适用于文本属性，属性 " + property.key() + " 类型为 " + property.type() + "。");
    }
    if ((operator == Operator.GT || operator == Operator.GTE || operator == Operator.LT || operator == Operator.LTE)
        && property.type() != OntologyProperty.Type.NUMBER && property.type() != OntologyProperty.Type.TIME) {
      throw invalid.apply("大小比较（" + operator + "）只适用于数值或时间属性，属性 " + property.key()
          + " 类型为 " + property.type() + "。");
    }
    List<Object> converted = new ArrayList<>(filter.values().size());
    for (String value : filter.values()) {
      converted.add(convert(property, value, invalid));
    }
    return List.copyOf(converted);
  }

  private static Object convert(
      OntologyProperty property, String value, Function<String, BackendException> invalid) {
    if (value == null || value.isBlank() || value.length() > MAX_VALUE_LENGTH) {
      throw invalid.apply("属性 " + property.key() + " 的过滤值为空或过长。");
    }
    return switch (property.type()) {
      case STRING -> value;
      case NUMBER -> {
        try {
          yield new BigDecimal(value);
        } catch (NumberFormatException error) {
          throw invalid.apply("属性 " + property.key() + "（NUMBER）的过滤值必须是十进制数字，收到："
              + preview(value) + "。");
        }
      }
      case BOOLEAN -> {
        if (!value.equals("true") && !value.equals("false")) {
          throw invalid.apply("属性 " + property.key() + "（BOOLEAN）的过滤值必须为 true 或 false，收到："
              + preview(value) + "。");
        }
        yield Boolean.valueOf(value);
      }
      case TIME -> {
        try {
          yield OffsetDateTime.parse(value);
        } catch (DateTimeParseException error) {
          throw invalid.apply("属性 " + property.key()
              + "（TIME）的过滤值必须是带时区偏移的 ISO-8601 时间戳（如 2026-11-21T00:00:00+08:00 或 2026-11-20T16:00:00Z），"
              + "不能使用无时区的日期或时间；收到：" + preview(value) + "。");
        }
      }
    };
  }

  private static String preview(String value) {
    return value.length() <= PREVIEW_LENGTH ? value : value.substring(0, PREVIEW_LENGTH) + "…";
  }
}
