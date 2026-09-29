package com.dip3.ontologyagent.semantic.api;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class QueryIntentCodecTest {

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
