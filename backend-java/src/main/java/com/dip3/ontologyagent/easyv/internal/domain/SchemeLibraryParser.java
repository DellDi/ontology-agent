package com.dip3.ontologyagent.easyv.internal.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** 投影源方案与槽位类型；保留缺失/损坏证据，不继承源端的默认位置或空约束。 */
public final class SchemeLibraryParser {
  private static final ObjectMapper JSON = new ObjectMapper();
  private SchemeLibraryParser() {}

  public record Constraint(List<String> allowedChartCategories, List<String> recommendedGroups, String errorCode) {}
  public record Parsed(String status, String errorCode, List<Slot> slots) {}
  public record Slot(int slotIndex, String internalId, String role, int weight, Position position,
      Config config, List<String> allowedChartCategories, List<String> recommendedGroups) {}
  public record Position(int col, int row, int colSpan, int rowSpan) {}
  public record Config(Object x, Object y, Object width, Object height) {}
  private record SourceSlot(String internalId, String role, int weight, Position position, Config config) {}

  public static Constraint constraint(Object categories, Object recommendations) {
    try {
      return new Constraint(strings(categories), strings(recommendations), null);
    } catch (InvalidInput | JsonProcessingException failure) {
      return new Constraint(null, null, code(failure));
    }
  }

  public static Parsed parse(int chartCount, Object sourceSlots, Map<String, Constraint> constraints) {
    if (sourceSlots == null) return new Parsed("missing", "SCHEME_SLOTS_MISSING", null);
    try {
      if (chartCount <= 0) throw invalid("SCHEME_COUNT_INVALID");
      List<?> source = array(decode(sourceSlots));
      if (source.size() != chartCount) throw invalid("SCHEME_COUNT_MISMATCH");
      List<SourceSlot> parsed = new ArrayList<>();
      for (Object value : source) {
        Map<?, ?> item = object(value);
        Map<?, ?> position = object(item.get("position"));
        Map<?, ?> config = item.get("config") == null ? null : object(item.get("config"));
        parsed.add(new SourceSlot(id(item.get("block_internal_id")), text(item.get("role")),
            integer(item.get("weight"), false),
            new Position(integer(position.get("col"), true), integer(position.get("row"), true),
                integer(position.get("colSpan"), true), integer(position.get("rowSpan"), true)),
            config == null ? null : new Config(size(config.get("x")), size(config.get("y")),
                size(config.get("width")), size(config.get("height")))));
      }
      // 与源端 convertToScheme 一致：按 row/col 阅读顺序建立新的 slotIndex。
      parsed.sort(Comparator.comparingInt((SourceSlot s) -> s.position().row())
          .thenComparingInt(s -> s.position().col()));
      List<Slot> result = new ArrayList<>();
      for (SourceSlot slot : parsed) {
        Constraint constraint = constraints.get(slot.internalId());
        if (constraint == null) return new Parsed("missing", "SCHEME_CONSTRAINT_MISSING", null);
        if (constraint.errorCode() != null) throw invalid(constraint.errorCode());
        if (constraint.allowedChartCategories() == null || constraint.recommendedGroups() == null) {
          return new Parsed("missing", "SCHEME_CONSTRAINT_MISSING", null);
        }
        result.add(new Slot(result.size(), slot.internalId(), slot.role(), slot.weight(), slot.position(),
            slot.config(), constraint.allowedChartCategories(), constraint.recommendedGroups()));
      }
      return new Parsed("available", null, List.copyOf(result));
    } catch (InvalidInput | JsonProcessingException failure) {
      return new Parsed("invalid", code(failure), null);
    }
  }

  private static Object decode(Object value) throws JsonProcessingException {
    return value instanceof String text ? JSON.readValue(text, Object.class) : value;
  }
  private static List<String> strings(Object value) throws JsonProcessingException {
    if (value == null) return null;
    List<String> result = new ArrayList<>();
    for (Object item : array(decode(value))) result.add(text(item));
    return List.copyOf(result);
  }
  private static Map<?, ?> object(Object value) {
    if (!(value instanceof Map<?, ?> map)) throw invalid("SCHEME_OBJECT_INVALID");
    return map;
  }
  private static List<?> array(Object value) {
    if (!(value instanceof List<?> list)) throw invalid("SCHEME_ARRAY_INVALID");
    return list;
  }
  private static String text(Object value) {
    if (!(value instanceof String text) || text.isBlank()) throw invalid("SCHEME_TEXT_INVALID");
    return text;
  }
  private static String id(Object value) {
    if (value instanceof Number) return String.valueOf(integer(value, true));
    String text = text(value);
    if (!text.matches("[1-9][0-9]*")) throw invalid("SCHEME_INTERNAL_ID_INVALID");
    return text;
  }
  private static int integer(Object value, boolean positive) {
    if (value instanceof String text && text.matches("-?[0-9]+")) {
      try { value = Long.parseLong(text); } catch (NumberFormatException failure) { throw invalid("SCHEME_NUMBER_INVALID"); }
    }
    if (!(value instanceof Number number) || !Double.isFinite(number.doubleValue())
        || number.doubleValue() != Math.rint(number.doubleValue())
        || number.doubleValue() < (positive ? 1 : Integer.MIN_VALUE)
        || number.doubleValue() > Integer.MAX_VALUE) throw invalid("SCHEME_NUMBER_INVALID");
    return number.intValue();
  }
  private static Object size(Object value) {
    if (value == null || value instanceof String) return value;
    if (value instanceof Number number && Double.isFinite(number.doubleValue())) return value;
    throw invalid("SCHEME_SIZE_INVALID");
  }
  private static String code(Exception failure) {
    return failure instanceof InvalidInput invalid ? invalid.code : "SCHEME_JSON_MALFORMED";
  }
  private static InvalidInput invalid(String code) { return new InvalidInput(code); }
  private static final class InvalidInput extends RuntimeException {
    private final String code;
    private InvalidInput(String code) { super(code, null, false, false); this.code = code; }
  }
}
