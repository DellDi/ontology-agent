package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.*;
import com.dip3.ontologyagent.semantic.api.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class EasyVRenderBlocksObjectTest {
  private final SemanticModel model = SemanticModel.discover();
  private final SemanticQueryCompiler compiler = new SemanticQueryCompiler(model);
  private static final Set<String> PRODUCTS = Set.of("easyv-ai-application", "easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component");

  @Test
  void retainsFiltersExactCurrentPeriodAndFrozenContextWithoutApplyingAggregateRanking() {
    var time = new TimeExpression("9月", TimeExpression.Kind.ABSOLUTE, null, null, null,
        LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), null);
    var filter = new QueryIntent.Filter("blockSize", QueryIntent.Operator.EQUALS, List.of("large"));
    var query = query("easyv-prototype-block", List.of(filter), time);
    var blocks = EasyVRenderBlocks.objectBrowsers(List.of(query), model, "set-old", PRODUCTS);
    assertEquals(1, blocks.size());
    var block = blocks.getFirst();
    assertEquals("set-old", block.get("datasetVersionSetId"));
    assertEquals("supporting", block.get("role"));
    assertEquals(List.of(filter,
        new QueryIntent.Filter("createdAt", QueryIntent.Operator.GTE, List.of("2026-09-01T00:00+08:00")),
        new QueryIntent.Filter("createdAt", QueryIntent.Operator.LT, List.of("2026-10-01T00:00+08:00"))), block.get("filters"));
    assertFalse(block.containsKey("limit")); assertFalse(block.containsKey("order"));
  }

  @Test
  void allTimeDoesNotInventDateFilterAndUnsupportedScopeNeverBecomesUnfilteredBrowse() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var query = query("easyv-prototype-block", List.of(), all);
    assertEquals(List.of(), EasyVRenderBlocks.objectBrowsers(List.of(query), model, "set", PRODUCTS).getFirst().get("filters"));
    for (String member : List.of("application.userId", "count")) {
      var filtered = query("easyv-prototype-block", List.of(new QueryIntent.Filter(member, QueryIntent.Operator.EQUALS, List.of("1"))), all);
      assertTrue(EasyVRenderBlocks.objectBrowsers(List.of(filtered), model, "set", PRODUCTS).isEmpty());
    }
    assertTrue(EasyVRenderBlocks.objectBrowsers(List.of(query), model, "set", Set.of("easyv-prototype-block")).isEmpty());
    assertTrue(EasyVRenderBlocks.objectBrowsers(List.of(query("easyv-ai-application", List.of(), all)), model, "set", PRODUCTS).isEmpty());
  }

  private EasyVSemanticAgent.ExecutedQuery query(String object, List<QueryIntent.Filter> filters, TimeExpression time) {
    var intent = new QueryIntent(object, List.of("count"), List.of(), filters, new QueryIntent.TimeSpec(null, time, null), null,
        List.of(new QueryIntent.Order("count", QueryIntent.Direction.DESC)), 5);
    var result = compiler.compile(intent, Instant.parse("2026-10-03T00:00:00Z"));
    assertTrue(result.accepted(), result.violations().toString());
    return new EasyVSemanticAgent.ExecutedQuery("q1", "原型结构分析", result.query(),
        new SemanticQueryPort.SemanticQueryResult(List.of(Map.of("count", 3)), List.of(), "select count(*)"), null);
  }
}
