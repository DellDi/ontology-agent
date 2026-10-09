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
 * 查询结果 → 前端渲染块：结合本体语义、实际分布与规模选择默认视图；
 * 模型可建议合法视图，不能更改数据、结果范围或精确对象绑定。选择随执行快照保存。
 */
final class EasyVRenderBlocks {
  private static final String EMPTY = "—";

  private EasyVRenderBlocks() {}

  static List<Map<String, Object>> build(List<ExecutedQuery> executed, List<Highlight> highlights,
                                        SemanticModel model, String datasetVersionSetId) {
    Map<String, String> vizByQuery = new LinkedHashMap<>();
    for (Highlight highlight : highlights) {
      if (highlight.query() != null && highlight.viz() != null) vizByQuery.putIfAbsent(highlight.query(), highlight.viz());
    }
    List<Map<String, Object>> blocks = new ArrayList<>();
    for (ExecutedQuery query : executed) {
      if (query.result().rows().isEmpty() && query.result().compareRows().isEmpty()) continue;
      String viz = vizByQuery.get(query.id());
      boolean primary = vizByQuery.isEmpty() ? blocks.isEmpty() : viz != null && !"none".equals(viz);
      Map<String, Object> rendered = new LinkedHashMap<>(block(query, viz, primary ? "primary" : "supporting", model));
      EasyVResultDrilldown.attach(rendered, query, model, datasetVersionSetId);
      blocks.add(rendered);
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
      List<QueryIntent.Filter> filters = EasyVResultDrilldown.objectFilters(compiled, object);
      if (filters == null) continue;
      blocks.add(Map.of("type", "object-browser", "title", query.label() + " · 对象范围", "role", "supporting",
          "datasetVersionSetId", datasetVersionSetId, "objectKey", object.key(), "filters", List.copyOf(filters),
          "scopeDescription", "本次查询当前期的对象范围；不按聚合分组、排名或结果条数截取。"));
    }
    return List.copyOf(blocks);
  }

  private static Map<String, Object> block(ExecutedQuery query, String viz, String role, SemanticModel model) {
    List<Column> columns = query.compiled().columns();
    List<Column> dimensions = columns.stream().filter(column -> column.kind() == ColumnKind.DIMENSION).toList();
    List<Column> measures = columns.stream().filter(column -> column.kind() == ColumnKind.MEASURE).toList();
    Column time = columns.stream().filter(column -> column.kind() == ColumnKind.TIME).findFirst().orElse(null);
    List<Map<String, Object>> rows = query.result().rows();
    List<Map<String, Object>> compareRows = query.result().compareRows();
    String title = query.label();
    if ("table".equals(viz)) return table(query, role, "按问题意图展示明细，保留原始字段与数值。");
    if (dimensions.isEmpty() && time == null && rows.size() == 1) {
      return kvList(title, role, measures, rows.getFirst(), compareRows.isEmpty() ? null : compareRows.getFirst());
    }
    if (rows.size() > EasyVSemanticAgent.EVIDENCE_ROW_CAP) {
      return table(query, role, "结果较多，使用表格预览，避免将所有记录挤入图表。");
    }
    if ("none".equals(viz)) return table(query, role, "此结果作为支撑明细，不强制生成图表。");
    if (!compareRows.isEmpty()) return table(query, role, "当前期与对比期分别列出，保留实际分组与数值。");
    boolean trend = time != null && dimensions.isEmpty();
    boolean categories = time == null && dimensions.size() == 1;
    if ((!trend && !categories) || measures.isEmpty()) {
      return table(query, role, "多维结果或无数值指标，使用表格保留明细。");
    }
    Column axis = trend ? time : dimensions.getFirst();
    String type = viz == null ? (trend ? "line" : "bar") : viz;
    if (!Set.of("bar", "line", "pie").contains(type)
        || ("line".equals(type) && !trend) || ("bar".equals(type) && !categories)) {
      return table(query, role, "建议的图表与结果形状不匹配，使用表格保留真实结果。");
    }
    if (viz == null) {
      if (categories && measures.size() != 1) return table(query, role, "多个指标使用表格分别呈现，避免混用刻度。");
      if (rows.size() < 2) return table(query, role, "仅有一个分组或时间点，使用明细呈现。");
      if (categories && model.resolve(query.compiled().objectKey(), axis.key()).property().identifier()) {
        return table(query, role, "分组字段是标识符，使用表格便于识别和查看对应对象。");
      }
      if (categories && constant(measures, rows)) {
        return table(query, role, "已返回分组的数值没有差异，使用明细便于查看对象。");
      }
    }
    if ("pie".equals(type) && (!categories || !pieEligible(query, measures, rows, model))) {
      return table(query, role, "占比图需要完整分组和可相加的非负数值；当前结果不满足条件。");
    }
    Map<String, Object> chart = chart(title, role, type, axis, measures, rows);
    return chart != null ? chart : table(query, role, "存在缺失或非数值数据，使用表格保留原值，不以零替代。");
  }

  private static boolean constant(List<Column> measures, List<Map<String, Object>> rows) {
    return measures.stream().allMatch(measure -> {
      Object first = rows.getFirst().get(measure.key());
      return first instanceof Number number && Double.isFinite(number.doubleValue())
          && rows.stream().allMatch(row -> row.get(measure.key()) instanceof Number value
              && Double.isFinite(value.doubleValue()) && value.doubleValue() == number.doubleValue());
    });
  }

  private static boolean pieEligible(ExecutedQuery query, List<Column> measures, List<Map<String, Object>> rows,
                                     SemanticModel model) {
    Integer limit = query.compiled().intent().limit();
    if (measures.size() != 1 || (limit != null && rows.size() >= limit)) return false;
    var object = model.require(query.compiled().objectKey());
    if (query.compiled().intent().dimensions().stream().anyMatch(key -> object.findProperty(key).isEmpty())) return false;
    if (query.compiled().intent().filters().stream().anyMatch(filter -> object.findProperty(filter.member()).isEmpty())) return false;
    var metric = object.findMetric(measures.getFirst().key()).orElseThrow();
    boolean instanceCount = metric.aggregation() == OntologyMetric.Aggregation.COUNT_DISTINCT
        && metric.expression().equals(object.primaryKey().sql());
    if (!instanceCount && metric.aggregation() != OntologyMetric.Aggregation.COUNT && metric.aggregation() != OntologyMetric.Aggregation.SUM) return false;
    double total = 0;
    for (var row : rows) {
      if (!(row.get(measures.getFirst().key()) instanceof Number value)
          || !Double.isFinite(value.doubleValue()) || value.doubleValue() < 0) return false;
      total += value.doubleValue();
    }
    return Double.isFinite(total) && total > 0;
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
    if (measures.isEmpty() || ("pie".equals(type) && measures.size() != 1)) return null;
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

  private static Map<String, Object> table(ExecutedQuery query, String role, String reason) {
    var columns = query.compiled().columns();
    var rows = query.result().rows();
    var compareRows = query.result().compareRows();
    boolean comparing = query.compiled().compareRange() != null;
    List<String> labels = new ArrayList<>();
    if (comparing) labels.add("期间");
    labels.addAll(columns.stream().map(Column::label).toList());
    List<List<String>> cells = new ArrayList<>();
    for (int period = 0; period < (comparing ? 2 : 1); period++) {
      String range = period == 0 ? query.compiled().range().description() : query.compiled().compareRange().description();
      for (var row : (period == 0 ? rows : compareRows).stream().limit(EasyVSemanticAgent.EVIDENCE_ROW_CAP).toList()) {
        List<String> values = new ArrayList<>();
        if (comparing) values.add((period == 0 ? "当前期 · " : "对比期 · ") + range);
        values.addAll(columns.stream().map(column -> text(row.get(column.key()))).toList());
        cells.add(List.copyOf(values));
      }
    }
    int returned = rows.size() + (comparing ? compareRows.size() : 0);
    String preview = returned > cells.size()
        ? " 本查询返回 " + returned + " 个结果行，当前预览 " + cells.size() + " 行；结果行数不是全量对象数。" : "";
    return Map.of("type", "table", "title", query.label(), "role", role, "presentationReason", reason + preview,
        "columns", List.copyOf(labels), "rows", List.copyOf(cells));
  }

  private static String text(Object value) {
    if (value == null) return EMPTY;
    String text = value.toString();
    return text.isBlank() ? EMPTY : text;
  }
}
