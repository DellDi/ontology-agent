package com.dip3.ontologyagent.easyv.internal.domain;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SchemeLibraryParserTest {
  private final SchemeLibraryParser.Constraint chart = SchemeLibraryParser.constraint("[\"basic\"]", "[\"基础图表类\"]");

  // 字段与 20260604_data.sql id=40 的两个左右槽位一致，顺序特意反转。
  private static String slots = """
      [{"block_internal_id":"7","role":"main","weight":1,"name":"不保留","bindMetric":"metric_private",
        "position":{"col":7,"row":1,"colSpan":6,"rowSpan":12},"config":{"x":"50%","y":"0%","width":"50%","height":"100%"}},
       {"block_internal_id":"7","role":"main","weight":1,
        "position":{"col":1,"row":1,"colSpan":6,"rowSpan":12}}]
      """;

  @Test void sourceGeometryIsSortedIntoSlotIndicesAndOnlyReviewedFieldsAreProjected() throws Exception {
    var parsed = SchemeLibraryParser.parse(2, slots, Map.of("7", chart));
    assertEquals("available", parsed.status());
    assertEquals(0, parsed.slots().getFirst().slotIndex());
    assertEquals(1, parsed.slots().getFirst().position().col());
    assertEquals(1, parsed.slots().get(1).slotIndex());
    assertEquals("50%", parsed.slots().get(1).config().width());
    assertEquals(List.of("basic"), parsed.slots().getFirst().allowedChartCategories());
    assertEquals(List.of("基础图表类"), parsed.slots().getFirst().recommendedGroups());
    String json = new ObjectMapper().writeValueAsString(parsed);
    assertFalse(json.contains("不保留")); assertFalse(json.contains("metric_private"));
    assertThrows(UnsupportedOperationException.class, () -> parsed.slots().clear());
    assertThrows(UnsupportedOperationException.class, () -> chart.allowedChartCategories().clear());
  }

  @Test void missingConstraintsAreDifferentFromExplicitEmptyConstraints() {
    assertEquals("SCHEME_CONSTRAINT_MISSING", SchemeLibraryParser.parse(2, slots, Map.of()).errorCode());
    assertEquals("missing", SchemeLibraryParser.parse(2, slots,
        Map.of("7", SchemeLibraryParser.constraint(null, "[]"))).status());
    var empty = SchemeLibraryParser.parse(2, slots, Map.of("7", SchemeLibraryParser.constraint("[]", "[]")));
    assertEquals("available", empty.status());
    assertEquals(List.of(), empty.slots().getFirst().allowedChartCategories());
    assertNull(SchemeLibraryParser.parse(2, null, Map.of()).slots());
  }

  @Test void invalidSourceInputsHaveErrorsAndNeverFabricateSlotsOrPositions() {
    assertEquals("SCHEME_JSON_MALFORMED", SchemeLibraryParser.parse(2, "{", Map.of()).errorCode());
    assertEquals("SCHEME_COUNT_MISMATCH", SchemeLibraryParser.parse(1, slots, Map.of("7", chart)).errorCode());
    assertEquals("SCHEME_OBJECT_INVALID", SchemeLibraryParser.parse(1,
        "[{\"block_internal_id\":\"7\",\"role\":\"main\",\"weight\":1}]", Map.of("7", chart)).errorCode());
    assertEquals("invalid", SchemeLibraryParser.parse(2, slots.replace("\"col\":1", "\"col\":0"), Map.of("7", chart)).status());
    assertEquals("SCHEME_NUMBER_INVALID", SchemeLibraryParser.parse(2, slots.replace("\"weight\":1", "\"weight\":1.2"), Map.of("7", chart)).errorCode());
    assertEquals("invalid", SchemeLibraryParser.parse(2, slots,
        Map.of("7", SchemeLibraryParser.constraint("[3]", "[]"))).status());
  }

  @Test void exactIntegerStringsFromTheSourceParserAreAcceptedWithoutDefaultingMissingFields() {
    var stringValues = slots.replace("\"col\":7", "\"col\":\"7\"").replace("\"weight\":1", "\"weight\":\"1\"");
    assertEquals("available", SchemeLibraryParser.parse(2, stringValues, Map.of("7", chart)).status());
    assertEquals("invalid", SchemeLibraryParser.parse(2, slots.replace("\"weight\":1", "\"weight\":null"), Map.of("7", chart)).status());
  }
}
