package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.*;
import com.dip3.ontologyagent.semantic.api.*;
import java.time.Instant;
import java.util.*;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class EasyVRenderBlocksPresentationTest {
  private final SemanticModel model = SemanticModel.discover();
  private final SemanticQueryCompiler compiler = new SemanticQueryCompiler(model);
  private static final String LAYOUT = "easyv-prototype-layout";
  private static final String COMPONENT = "easyv-prototype-component";

  @Test
  void identifiersUseReadableDetailsWithoutObjectNameBranchesAndKeepExactBindings() {
    for (String dimension : List.of("appId", "layoutSignature", "schemeSignature", "countSignature", "chartSignature")) {
      var block = render(query(LAYOUT, List.of(dimension), List.of("count"), 3, null,
          List.of(Map.of(dimension, "opaque-a", "count", 3), Map.of(dimension, "opaque-b", "count", 1))), null);
      assertEquals("table", block.get("type"));
      assertTrue(block.get("presentationReason").toString().contains("标识符"));
      var bindings = (List<?>) block.get("drilldowns");
      var first = (EasyVResultDrilldown.Binding) bindings.getFirst();
      assertEquals(1, first.column());
      assertEquals(List.of(new QueryIntent.Filter(dimension, QueryIntent.Operator.EQUALS, List.of("opaque-a"))), first.filters());
      assertEquals("set-old", block.get("datasetVersionSetId"));
    }
  }

  @Test
  void equalReturnedGroupsUseDetailsButExplicitLegalChartRemainsPossible() {
    var query = query(COMPONENT, List.of("chartFamily"), List.of("count"), 3, null,
        List.of(Map.of("chartFamily", "line", "count", 1), Map.of("chartFamily", "donut", "count", 1.0)));
    var automatic = render(query, null);
    assertEquals("table", automatic.get("type"));
    assertTrue(automatic.get("presentationReason").toString().contains("已返回分组"));
    assertEquals("chart", render(query, "bar").get("type"));
    assertEquals("chart", render(query, "pie").get("type"));
    assertEquals("table", render(query, "none").get("type"));
    assertEquals("supporting", render(query, "none").get("role"));
  }

  @Test
  void comparisonAndTrendUseDifferentShapesAndInvalidSuggestionExplainsWhy() {
    var comparison = query(COMPONENT, List.of("chartFamily"), List.of("count"), 3, null,
        List.of(Map.of("chartFamily", "line", "count", 3), Map.of("chartFamily", "donut", "count", 1)));
    assertEquals("bar", render(comparison, null).get("chartType"));
    assertEquals("table", render(comparison, "line").get("type"));
    var trend = query(COMPONENT, List.of(), List.of("count"), 3, QueryIntent.Granularity.MONTH,
        List.of(Map.of("time", "2026-08-01", "count", 1), Map.of("time", "2026-09-01", "count", 1)));
    assertEquals("line", render(trend, null).get("chartType"), "平坦趋势仍有时间语义，不套分类差异规则");
    assertEquals("table", render(trend, "bar").get("type"));
    assertEquals("table", render(trend, "pie").get("type"));
  }

  @Test
  void largeResultsUseBoundedPreviewAndNeverCallThePreviewTheTotal() {
    var rows = IntStream.range(0, 253).mapToObj(i -> Map.<String, Object>of("chartFamily", "family-" + i, "count", i + 1)).toList();
    var block = render(query(COMPONENT, List.of("chartFamily"), List.of("count"), 300, null, rows), "bar");
    assertEquals("table", block.get("type"));
    assertEquals(50, ((List<?>) block.get("rows")).size());
    assertEquals(50, ((List<?>) block.get("drilldowns")).size());
    assertTrue(block.get("presentationReason").toString().contains("253 个结果行，当前预览 50 行"));
    assertTrue(block.get("presentationReason").toString().contains("不是全量对象数"));
  }

  @Test
  void summaryAndMultiMeasureComparisonDoNotBecomeObjectCardsOrLoseSeries() {
    var summary = query(LAYOUT, List.of(), List.of("count"), 3, null, List.of(Map.of("count", 253)));
    assertEquals("kv-list", render(summary, null).get("type"));
    var grouped = query(LAYOUT, List.of("layoutType"), List.of("count", "blockTotal"), 3, null,
        List.of(Map.of("layoutType", "凹形", "count", 3, "blockTotal", 12), Map.of("layoutType", "半包围", "count", 1, "blockTotal", 4)));
    assertEquals("table", render(grouped, null).get("type"));
    assertEquals(2, ((List<?>) render(grouped, "bar").get("series")).size());
  }

  @Test
  void tableComparisonIncludesBothPeriodsAndOnlyBindsCurrentPeriodAtTheCorrectColumn() {
    var current = new TimeExpression("9月", TimeExpression.Kind.ABSOLUTE, null, null, null,
        java.time.LocalDate.of(2026, 9, 1), java.time.LocalDate.of(2026, 9, 30), null);
    var previous = new TimeExpression("8月", TimeExpression.Kind.ABSOLUTE, null, null, null,
        java.time.LocalDate.of(2026, 8, 1), java.time.LocalDate.of(2026, 8, 31), null);
    var intent = new QueryIntent(COMPONENT, List.of("count"), List.of("chartFamily"), List.of(),
        new QueryIntent.TimeSpec(null, current, null), previous, List.of(), 5);
    var compiled = compiler.compile(intent, Instant.parse("2026-10-09T00:00:00Z")).require();
    var query = new EasyVSemanticAgent.ExecutedQuery("q1", "组件对比", compiled,
        new SemanticQueryPort.SemanticQueryResult(List.of(Map.of("chartFamily", "line", "count", 3)),
            List.of(Map.of("chartFamily", "donut", "count", 5)), "actual-query"), null);
    var block = render(query, "table");
    assertEquals("期间", ((List<?>) block.get("columns")).getFirst());
    var rows = (List<?>) block.get("rows");
    assertEquals(2, rows.size());
    assertTrue(((List<?>) rows.get(0)).getFirst().toString().startsWith("当前期"));
    assertTrue(((List<?>) rows.get(1)).getFirst().toString().startsWith("对比期"));
    assertEquals("5", ((List<?>) rows.get(1)).get(2));
    var bindings = (List<?>) block.get("drilldowns");
    assertEquals(1, bindings.size());
    assertEquals(2, ((EasyVResultDrilldown.Binding) bindings.getFirst()).column());
    var onlyCompare = new EasyVSemanticAgent.ExecutedQuery("q1", "组件对比", compiled,
        new SemanticQueryPort.SemanticQueryResult(List.of(), query.result().compareRows(), "actual-query"), null);
    assertEquals(1, ((List<?>) render(onlyCompare, "table").get("rows")).size());
    assertFalse(render(onlyCompare, "table").containsKey("drilldowns"));
  }

  @Test
  void pieRequiresCompleteAdditiveDataAndRejectsTopNAndDistinctSignatures() {
    var rows = List.of(Map.<String, Object>of("layoutType", "半包围", "count", 3), Map.<String, Object>of("layoutType", "凹形", "count", 1));
    assertEquals("pie", render(query(LAYOUT, List.of("layoutType"), List.of("count"), 3, null, rows), "pie").get("chartType"));
    assertEquals("pie", render(query(LAYOUT, List.of("layoutType"), List.of("count"), null, null, rows), "pie").get("chartType"));
    assertEquals("table", render(query(LAYOUT, List.of("layoutType"), List.of("count"), 2, null, rows), "pie").get("type"));
    var distinct = query(LAYOUT, List.of("layoutType"), List.of("layoutSignatureCount"), 3, null,
        List.of(Map.of("layoutType", "半包围", "layoutSignatureCount", 3), Map.of("layoutType", "凹形", "layoutSignatureCount", 1)));
    assertEquals("table", render(distinct, "pie").get("type"));
  }

  @Test
  void nonAdditiveRatesMissingNumbersAndNegativePartsRemainRealTableValues() {
    var rate = query("easyv-forge-task", List.of("status"), List.of("successRate"), 3, null,
        List.of(Map.of("status", "completed", "successRate", 90), Map.of("status", "failed", "successRate", 10)));
    assertEquals("table", render(rate, "pie").get("type"));
    for (Object value : List.of("unknown", Double.NaN, -1)) {
      var query = query(COMPONENT, List.of("chartFamily"), List.of("count"), 3, null,
          List.of(Map.of("chartFamily", "line", "count", value), Map.of("chartFamily", "donut", "count", 1)));
      assertEquals("table", render(query, "pie").get("type"));
      if (!(value instanceof Number n) || !Double.isFinite(n.doubleValue())) assertEquals("table", render(query, "bar").get("type"));
    }
    var zero = query(COMPONENT, List.of("chartFamily"), List.of("count"), 3, null,
        List.of(Map.of("chartFamily", "line", "count", 0), Map.of("chartFamily", "donut", "count", 0)));
    assertEquals("table", render(zero, "pie").get("type"));
    assertTrue(EasyVRenderBlocks.build(List.of(query(COMPONENT, List.of(), List.of("count"), 3, null, List.of())), List.of(), model, "set-old").isEmpty());
  }

  private Map<String, Object> render(EasyVSemanticAgent.ExecutedQuery query, String viz) {
    return EasyVRenderBlocks.build(List.of(query), viz == null ? List.of() : List.of(new EasyVAnalysisModel.Highlight("q1", viz)), model, "set-old").getFirst();
  }

  private EasyVSemanticAgent.ExecutedQuery query(String object, List<String> dimensions, List<String> measures,
      Integer limit, QueryIntent.Granularity granularity, List<Map<String, Object>> rows) {
    var all = new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
    var intent = new QueryIntent(object, measures, dimensions, List.of(), new QueryIntent.TimeSpec(null, all, granularity), null, List.of(), limit);
    var compiled = compiler.compile(intent, Instant.parse("2026-10-09T00:00:00Z")).require();
    return new EasyVSemanticAgent.ExecutedQuery("q1", "真实结果呈现", compiled,
        new SemanticQueryPort.SemanticQueryResult(rows, List.of(), "actual-query"), null);
  }
}
