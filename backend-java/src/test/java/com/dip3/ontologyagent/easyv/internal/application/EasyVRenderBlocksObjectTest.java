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
  void relatedDimensionBindsTheDeclaredParentPropertyWithoutLosingScope() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var query = grouped("easyv-prototype-layout", List.of("application.scopeType"), List.of(), all,
        List.of(Map.of("application.scopeType", "USER", "count", 3)));
    var block = EasyVRenderBlocks.build(List.of(query), List.of(), model, "set").getFirst();
    assertEquals(List.of(new QueryIntent.Filter("application.scopeType", QueryIntent.Operator.EQUALS, List.of("USER"))),
        bindings(block).getFirst().get("filters"));
    var saved = ((List<?>) block.get("drilldowns")).getFirst();
    assertTrue(((EasyVResultDrilldown.Binding) saved).scopeDescription().contains("个人"));
    assertFalse(((EasyVResultDrilldown.Binding) saved).scopeDescription().contains("USER"));
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
  void everyMetricHasItsOwnContributorBindingWithoutPretendingASumIsAnObjectCount() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var intent = new QueryIntent("easyv-prototype-layout", List.of("blockTotal", "count", "layoutSignatureCount"),
        List.of(), List.of(), new QueryIntent.TimeSpec(null, all, null), null, List.of(), 5);
    var compiled = compiler.compile(intent, Instant.parse("2026-10-03T00:00:00Z"));
    assertTrue(compiled.accepted());
    var query = new EasyVSemanticAgent.ExecutedQuery("q1", "多个统计", compiled.query(),
        new SemanticQueryPort.SemanticQueryResult(List.of(Map.of("count", 5, "blockTotal", 30, "layoutSignatureCount", 5)), List.of(), "sql"), null);
    var block = EasyVRenderBlocks.build(List.of(query), List.of(), model, "set-old").getFirst();
    assertEquals(3, bindings(block).size());
    assertEquals(List.of(0, 1, 2), bindings(block).stream().map(binding -> binding.get("column")).toList());
    var actual = (List<?>) block.get("drilldowns");
    assertTrue(((EasyVResultDrilldown.Binding) actual.getFirst()).scopeDescription().contains("记录条数不等于该指标值"));
    assertTrue(((EasyVResultDrilldown.Binding) actual.getFirst()).metricKey().equals("blockTotal"));
    assertEquals("set-old", block.get("datasetVersionSetId"));
  }

  @Test
  void aggregateFilterAndFilterOverflowCannotBecomeAnUnfilteredDrilldown() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var relation = grouped("easyv-prototype-layout", List.of(), List.of(new QueryIntent.Filter("count", QueryIntent.Operator.GT, List.of("2"))), all,
        List.of(Map.of("count", 3)));
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

  @Test
  void timeBucketsClipToTheQueryPeriodAndComparisonCellsUseTheirOwnPeriod() {
    var current = new TimeExpression("9月中旬", TimeExpression.Kind.ABSOLUTE, null, null, null,
        LocalDate.of(2026, 9, 10), LocalDate.of(2026, 9, 20), null);
    var compare = new TimeExpression("8月中旬", TimeExpression.Kind.ABSOLUTE, null, null, null,
        LocalDate.of(2026, 8, 10), LocalDate.of(2026, 8, 20), null);
    var intent = new QueryIntent("easyv-ai-application", List.of("count"), List.of(), List.of(),
        new QueryIntent.TimeSpec(null, current, QueryIntent.Granularity.MONTH), compare, List.of(), 5);
    var compiled = compiler.compile(intent, Instant.parse("2026-10-03T00:00:00Z"));
    assertTrue(compiled.accepted(), compiled.violations().toString());
    var query = new EasyVSemanticAgent.ExecutedQuery("q1", "两个时段各有多少应用？", compiled.query(),
        new SemanticQueryPort.SemanticQueryResult(List.of(Map.of("time", "2026-09-01T00:00:00.000", "count", 3)),
            List.of(Map.of("time", "2026-07-31T16:00:00Z", "count", 2)), "sql"), null);
    var block = EasyVRenderBlocks.build(List.of(query), List.of(), model, "set").getFirst();
    assertEquals("table", block.get("type"));
    var bindings = bindings(block);
    assertEquals(2, bindings.size());
    assertEquals(1, bindings.get(1).get("row"));
    assertEquals(2, bindings.get(1).get("column"));
    assertEquals(List.of(new QueryIntent.Filter("createdAt", QueryIntent.Operator.GTE, List.of("2026-09-10T00:00+08:00")),
        new QueryIntent.Filter("createdAt", QueryIntent.Operator.LT, List.of("2026-09-21T00:00+08:00"))), bindings.getFirst().get("filters"));
    assertEquals(List.of(new QueryIntent.Filter("createdAt", QueryIntent.Operator.GTE, List.of("2026-08-10T00:00+08:00")),
        new QueryIntent.Filter("createdAt", QueryIntent.Operator.LT, List.of("2026-08-21T00:00+08:00"))), bindings.get(1).get("filters"));
    assertNotEquals(bindings.getFirst().get("id"), bindings.get(1).get("id"));
  }

  @Test
  void allDataBucketsUseCalendarBoundariesAndInvalidTimesNeverOpenAllObjects() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var cases = Map.of(QueryIntent.Granularity.DAY, List.of("2024-02-29", "2024-03-01"),
        QueryIntent.Granularity.WEEK, List.of("2024-12-30", "2025-01-06"),
        QueryIntent.Granularity.MONTH, List.of("2024-02-01", "2024-03-01"),
        QueryIntent.Granularity.QUARTER, List.of("2024-10-01", "2025-01-01"),
        QueryIntent.Granularity.YEAR, List.of("2024-01-01", "2025-01-01"));
    for (var entry : cases.entrySet()) {
      var intent = new QueryIntent("easyv-ai-application", List.of("count"), List.of(), List.of(),
          new QueryIntent.TimeSpec(null, all, entry.getKey()), null, List.of(), 5);
      var compiled = compiler.compile(intent, Instant.parse("2026-10-03T00:00:00Z"));
      assertTrue(compiled.accepted());
      var query = new EasyVSemanticAgent.ExecutedQuery("q1", "按时间查看应用", compiled.query(),
          new SemanticQueryPort.SemanticQueryResult(List.of(Map.of("time", entry.getValue().getFirst(), "count", 3)), List.of(), "sql"), null);
      var filters = bindings(EasyVRenderBlocks.build(List.of(query), List.of(), model, "set").getFirst()).getFirst().get("filters");
      assertEquals(List.of(new QueryIntent.Filter("createdAt", QueryIntent.Operator.GTE, List.of(entry.getValue().getFirst() + "T00:00+08:00")),
          new QueryIntent.Filter("createdAt", QueryIntent.Operator.LT, List.of(entry.getValue().get(1) + "T00:00+08:00"))), filters);
      var bad = new EasyVSemanticAgent.ExecutedQuery("q1", "invalid", compiled.query(),
          new SemanticQueryPort.SemanticQueryResult(List.of(Map.of("time", "not-a-date", "count", 3)), List.of(), "sql"), null);
      assertFalse(EasyVRenderBlocks.build(List.of(bad), List.of(), model, "set").getFirst().containsKey("drilldowns"));
    }
  }

  @Test
  void comparisonKpiUsesTheComparisonValueCellAndTableOffsetsRespectPreviewCap() {
    var september = new TimeExpression("9月", TimeExpression.Kind.ABSOLUTE, null, null, null,
        LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), null);
    var august = new TimeExpression("8月", TimeExpression.Kind.ABSOLUTE, null, null, null,
        LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31), null);
    for (var dimensions : List.of(List.<String>of(), List.of("scopeType"))) {
      var intent = new QueryIntent("easyv-ai-application", List.of("count"), dimensions, List.of(),
          new QueryIntent.TimeSpec(null, september, null), august, List.of(), 5);
      var compiled = compiler.compile(intent, Instant.parse("2026-10-03T00:00:00Z"));
      assertTrue(compiled.accepted());
      Map<String, Object> row = Map.of("scopeType", "USER", "count", 3);
      var rows = dimensions.isEmpty() ? List.of(row) : Collections.nCopies(EasyVSemanticAgent.EVIDENCE_ROW_CAP + 5, row);
      var query = new EasyVSemanticAgent.ExecutedQuery("q1", "对比应用数", compiled.query(),
          new SemanticQueryPort.SemanticQueryResult(rows, List.of(row), "sql"), null);
      var block = EasyVRenderBlocks.build(List.of(query), List.of(), model, "set").getFirst();
      var last = bindings(block).getLast();
      assertEquals(dimensions.isEmpty() ? "kv-list" : "table", block.get("type"));
      assertEquals(dimensions.isEmpty() ? 0 : EasyVSemanticAgent.EVIDENCE_ROW_CAP, last.get("row"));
      assertEquals(dimensions.isEmpty() ? 1 : 2, last.get("column"));
      assertTrue(last.get("filters").toString().contains("2026-08-01"));
    }
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
    for (String member : List.of("count")) {
      var filtered = query("easyv-prototype-block", List.of(new QueryIntent.Filter(member, QueryIntent.Operator.EQUALS, List.of("1"))), all);
      assertTrue(EasyVRenderBlocks.objectBrowsers(List.of(filtered), model, "set", PRODUCTS).isEmpty());
    }
    var related = query("easyv-prototype-block", List.of(new QueryIntent.Filter("application.userId", QueryIntent.Operator.EQUALS, List.of("1"))), all);
    assertEquals(related.compiled().intent().filters(), EasyVRenderBlocks.objectBrowsers(List.of(related), model, "set", PRODUCTS).getFirst().get("filters"));
    assertTrue(EasyVRenderBlocks.objectBrowsers(List.of(query), model, "set", Set.of("easyv-prototype-block")).isEmpty());
  }

  @Test
  void applicationCountOpensTheSameBrowserAndExactDrilldownWhileOtherObjectsStayClosed() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var application = query("easyv-ai-application", List.of(), all);
    var browser = EasyVRenderBlocks.objectBrowsers(List.of(application), model, "set-old", PRODUCTS).getFirst();
    assertEquals("easyv-ai-application", browser.get("objectKey"));
    assertEquals(List.of(), browser.get("filters"));
    assertTrue(EasyVRenderBlocks.objectBrowsers(List.of(application), model, "set-old", Set.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component")).isEmpty(),
        "缺少应用产品时不能打开读取范围");
    var block = EasyVRenderBlocks.build(List.of(application), List.of(), model, "set-old").getFirst();
    assertEquals("easyv-ai-application", bindings(block).getFirst().get("objectKey"));
    assertEquals(List.of(), bindings(block).getFirst().get("filters"));
    for (String other : List.of("easyv-prototype", "easyv-pipeline-node")) {
      var closed = query(other, List.of(), all);
      assertTrue(EasyVRenderBlocks.objectBrowsers(List.of(closed), model, "set-old", PRODUCTS).isEmpty(), other);
      assertFalse(EasyVRenderBlocks.build(List.of(closed), List.of(), model, "set-old").getFirst().containsKey("drilldowns"), other);
    }
  }

  @Test
  void qualityBrowserRequiresItsDeclaredProductRatherThanItsObjectKey() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var query = query("easyv-quality-node", List.of(), all);
    assertTrue(EasyVRenderBlocks.objectBrowsers(List.of(query), model, "set", PRODUCTS).isEmpty());
    var products = new HashSet<>(PRODUCTS);
    products.add("easyv-pipeline-node");
    assertEquals("easyv-quality-node", EasyVRenderBlocks.objectBrowsers(List.of(query), model, "set", products)
        .getFirst().get("objectKey"));
    assertEquals("easyv-quality-node", bindings(EasyVRenderBlocks.build(List.of(query), List.of(), model, "set")
        .getFirst()).getFirst().get("objectKey"));
  }

  @Test
  void labelsAreForDisplayWhileDrilldownAndQueryKeepRawValues() {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var query = grouped("easyv-quality-node", List.of("intent"), List.of(), all,
        List.of(Map.of("intent", "OUT_OF_SCOPE", "count", 24)));
    var block = EasyVRenderBlocks.build(List.of(query), List.of(), model, "set").getFirst();
    assertEquals(List.of(List.of("当次被判为不支持", "24")), block.get("rows"));
    assertEquals(List.of(new QueryIntent.Filter("intent", QueryIntent.Operator.EQUALS, List.of("OUT_OF_SCOPE"))),
        bindings(block).getFirst().get("filters"));
    assertEquals("OUT_OF_SCOPE", query.result().rows().getFirst().get("intent"));
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
