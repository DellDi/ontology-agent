package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Highlight;
import com.dip3.ontologyagent.easyv.internal.application.EasyVSemanticAgent.ExecutedQuery;
import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery.Column;
import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery.ColumnKind;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import com.dip3.ontologyagent.semantic.api.*;

/**
 * 查询结果 → 前端渲染块：按结果形状确定性选型（单行 → kv-list，时间序列 → 折线，单维度 → 柱状，
 * 其余 → 表格）；模型高亮只能在形状允许范围内调整图表类型与主次，不能凭空生成图表。
 */
final class EasyVRenderBlocks {
  private static final String EMPTY = "—";

  private EasyVRenderBlocks() {}

  static List<Map<String, Object>> build(List<ExecutedQuery> executed, List<Highlight> highlights) {
    Map<String, String> vizByQuery = new LinkedHashMap<>();
    for (Highlight highlight : highlights) {
      if (highlight.query() != null && highlight.viz() != null) vizByQuery.putIfAbsent(highlight.query(), highlight.viz());
    }
    List<Map<String, Object>> blocks = new ArrayList<>();
    for (ExecutedQuery query : executed) {
      if (query.result().rows().isEmpty()) continue;
      String viz = vizByQuery.get(query.id());
      boolean primary = vizByQuery.isEmpty() ? blocks.isEmpty() : viz != null && !"none".equals(viz);
      blocks.add(block(query, viz, primary ? "primary" : "supporting"));
    }
    return List.copyOf(blocks);
  }

  /** 聚合结果的对象范围入口：只在属性过滤可精确保留时生成，不把 HAVING/TopN 当作对象筛选。 */
  static List<Map<String, Object>> objectBrowsers(List<ExecutedQuery> executed, SemanticModel model,
                                                String datasetVersionSetId, Set<String> products) {
    Set<String> prototypes = Set.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component");
    if (!products.containsAll(prototypes) || !products.contains("easyv-ai-application")) return List.of();
    List<Map<String, Object>> blocks = new ArrayList<>();
    for (ExecutedQuery query : executed) {
      var compiled = query.compiled();
      if (!prototypes.contains(compiled.objectKey())) continue;
      var object = model.require(compiled.objectKey());
      if (compiled.intent().filters().stream().anyMatch(filter -> object.findProperty(filter.member()).isEmpty())) continue;
      String time = compiled.intent().time().dimension();
      if (time == null || time.isBlank()) time = object.defaultTimeProperty();
      if (time != null && object.findProperty(time).isEmpty()) continue;
      List<QueryIntent.Filter> filters = new ArrayList<>(compiled.intent().filters());
      if (time != null && !compiled.range().allData()) {
        filters.add(new QueryIntent.Filter(time, QueryIntent.Operator.GTE,
            List.of(compiled.range().from().atStartOfDay(compiled.zone()).toOffsetDateTime().toString())));
        filters.add(new QueryIntent.Filter(time, QueryIntent.Operator.LT,
            List.of(compiled.range().to().plusDays(1).atStartOfDay(compiled.zone()).toOffsetDateTime().toString())));
      }
      if (filters.size() > 10) continue;
      blocks.add(Map.of("type", "object-browser", "title", query.label() + " · 对象范围", "role", "supporting",
          "datasetVersionSetId", datasetVersionSetId, "objectKey", object.key(), "filters", List.copyOf(filters),
          "scopeDescription", "本次查询当前期的对象范围；不按聚合分组、排名或结果条数截取。"));
    }
    return List.copyOf(blocks);
  }

  private static Map<String, Object> block(ExecutedQuery query, String viz, String role) {
    List<Column> columns = query.compiled().columns();
    List<Column> dimensions = columns.stream().filter(column -> column.kind() == ColumnKind.DIMENSION).toList();
    List<Column> measures = columns.stream().filter(column -> column.kind() == ColumnKind.MEASURE).toList();
    Column time = columns.stream().filter(column -> column.kind() == ColumnKind.TIME).findFirst().orElse(null);
    List<Map<String, Object>> rows = query.result().rows();
    List<Map<String, Object>> compareRows = query.result().compareRows();
    String title = query.label();
    if ("table".equals(viz)) return table(title, role, columns, rows);
    if (dimensions.isEmpty() && time == null && rows.size() == 1) {
      return kvList(title, role, measures, rows.getFirst(), compareRows.isEmpty() ? null : compareRows.getFirst());
    }
    if (compareRows.isEmpty() && time != null && dimensions.isEmpty()) {
      Map<String, Object> chart = chart(title, role, "line", time, measures, rows);
      if (chart != null) return chart;
    }
    if (compareRows.isEmpty() && time == null && dimensions.size() == 1) {
      String type = "pie".equals(viz) && measures.size() == 1 ? "pie" : "bar";
      Map<String, Object> chart = chart(title, role, type, dimensions.getFirst(), measures, rows);
      if (chart != null) return chart;
    }
    return table(title, role, columns, rows);
  }

  private static Map<String, Object> kvList(String title, String role, List<Column> measures,
                                            Map<String, Object> row, Map<String, Object> compare) {
    List<Map<String, Object>> items = new ArrayList<>();
    for (Column measure : measures) {
      items.add(Map.of("label", measure.label(), "value", text(row.get(measure.key()))));
      if (compare != null) {
        items.add(Map.of("label", measure.label() + "（对比期）", "value", text(compare.get(measure.key()))));
      }
    }
    return Map.of("type", "kv-list", "title", title, "role", role, "items", List.copyOf(items));
  }

  /** 任一数据点非有限数值时返回 null，由调用方退回表格。 */
  private static Map<String, Object> chart(String title, String role, String type, Column axis,
                                           List<Column> measures, List<Map<String, Object>> rows) {
    if ("pie".equals(type) && measures.size() != 1) return null;
    List<Map<String, Object>> series = new ArrayList<>();
    for (Column measure : measures) {
      List<Map<String, Object>> points = new ArrayList<>();
      for (Map<String, Object> row : rows) {
        if (!(row.get(measure.key()) instanceof Number number) || !Double.isFinite(number.doubleValue())) return null;
        points.add(Map.of("label", text(row.get(axis.key())), "value", number));
      }
      series.add(Map.of("name", measure.label(), "points", List.copyOf(points)));
    }
    return Map.of("type", "chart", "title", title, "role", role, "chartType", type, "series", List.copyOf(series));
  }

  private static Map<String, Object> table(String title, String role, List<Column> columns,
                                           List<Map<String, Object>> rows) {
    List<List<String>> cells = rows.stream()
        .limit(EasyVSemanticAgent.EVIDENCE_ROW_CAP)
        .map(row -> columns.stream().map(column -> text(row.get(column.key()))).toList())
        .toList();
    return Map.of("type", "table", "title", title, "role", role,
        "columns", columns.stream().map(Column::label).toList(), "rows", cells);
  }

  private static String text(Object value) {
    if (value == null) return EMPTY;
    String text = value.toString();
    return text.isBlank() ? EMPTY : text;
  }
}
