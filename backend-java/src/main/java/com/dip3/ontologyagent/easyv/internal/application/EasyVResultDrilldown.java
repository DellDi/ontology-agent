package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.easyv.internal.application.EasyVSemanticAgent.ExecutedQuery;
import com.dip3.ontologyagent.semantic.api.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;

/** 统计项到冻结对象范围的确定性绑定；由结果生成，随完成快照保存，读取时只接受绑定 ID。 */
final class EasyVResultDrilldown {
  private static final Set<String> OBJECTS = Set.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component");
  private static final ObjectMapper JSON = new ObjectMapper();
  private EasyVResultDrilldown() {}

  record Binding(String id, int row, int column, String objectKey, String scopeDescription,
                 List<QueryIntent.Filter> filters) {}

  static Binding saved(Object value) {
    return JSON.convertValue(value, Binding.class);
  }

  static List<QueryIntent.Filter> objectFilters(CompiledSemanticQuery query, OntologyObjectType object) {
    if (query.intent().filters().stream().anyMatch(filter -> object.findProperty(filter.member()).isEmpty())) return null;
    String time = query.intent().time().dimension();
    if (time == null || time.isBlank()) time = object.defaultTimeProperty();
    if (time != null && object.findProperty(time).isEmpty()) return null;
    List<QueryIntent.Filter> filters = new ArrayList<>(query.intent().filters());
    if (time != null && !query.range().allData()) {
      filters.add(new QueryIntent.Filter(time, QueryIntent.Operator.GTE,
          List.of(query.range().from().atStartOfDay(query.zone()).toOffsetDateTime().toString())));
      filters.add(new QueryIntent.Filter(time, QueryIntent.Operator.LT,
          List.of(query.range().to().plusDays(1).atStartOfDay(query.zone()).toOffsetDateTime().toString())));
    }
    return filters.size() > 10 ? null : filters;
  }

  static void attach(Map<String, Object> block, ExecutedQuery executed, SemanticModel model, String set) {
    var query = executed.compiled();
    if (!OBJECTS.contains(query.objectKey())) return;
    var object = model.require(query.objectKey());
    var base = objectFilters(query, object);
    var columns = query.columns();
    var count = columns.stream().filter(c -> c.kind() == CompiledSemanticQuery.ColumnKind.MEASURE && c.key().equals("count")).findFirst();
    var dimensions = columns.stream().filter(c -> c.kind() == CompiledSemanticQuery.ColumnKind.DIMENSION).toList();
    // 本轮只开放三个对象的实例 count，不能把 SUM/去重签名数对应到根对象数量。
    String unsupported = count.isEmpty() ? "此指标暂不支持精确对象下钻。"
        : query.granularity() != null ? "时间分桶暂不支持精确对象下钻。"
        : base == null || dimensions.stream().anyMatch(c -> object.findProperty(c.key()).isEmpty())
          ? "此查询的关联条件或过滤数量暂不支持精确对象下钻。" : null;
    if (unsupported != null) { block.put("drilldownUnavailableReason", unsupported); return; }
    List<Binding> bindings = new ArrayList<>();
    var rows = executed.result().rows();
    int rowLimit = "table".equals(block.get("type")) ? Math.min(rows.size(), EasyVSemanticAgent.EVIDENCE_ROW_CAP) : rows.size();
    for (int rowIndex = 0; rowIndex < rowLimit; rowIndex++) {
      var row = rows.get(rowIndex);
      if (!(row.get("count") instanceof Number number) || !Double.isFinite(number.doubleValue())
          || number.doubleValue() < 0 || number.doubleValue() != Math.rint(number.doubleValue())) continue;
      List<QueryIntent.Filter> filters = new ArrayList<>(base);
      List<String> groups = new ArrayList<>();
      boolean valid = true;
      for (var dimension : dimensions) {
        if (!row.containsKey(dimension.key())) { valid = false; break; }
        Object value = row.get(dimension.key());
        String text = value == null ? null : value.toString();
        if (text != null && (text.isBlank() || text.length() > 500)) { valid = false; break; }
        filters.add(new QueryIntent.Filter(dimension.key(), value == null ? QueryIntent.Operator.NOT_SET : QueryIntent.Operator.EQUALS,
            value == null ? List.of() : List.of(text)));
        groups.add(dimension.label() + "：" + (value == null ? "未提供" : text));
      }
      if (!valid || filters.size() > 10) continue;
      int column;
      switch ((String) block.get("type")) {
        case "table" -> column = columns.indexOf(count.get()) + (query.compareRange() != null ? 1 : 0);
        case "chart" -> column = columns.stream().filter(c -> c.kind() == CompiledSemanticQuery.ColumnKind.MEASURE).toList().indexOf(count.get());
        case "kv-list" -> column = columns.stream().filter(c -> c.kind() == CompiledSemanticQuery.ColumnKind.MEASURE).toList().indexOf(count.get())
            * (executed.result().compareRows().isEmpty() ? 1 : 2);
        default -> { continue; }
      }
      String description = (groups.isEmpty() ? object.label() + " · 当前查询范围" : String.join("，", groups))
          + " · " + count.get().label() + " " + number + "；" + query.range().description();
      bindings.add(new Binding(executed.id() + ":" + rowIndex + ":count", rowIndex, column, object.key(), description, List.copyOf(filters)));
    }
    if (bindings.isEmpty()) { block.put("drilldownUnavailableReason", "此结果无法生成精确对象下钻条件。"); return; }
    block.put("datasetVersionSetId", set);
    block.put("drilldowns", List.copyOf(bindings));
  }
}
