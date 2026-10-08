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
  void clickedChartGroupRetainsOriginalFiltersAndOnlyThatGroupNotTopNObjects() {
    var time = new TimeExpression("9月", TimeExpression.Kind.ABSOLUTE, null, null, null,
        LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), null);
    var app = new QueryIntent.Filter("appId", QueryIntent.Operator.EQUALS, List.of("105"));
    var query = grouped("easyv-prototype-component", List.of("chartFamily"), List.of(app), time,
        List.of(Map.of("chartFamily", "donut", "count", 3), Map.of("chartFamily", "line", "count", 2)));
    var block = EasyVRenderBlocks.build(List.of(query), List.of(), model, "set-old").getFirst();
    assertEquals("chart", block.get("type"));
    var bindings = bindings(block);
    assertEquals(2, bindings.size(), "每个分组须有自己的下钻绑定，不能复用整次查询范围");
    assertEquals(0, bindings.getFirst().get("row"));
    assertEquals(0, bindings.getFirst().get("column"));
    assertEquals("easyv-prototype-component", bindings.getFirst().get("objectKey"));
    assertEquals(List.of(app,
        new QueryIntent.Filter("createdAt", QueryIntent.Operator.GTE, List.of("2026-09-01T00:00+08:00")),
        new QueryIntent.Filter("createdAt", QueryIntent.Operator.LT, List.of("2026-10-01T00:00+08:00")),
        new QueryIntent.Filter("chartFamily", QueryIntent.Operator.EQUALS, List.of("donut"))), bindings.getFirst().get("filters"));
    assertFalse(bindings.getFirst().containsKey("limit"), "Top N 只限制显示分组，不能截断组内对象");
    assertNotEquals(bindings.getFirst().get("id"), bindings.get(1).get("id"));
  }

  @Test
  void countBindsItsOwnObjectTypeAndSignatureGroupIsExact() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    for (String object : List.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component")) {
      var block = EasyVRenderBlocks.build(List.of(query(object, List.of(), all)), List.of(), model, "set-old").getFirst();
      assertEquals("kv-list", block.get("type"));
      assertEquals(object, bindings(block).getFirst().get("objectKey"));
      assertEquals(List.of(), bindings(block).getFirst().get("filters"));
    }
    var query = grouped("easyv-prototype-layout", List.of("layoutSignature"), List.of(), all,
        List.of(Map.of("layoutSignature", "L1-a", "count", 2), Map.of("layoutSignature", "L1-b", "count", 1)));
    assertEquals(List.of(new QueryIntent.Filter("layoutSignature", QueryIntent.Operator.EQUALS, List.of("L1-a"))),
        bindings(EasyVRenderBlocks.build(List.of(query), List.of(), model, "set-old").getFirst()).getFirst().get("filters"));
  }

  @Test
  void tableRetainsEveryDimensionAndNullGroupNeverBecomesAnUnfilteredList() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("layoutType", "半包围"); row.put("layoutSignature", null); row.put("count", 1);
    var query = grouped("easyv-prototype-layout", List.of("layoutType", "layoutSignature"), List.of(), all, List.of(row));
    var block = EasyVRenderBlocks.build(List.of(query), List.of(), model, "set-old").getFirst();
    assertEquals("table", block.get("type"));
    assertEquals(2, bindings(block).getFirst().get("column"));
    assertEquals(List.of(new QueryIntent.Filter("layoutType", QueryIntent.Operator.EQUALS, List.of("半包围")),
        new QueryIntent.Filter("layoutSignature", QueryIntent.Operator.NOT_SET, List.of())), bindings(block).getFirst().get("filters"));
  }

  @Test
  void onlyCountIsLinkedWhenTheSameResultAlsoHasASumOrDistinctSignatureCount() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var intent = new QueryIntent("easyv-prototype-layout", List.of("blockTotal", "count", "layoutSignatureCount"),
        List.of(), List.of(), new QueryIntent.TimeSpec(null, all, null), null, List.of(), 5);
    var compiled = compiler.compile(intent, Instant.parse("2026-10-03T00:00:00Z"));
    assertTrue(compiled.accepted());
    var query = new EasyVSemanticAgent.ExecutedQuery("q1", "多个统计", compiled.query(),
        new SemanticQueryPort.SemanticQueryResult(List.of(Map.of("count", 5, "blockTotal", 30, "layoutSignatureCount", 5)), List.of(), "sql"), null);
    var block = EasyVRenderBlocks.build(List.of(query), List.of(), model, "set-old").getFirst();
    assertEquals(1, bindings(block).size());
    assertEquals(1, bindings(block).getFirst().get("column"));
    assertEquals("set-old", block.get("datasetVersionSetId"));
  }

  @Test
  void unsupportedGroupAndFilterOverflowCannotBecomeAnUnfilteredDrilldown() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var relation = grouped("easyv-prototype-layout", List.of("application.userId"), List.of(), all,
        List.of(Map.of("application.userId", "16", "count", 1)));
    var unsupported = EasyVRenderBlocks.build(List.of(relation), List.of(), model, "set-old").getFirst();
    assertFalse(unsupported.containsKey("drilldowns"));
    assertNotNull(unsupported.get("drilldownUnavailableReason"));
    var filters = Collections.nCopies(10, new QueryIntent.Filter("parseStatus", QueryIntent.Operator.EQUALS, List.of("ok")));
    var overflow = grouped("easyv-prototype-layout", List.of("layoutSignature"), filters, all,
        List.of(Map.of("layoutSignature", "L1-a", "count", 1)));
    var block = EasyVRenderBlocks.build(List.of(overflow), List.of(), model, "set-old").getFirst();
    assertFalse(block.containsKey("drilldowns"));
    assertNotNull(block.get("drilldownUnavailableReason"));
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> bindings(Map<String, Object> block) {
    assertInstanceOf(List.class, block.get("drilldowns"), "统计项缺少精确对象绑定");
    return ((List<EasyVResultDrilldown.Binding>) block.get("drilldowns")).stream().map(binding -> Map.<String, Object>of("id", binding.id(), "row", binding.row(), "column", binding.column(), "objectKey", binding.objectKey(), "filters", binding.filters())).toList();
  }

  private EasyVSemanticAgent.ExecutedQuery grouped(String object, List<String> dimensions,
      List<QueryIntent.Filter> filters, TimeExpression time, List<Map<String, Object>> rows) {
    var intent = new QueryIntent(object, List.of("count"), dimensions, filters, new QueryIntent.TimeSpec(null, time, null), null,
        List.of(new QueryIntent.Order("count", QueryIntent.Direction.DESC)), 2);
    var result = compiler.compile(intent, Instant.parse("2026-10-03T00:00:00Z"));
    assertTrue(result.accepted(), result.violations().toString());
    return new EasyVSemanticAgent.ExecutedQuery("q1", "原型结构分析", result.query(),
        new SemanticQueryPort.SemanticQueryResult(rows, List.of(), "select group count"), null);
  }

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
