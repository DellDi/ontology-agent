package com.dip3.ontologyagent.semantic.api;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class QueryIntentCodecTest {

  @Test
  void misplacedComparisonCannotSilentlyBecomeASinglePeriodQuery() {
    var period = Map.of("sourceText", "本月", "kind", "to-date", "unit", "month");
    var comparison = Map.of("sourceText", "上个月", "kind", "calendar", "unit", "month", "offset", -1);
    var raw = Map.of("object", "easyv-forge-task", "measures", List.of("count"),
        "time", Map.of("expression", period, "compare", comparison));

    var parsed = QueryIntentCodec.read(raw);

    assertFalse(parsed.accepted());
    assertNull(parsed.intent());
    assertTrue(parsed.violations().stream().anyMatch(message -> message.contains("time.compare")));
    var corrected = QueryIntentCodec.read(Map.of("object", "easyv-forge-task", "measures", List.of("count"),
        "time", Map.of("expression", period), "compare", comparison));
    assertTrue(corrected.accepted());
    assertEquals(comparison, QueryIntentCodec.write(corrected.intent()).get("compare"));
  }

  @Test
  void undeclaredTimeFieldIsRejectedInsteadOfIgnored() {
    var parsed = QueryIntentCodec.read(Map.of("object", "easyv-forge-task", "measures", List.of("count"),
        "time", Map.of("expression", Map.of("sourceText", "全部", "kind", "all"), "granulariy", "day")));
    assertFalse(parsed.accepted());
    assertTrue(parsed.violations().contains("time 不接受字段：granulariy"));
  }

  @Test
  void flatTimeFieldsProduceMissingExpressionViolation() {
    Map<String, Object> raw = new LinkedHashMap<>();
    raw.put("object", "x");
    raw.put("time", Map.of(
        "kind", "relative",
        "unit", "day",
        "n", 7,
        "sourceText", "近7天"));

    QueryIntentCodec.Parsed parsed = QueryIntentCodec.read(raw);

    assertFalse(parsed.accepted());
    assertNull(parsed.intent());
    assertTrue(parsed.violations().stream()
        .anyMatch(violation -> violation.startsWith("time 下缺少 expression")),
        () -> "expected 缺少 expression violation, got: " + parsed.violations());
  }

  @Test
  void nonObjectTimeExpressionReportsReceivedValue() {
    Map<String, Object> raw = new LinkedHashMap<>();
    raw.put("object", "x");
    raw.put("time", Map.of("expression", "近7天"));

    QueryIntentCodec.Parsed parsed = QueryIntentCodec.read(raw);

    assertFalse(parsed.accepted());
    List<String> violations = parsed.violations();
    assertTrue(violations.stream()
        .anyMatch(violation -> violation.startsWith("time.expression 必须是时间表达式对象")
            && violation.contains("近7天")),
        () -> "expected received-value detail, got: " + violations);
  }
}
