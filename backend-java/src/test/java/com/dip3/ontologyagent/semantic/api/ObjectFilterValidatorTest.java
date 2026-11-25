package com.dip3.ontologyagent.semantic.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.semantic.api.OntologyProperty.Type;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Filter;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Operator;
import com.dip3.ontologyagent.support.BackendException;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;

class ObjectFilterValidatorTest {
  private static final OntologyProperty TEXT = OntologyProperty.column("name", "名称", null, Type.STRING, "name");
  private static final OntologyProperty NUM = OntologyProperty.column("count", "数量", null, Type.NUMBER, "count");
  private static final OntologyProperty BOOL = OntologyProperty.column("flag", "标记", null, Type.BOOLEAN, "flag");
  private static final OntologyProperty TIME = OntologyProperty.column("createdAt", "创建时间", null, Type.TIME, "created_at");
  private static final OntologyProperty DETAIL = OntologyProperty.detailText("raw", "原文", null, "{CUBE}.raw");

  @Test
  void convertsValidValuesAcrossAllPropertyTypes() {
    assertEquals(List.of("abc"), validate(TEXT, Operator.CONTAINS, List.of("abc")));
    assertEquals(List.of(new BigDecimal("12.5")), validate(NUM, Operator.GTE, List.of("12.5")));
    assertEquals(List.of(Boolean.TRUE), validate(BOOL, Operator.EQUALS, List.of("true")));
    assertEquals(List.of(OffsetDateTime.parse("2026-11-21T00:00:00+08:00")),
        validate(TIME, Operator.GTE, List.of("2026-11-21T00:00:00+08:00")));
    assertEquals(List.of(OffsetDateTime.parse("2026-11-20T16:00:00Z")),
        validate(TIME, Operator.GT, List.of("2026-11-20T16:00:00Z")));
    assertEquals(List.of(), validate(TIME, Operator.SET, List.of()));
    assertEquals(List.of(), validate(TIME, Operator.NOT_SET, List.of()));
  }

  @Test
  void rejectsBareDatesAndOffsetlessTimestampsWithActionableFormatHint() {
    for (String bad : List.of("2026-11-20", "2026-11-20T00:00:00", "2026-11-20 00:00:00+08:00", "not-a-time")) {
      BackendException error = assertThrows(BackendException.class, () -> validate(TIME, Operator.GT, List.of(bad)));
      assertEquals("TEST_INVALID", error.code());
      assertTrue(error.getMessage().contains("createdAt"));
      assertTrue(error.getMessage().contains("ISO-8601"));
      assertTrue(error.getMessage().contains("+08:00"));
      assertTrue(error.getMessage().contains(bad));
    }
  }

  @Test
  void rejectsOperatorTypeMismatchesInvalidValuesAndDetailOnlyProperties() {
    assertThrows(BackendException.class, () -> validate(TIME, Operator.CONTAINS, List.of("2026-11-20T00:00:00+08:00")));
    assertThrows(BackendException.class, () -> validate(TEXT, Operator.GT, List.of("a")));
    assertThrows(BackendException.class, () -> validate(BOOL, Operator.GTE, List.of("true")));
    assertThrows(BackendException.class, () -> validate(NUM, Operator.EQUALS, List.of("NaN")));
    assertThrows(BackendException.class, () -> validate(BOOL, Operator.EQUALS, List.of("1")));
    assertThrows(BackendException.class, () -> validate(TIME, Operator.SET, List.of("2026-11-20T00:00:00+08:00")));
    assertThrows(BackendException.class, () -> validate(TIME, Operator.GTE, List.of("2026-11-20T00:00:00+08:00", "2026-11-21T00:00:00+08:00")));
    assertThrows(BackendException.class, () -> validate(DETAIL, Operator.EQUALS, List.of("x")));
  }

  private static List<Object> validate(OntologyProperty property, Operator operator, List<String> values) {
    return ObjectFilterValidator.validateAndConvert(property, new Filter(property.key(), operator, values),
        message -> new BackendException("TEST_INVALID", message));
  }
}
