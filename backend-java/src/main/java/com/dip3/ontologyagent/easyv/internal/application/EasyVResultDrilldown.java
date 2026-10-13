package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.easyv.internal.application.EasyVSemanticAgent.ExecutedQuery;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVOntologyModel;
import com.dip3.ontologyagent.semantic.api.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.*;

/** 统计项到对象范围的确定性绑定；由结果生成，随完成快照保存，读取时只接受绑定 ID。 */
final class EasyVResultDrilldown {
  private static final Set<String> OBJECTS = EasyVOntologyModel.READABLE_OBJECT_KEYS;
  private static final ObjectMapper JSON = new ObjectMapper();
  private EasyVResultDrilldown() {}

  record Binding(String id, int row, int column, String objectKey, String scopeDescription,
                 List<QueryIntent.Filter> filters) {
    String metricKey() { return id.substring(id.lastIndexOf(':') + 1); }
  }

  static Binding saved(Object value) { return JSON.convertValue(value, Binding.class); }

  static List<QueryIntent.Filter> objectFilters(CompiledSemanticQuery query, OntologyObjectType object, SemanticModel model) {
    return objectFilters(query, object, model, query.range());
  }

  private static boolean supportedProperty(OntologyObjectType object, SemanticModel model, String member) {
    String[] path = member.split("\\.", -1);
    if (path.length == 1) return object.findProperty(path[0]).filter(property -> !property.detailOnly()).isPresent();
    if (path.length != 2) return false;
    return object.links().stream().filter(link -> link.key().equals(path[0]) && OBJECTS.contains(link.targetObjectKey()))
        .anyMatch(link -> model.require(link.targetObjectKey()).findProperty(path[1]).filter(property -> !property.detailOnly()).isPresent());
  }

  private static List<QueryIntent.Filter> objectFilters(CompiledSemanticQuery query, OntologyObjectType object,
                                                        SemanticModel model, ResolvedTimeRange range) {
    if (query.intent().filters().stream().anyMatch(filter -> !supportedProperty(object, model, filter.member()))) return null;
    String time = query.intent().time().dimension();
    if (time == null || time.isBlank()) time = object.defaultTimeProperty();
    if (time != null && !supportedProperty(object, model, time)) return null;
    List<QueryIntent.Filter> filters = new ArrayList<>(query.intent().filters());
    if (time != null && !range.allData()) {
      filters.add(new QueryIntent.Filter(time, QueryIntent.Operator.GTE,
          List.of(range.from().atStartOfDay(query.zone()).toOffsetDateTime().toString())));
      filters.add(new QueryIntent.Filter(time, QueryIntent.Operator.LT,
          List.of(range.to().plusDays(1).atStartOfDay(query.zone()).toOffsetDateTime().toString())));
    }
    return filters.size() > 10 ? null : filters;
  }

  private static ResolvedTimeRange bucket(CompiledSemanticQuery query, ResolvedTimeRange period, Object value) {
    if (!(value instanceof String text)) return null;
    try {
      // Cube 的无偏移时间按查询时区解释；带偏移时间先转为相同业务时区。
      LocalDate start;
      if (text.length() == 10) start = LocalDate.parse(text);
      else {
        var parsed = DateTimeFormatter.ISO_DATE_TIME.parseBest(text, ZonedDateTime::from, LocalDateTime::from);
        start = parsed instanceof ZonedDateTime zoned ? zoned.withZoneSameInstant(query.zone()).toLocalDate()
            : ((LocalDateTime) parsed).toLocalDate();
      }
      LocalDate end = switch (QueryIntent.Granularity.valueOf(query.granularity().toUpperCase(Locale.ROOT))) {
        case DAY -> start.plusDays(1);
        case WEEK -> start.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).plusWeeks(1);
        case MONTH -> start.withDayOfMonth(1).plusMonths(1);
        case QUARTER -> start.withMonth((start.getMonthValue() - 1) / 3 * 3 + 1).withDayOfMonth(1).plusMonths(3);
        case YEAR -> start.withDayOfYear(1).plusYears(1);
      };
      LocalDate expected = switch (QueryIntent.Granularity.valueOf(query.granularity().toUpperCase(Locale.ROOT))) {
        case DAY -> end.minusDays(1); case WEEK -> end.minusWeeks(1); case MONTH -> end.minusMonths(1);
        case QUARTER -> end.minusMonths(3); case YEAR -> end.minusYears(1);
      };
      if (!start.equals(expected)) return null;
      LocalDate from = !period.allData() && period.from().isAfter(start) ? period.from() : start;
      LocalDate to = !period.allData() && period.to().isBefore(end.minusDays(1)) ? period.to() : end.minusDays(1);
      return from.isAfter(to) ? null : new ResolvedTimeRange(from, to, false, "所选时间段");
    } catch (DateTimeException | IllegalArgumentException invalid) { return null; }
  }

  static void attach(Map<String, Object> block, ExecutedQuery executed, SemanticModel model, String set) {
    var query = executed.compiled();
    if (!OBJECTS.contains(query.objectKey())) return;
    var object = model.require(query.objectKey());
    var columns = query.columns();
    var measures = columns.stream().filter(c -> c.kind() == CompiledSemanticQuery.ColumnKind.MEASURE).toList();
    var dimensions = columns.stream().filter(c -> c.kind() == CompiledSemanticQuery.ColumnKind.DIMENSION).toList();
    if (objectFilters(query, object, model) == null || dimensions.stream().anyMatch(c -> !supportedProperty(object, model, c.key()))) {
      block.put("drilldownUnavailableReason", "这项统计的筛选条件过多，或含有无法定位到记录的条件，暂不能精确打开对应记录。"); return;
    }
    List<Binding> bindings = new ArrayList<>();
    int currentRows = Math.min(executed.result().rows().size(), EasyVSemanticAgent.EVIDENCE_ROW_CAP);
    for (int period = 0; period < (query.compareRange() == null ? 1 : 2); period++) {
      var rows = period == 0 ? executed.result().rows() : executed.result().compareRows();
      var range = period == 0 ? query.range() : query.compareRange();
      int rowLimit = "table".equals(block.get("type")) ? Math.min(rows.size(), EasyVSemanticAgent.EVIDENCE_ROW_CAP) : rows.size();
      for (int rowIndex = 0; rowIndex < rowLimit; rowIndex++) {
        var row = rows.get(rowIndex);
        var selectedRange = query.granularity() == null ? range : bucket(query, range, row.get("time"));
        if (selectedRange == null) continue;
        var base = objectFilters(query, object, model, selectedRange);
        if (base == null) continue;
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
          var property = model.resolve(object.key(), dimension.key()).property();
          groups.add(property.identifier() ? "按" + dimension.label() + "分组"
              : dimension.label() + "：" + (value == null ? "未提供" : property.valueLabels().getOrDefault(text, text)));
        }
        if (!valid || filters.size() > 10) continue;
        for (var measure : measures) {
          if (!(row.get(measure.key()) instanceof Number number) || !Double.isFinite(number.doubleValue())) continue;
          var metric = object.findMetric(measure.key()).orElseThrow();
          if ((metric.aggregation() == OntologyMetric.Aggregation.COUNT || metric.aggregation() == OntologyMetric.Aggregation.COUNT_DISTINCT)
              && (number.doubleValue() < 0 || number.doubleValue() != Math.rint(number.doubleValue()))) continue;
          int column, displayRow = rowIndex;
          switch ((String) block.get("type")) {
            case "table" -> { column = columns.indexOf(measure) + (query.compareRange() != null ? 1 : 0); displayRow += period == 0 ? 0 : currentRows; }
            case "chart" -> column = measures.indexOf(measure);
            case "kv-list" -> { column = measures.indexOf(measure) * (executed.result().compareRows().isEmpty() ? 1 : 2) + period; displayRow = 0; }
            default -> { continue; }
          }
          String description = "参与“" + measure.label() + "”计算的" + object.label()
              + (groups.isEmpty() ? "" : " · " + String.join("，", groups))
              + "；统计值 " + number + "；" + (period == 1 ? "对比期 · " : "") + selectedRange.description();
          if (!measure.key().equals("count")) description += "。这些是计算依据，记录条数不等于该指标值。";
          bindings.add(new Binding(executed.id() + (period == 1 ? ":compare" : "") + ":" + rowIndex + ":" + measure.key(),
              displayRow, column, object.key(), description, List.copyOf(filters)));
        }
      }
    }
    if (bindings.isEmpty()) { block.put("drilldownUnavailableReason", "此结果无法生成精确对象下钻条件。"); return; }
    block.put("datasetVersionSetId", set);
    block.put("drilldowns", List.copyOf(bindings));
  }
}
