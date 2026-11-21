package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Citation;
import com.dip3.ontologyagent.easyv.internal.application.EasyVObjectReadService.ObjectTypeView;
import com.dip3.ontologyagent.easyv.internal.application.EasyVObjectReadService.PropertyView;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVOntologyModel;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVUserInputPresentation;
import com.dip3.ontologyagent.easyv.internal.domain.GenerationQualityEvidenceParser;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeStructureParser;
import com.dip3.ontologyagent.semantic.api.OntologyLink;
import com.dip3.ontologyagent.semantic.api.OntologyProperty;
import com.dip3.ontologyagent.support.BackendException;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 原文对照（source-comparison）与记录回看（record-review）的确定性渲染及文本逐字引文校验：
 * 由程序读取已授权对象字段并生成 Markdown 与 Citation，避免模型自由摘要或改写原话。
 */
final class EasyVRecordReviewRenderer {

  private static final Pattern MARKDOWN_SPECIAL = Pattern.compile("[\\\\`*_\\[\\]#.!|+~\\-]");

  private EasyVRecordReviewRenderer() {}

  static String renderComparison(Map<?, ?> comparison, List<Map<String, Object>> results, List<Citation> citations) {
    if (!comparison.keySet().equals(Set.of("kind", "pairs"))
        || !"source-comparison".equals(comparison.get("kind"))
        || !(comparison.get("pairs") instanceof List<?> pairs) || pairs.isEmpty()) {
      throw new BackendException("EASYV_ANSWER_INVALID", "原文对照只接受 kind 与非空 pairs，不接受自由摘要或结论。");
    }
    StringBuilder answer = new StringBuilder("以下并列展示已读记录中的原文摘录，供逐项核对。\n\n");
    for (var item : pairs) {
      if (!(item instanceof Map<?, ?> pair) || !pair.keySet().equals(Set.of("left", "right"))
          || !(pair.get("left") instanceof Map<?, ?> left) || !(pair.get("right") instanceof Map<?, ?> right)) {
        throw new BackendException("EASYV_ANSWER_INVALID", "每组原文对照必须包含 left 与 right 两份来源摘录。");
      }
      answer.append(renderExcerpt(left, results, citations));
      answer.append(renderExcerpt(right, results, citations)).append("---\n\n");
    }
    return answer.append("以上仅展示记录中的文字，不能据此直接认定理解错误、系统自行扩展或漏解。完整模型输入与实际生成结果仍需一并核对。").toString();
  }

  static String renderReview(Map<?, ?> review, List<Map<String, Object>> results,
                             List<Citation> citations, String dataScope) {
    if (!review.keySet().equals(Set.of("kind", "sections"))
        || !(review.get("sections") instanceof List<?> sections) || sections.isEmpty()) {
      throw new BackendException("EASYV_ANSWER_INVALID", "记录回看只接受 kind 与非空 sections，禁止自由摘要。");
    }
    StringBuilder answer = new StringBuilder();
    boolean excerpt = false;
    for (var item : sections) {
      if (!(item instanceof Map<?, ?> section)) throw invalidReview();
      if ("timeline".equals(section.get("kind"))) {
        answer.append(renderTimeline(section, results, citations));
        excerpt = true;
        continue;
      }
      if ("example".equals(section.get("kind"))) {
        answer.append(renderExample(section, results, citations));
        excerpt = true;
        continue;
      }
      if ("excerpt".equals(section.get("kind"))) {
        if (!section.keySet().equals(Set.of("kind", "source")) || !(section.get("source") instanceof Map<?, ?> source)) {
          throw invalidReview();
        }
        answer.append(renderExcerpt(source, results, citations));
        excerpt = true;
        continue;
      }
      answer.append(renderCountsOrRecords(section, results, citations));
    }
    if (hasTextEvidence(results) && !excerpt) {
      throw new BackendException("EASYV_ANSWER_INVALID", "已读取原文的记录回看缺少原文摘录。");
    }
    return answer.append("分类和处理记录不能证明屏幕已按诉求改变；另存标记只对应当时的反馈，不能据此确认最终版本是否另存。\n\n数据范围：")
        .append(literal(dataScope)).toString();
  }

  private static String renderCountsOrRecords(Map<?, ?> section, List<Map<String, Object>> results, List<Citation> citations) {
    boolean counts = "counts".equals(section.get("kind"));
    if ((!counts && !"records".equals(section.get("kind")))
        || !section.keySet().equals(counts ? Set.of("kind", "query", "fields") : Set.of("kind", "query", "fields", "rows"))) {
      throw invalidReview();
    }
    var result = results.stream().filter(r -> Objects.equals(r.get("id"), section.get("query")))
        .findFirst().orElseThrow(EasyVRecordReviewRenderer::invalidReview);
    var rows = maps(result.get("rows"));
    var fields = strings(section.get("fields"));
    if (fields.isEmpty() || fields.size() != ((List<?>) section.get("fields")).size() || rows.isEmpty()) {
      throw invalidReview();
    }
    var properties = fields.stream().map(field -> reviewProperty(result, field)).toList();
    boolean metrics = !(result.get("objectType") instanceof ObjectTypeView);
    if (counts && (metrics || properties.stream().anyMatch(p -> p.valueLabels().isEmpty()))) {
      throw invalidReview();
    }
    StringBuilder answer = new StringBuilder();
    answer.append("**").append(literal(result.get("objectType") instanceof ObjectTypeView type ? type.label() : text(result.get("label"))))
        .append(counts ? " · 已读记录统计**\n\n" : metrics ? " · 统计结果**\n\n" : " · 已读记录**\n\n");
    answer.append("| ").append(String.join(" | ", properties.stream().map(p -> literal(p.label())).toList()));
    if (counts) answer.append(" | 记录数");
    answer.append(" |\n|").append(" --- |".repeat(fields.size() + (counts ? 1 : 0))).append("\n");
    Map<List<String>, Integer> groups = new LinkedHashMap<>();
    List<?> selected = counts ? java.util.stream.IntStream.range(0, rows.size()).boxed().toList()
        : section.get("rows") instanceof List<?> indexes ? indexes : List.of();
    if (selected.isEmpty()) throw invalidReview();
    Set<Integer> visited = new HashSet<>();
    for (var index : selected) {
      if (!(index instanceof Number number) || number.doubleValue() != number.intValue()
          || number.intValue() < 0 || number.intValue() >= rows.size() || !visited.add(number.intValue())) {
        throw invalidReview();
      }
      int row = number.intValue();
      List<String> values = new ArrayList<>();
      for (var property : properties) {
        Object value = rows.get(row).get(property.key());
        values.add(reviewValue(property, value));
        if (value != null && (!(value instanceof String text) || !text.isBlank())) {
          citations.add(new Citation(text(result.get("id")), row, property.key()));
        }
      }
      if (counts) groups.merge(values, 1, Integer::sum);
      else answer.append("| ").append(String.join(" | ", values)).append(" |\n");
    }
    if (counts) {
      groups.forEach((values, count) -> answer.append("| ").append(String.join(" | ", values)).append(" | ").append(count).append(" |\n"));
    }
    if (metrics) {
      answer.append("\n本表展示本次统计返回的 ").append(rows.size()).append(" 行中的 ").append(selected.size())
          .append(" 行；每行是统计结果，不是对象明细条数。\n");
      if (result.get("intent") instanceof Map<?, ?> intent && intent.get("limit") instanceof Number limit) {
        answer.append("排名范围：前 ").append(limit.intValue()).append(" 组，不能据此计算全部对象数量或占比。\n");
      }
      if (result.get("totalRows") instanceof Number total && rows.size() < total.intValue()) {
        answer.append("统计结果已截取，另有 ").append(total.intValue() - rows.size()).append(" 行未提供给本次回答。\n");
      }
      answer.append("统计时间范围：").append(literal(text(result.get("range")))).append("。\n\n");
    } else {
      answer.append("\n本表基于本次读到的 ").append(rows.size()).append(" 条记录");
      if (!counts) answer.append("，展示其中 ").append(selected.size()).append(" 条");
      answer.append("；不代表未读取的记录。\n\n");
    }
    return answer.toString();
  }

  private static String renderExcerpt(Map<?, ?> source, List<Map<String, Object>> results, List<Citation> citations) {
    if ((!source.keySet().equals(Set.of("query", "row", "field", "quote")) && !source.keySet().equals(Set.of("query", "row", "field")))
        || !(source.get("row") instanceof Number row) || row.doubleValue() != row.intValue()
        || (source.containsKey("quote") && (!(source.get("quote") instanceof String quote) || quote.isBlank()))) {
      throw new BackendException("EASYV_ANSWER_INVALID", "原文摘录必须选择 query、row、field；短摘录须提供非空 quote。");
    }
    for (var result : results) {
      if (!Objects.equals(result.get("id"), source.get("query")) || !"read_object".equals(result.get("tool"))
          || !(result.get("objectType") instanceof ObjectTypeView type)) continue;
      var property = type.properties().stream().filter(p -> p.key().equals(source.get("field")))
          .findFirst().orElse(null);
      var rows = maps(result.get("rows"));
      if (property == null || !strings(result.get("textFields")).contains(property.key()) || property.identifier()
          || property.type() != OntologyProperty.Type.STRING || !property.valueLabels().isEmpty()
          || row.intValue() < 0 || row.intValue() >= rows.size()
          || !(rows.get(row.intValue()).get(property.key()) instanceof String original) || original.isEmpty()) break;
      String quote = source.containsKey("quote") ? (String) source.get("quote") : original;
      validateQuotedCitation(Map.of("query", source.get("query"), "row", row.intValue(), "field", property.key(), "quote", quote),
          row.intValue(), quote, results);
      citations.add(new Citation(text(source.get("query")), row.intValue(), property.key()));
      if (EasyVOntologyModel.QUALITY_NODE.key().equals(type.key())
          && GenerationQualityEvidenceParser.STRUCTURED_FIELDS.contains(property.key())) {
        if (quote.equals(original)) return renderUnderstanding(property, original, rows.get(row.intValue()), source, citations);
        try {
          if (GenerationQualityEvidenceParser.present(property.key(), original).stream().noneMatch(item -> item.value().contains(quote))) {
            throw new IllegalArgumentException("excerpt is not business text");
          }
        } catch (IllegalArgumentException error) {
          throw new BackendException("EASYV_ANSWER_INVALID",
              "结构化理解摘录须为单个业务文本值中的连续文字，不能含 JSON 字段名或内部编号；可仅选择 query、row、field 展示完整字段。", error);
        }
      }
      if (EasyVOntologyModel.PROTOTYPE_LAYOUT.key().equals(type.key()) && "pageSemantics".equals(property.key())) {
        try {
          var items = PrototypeStructureParser.presentPages(original);
          if (!quote.equals(original) && items.stream().noneMatch(item -> item.value().contains(quote))) {
            throw new IllegalArgumentException("excerpt is not business text");
          }
          if (quote.equals(original)) {
            StringBuilder answer = new StringBuilder("**页面与主视觉**\n\n这是源原型的设计文案，不代表实际数据或最终效果已核实。\n\n");
            for (var item : items) answer.append("**").append(literal(item.label())).append("**\n\n").append(quotedText(item.value()));
            return answer.append("<details><summary>查看完整源记录</summary>\n\n").append(quotedText(original)).append("</details>\n\n").toString();
          }
        } catch (IllegalArgumentException error) {
          throw new BackendException("EASYV_ANSWER_INVALID", "页面文案须选完整字段或单个业务文本的连续摘录，不能展示 JSON 字段名与标识。", error);
        }
      }
      if (EasyVOntologyModel.FEEDBACK.key().equals(type.key()) && "userInput".equals(property.key())) {
        var display = EasyVUserInputPresentation.present(quote);
        if (display.unresolvedReference()) {
          return "**" + literal(property.label()) + "**\n\n引用标记缺少名称或格式无法识别，以下保留源记录，未猜测选中对象。\n\n"
              + quotedText(quote);
        }
        if (!display.text().equals(quote)) {
          return "**" + literal(property.label()) + "（选中对象以名称显示）**\n\n" + quotedText(display.text())
              + "<details><summary>查看完整源记录</summary>\n\n" + quotedText(original) + "</details>\n\n";
        }
      }
      return "**" + literal(property.label()) + "**\n\n> "
          + literal(quote).replace("\n", "  \n> ") + "\n\n";
    }
    throw new BackendException("EASYV_ANSWER_INVALID", "原文摘录必须引用已读对象详情中有值的非标识、非分类文本属性。");
  }

  private static String renderUnderstanding(PropertyView property, String original, Map<?, ?> values,
                                            Map<?, ?> source, List<Citation> citations) {
    StringBuilder answer = new StringBuilder("**").append(literal(property.label())).append("**\n\n");
    try {
      var items = GenerationQualityEvidenceParser.present(property.key(), original);
      String warning;
      if (values.get("truncatedFields") instanceof String truncated) {
        warning = GenerationQualityEvidenceParser.isTruncated(property.key(), truncated)
            ? "这部分内容已被截断，不能按完整记录判断。" : "这份记录未标记截断，但仍不包含完整的模型输入。";
        citations.add(new Citation(text(source.get("query")), ((Number) source.get("row")).intValue(), "truncatedFields"));
      } else {
        warning = "记录未说明是否截断，内容完整性待核实。";
      }
      answer.append("这是系统当时的理解，是否理解正确、是否落实还需核对。\n\n").append(warning).append("\n\n");
      for (var item : items) answer.append("**").append(literal(item.label())).append("**\n\n").append(quotedText(item.value()));
    } catch (IllegalArgumentException error) {
      answer.append("理解记录或截断信息的格式无法识别，未生成业务解释；请展开源记录核对。\n\n");
    }
    return answer.append("<details><summary>查看完整源记录</summary>\n\n").append(quotedText(original)).append("</details>\n\n").toString();
  }

  private static String renderExample(Map<?, ?> section, List<Map<String, Object>> results, List<Citation> citations) {
    if (!"example".equals(section.get("kind")) || !(section.keySet().equals(Set.of("kind", "query", "row", "fields", "excerpts"))
        || section.keySet().equals(Set.of("kind", "query", "row", "fields", "excerpts", "related")))
        || !(section.get("row") instanceof Number row) || row.doubleValue() != row.intValue()
        || !(section.get("fields") instanceof List<?> fields) || fields.isEmpty()
        || !(section.get("excerpts") instanceof List<?> excerpts) || excerpts.isEmpty()) throw invalidReview();
    var result = results.stream().filter(r -> Objects.equals(r.get("id"), section.get("query")))
        .findFirst().orElseThrow(EasyVRecordReviewRenderer::invalidReview);
    var rows = maps(result.get("rows"));
    if (!"read_object".equals(result.get("tool")) || !(result.get("objectType") instanceof ObjectTypeView type)
        || row.intValue() < 0 || row.intValue() >= rows.size()) throw invalidReview();
    var values = rows.get(row.intValue());
    StringBuilder answer = new StringBuilder("**").append(literal(type.label())).append(" · 记录样例**\n\n");
    Set<String> selected = new HashSet<>();
    for (var field : fields) {
      if (!(field instanceof String key) || !selected.add(key) || strings(result.get("textFields")).contains(key)) throw invalidReview();
      var property = reviewProperty(result, key);
      Object value = values.get(key);
      answer.append(literal(property.label())).append("：").append(reviewValue(property, value)).append("  \n");
      if (value != null && (!(value instanceof String text) || !text.isBlank())) {
        citations.add(new Citation(text(result.get("id")), row.intValue(), key));
      }
    }
    answer.append("\n");
    if (section.containsKey("related")) answer.append(renderRelated(section.get("related"), result, values, results, citations));
    for (var item : excerpts) {
      if (!(item instanceof Map<?, ?> source) || !(source.get("field") instanceof String field) || !selected.add(field)) throw invalidReview();
      String quote;
      if (source.keySet().equals(Set.of("field")) && values.get(field) instanceof String original) quote = original;
      else if (source.keySet().equals(Set.of("field", "quote")) && source.get("quote") instanceof String chosen) quote = chosen;
      else throw invalidReview();
      answer.append(renderExcerpt(Map.of("query", result.get("id"), "row", row.intValue(), "field", field, "quote", quote), results, citations));
    }
    return answer.append("---\n\n").toString();
  }

  private static String renderTimeline(Map<?, ?> section, List<Map<String, Object>> results, List<Citation> citations) {
    if (!section.keySet().equals(Set.of("kind", "timeField", "entries"))
        || !(section.get("timeField") instanceof String timeField)
        || !(section.get("entries") instanceof List<?> entries) || entries.isEmpty()) throw invalidReview();
    Map<Map<?, ?>, OffsetDateTime> times = new LinkedHashMap<>();
    Set<List<Object>> selected = new HashSet<>();
    String objectKey = null;
    for (var item : entries) {
      if (!(item instanceof Map<?, ?> entry) || !(entry.get("row") instanceof Number row)
          || row.doubleValue() != row.intValue() || !strings(entry.get("fields")).contains(timeField)
          || !(entry.get("query") instanceof String query) || !selected.add(List.of(query, row.intValue()))) throw invalidReview();
      var result = results.stream().filter(r -> Objects.equals(r.get("id"), query))
          .findFirst().orElseThrow(EasyVRecordReviewRenderer::invalidReview);
      if (!(result.get("objectType") instanceof ObjectTypeView type)
          || reviewProperty(result, timeField).type() != OntologyProperty.Type.TIME
          || (objectKey != null && !objectKey.equals(type.key()))) throw invalidReview();
      objectKey = type.key();
      var rows = maps(result.get("rows"));
      if (row.intValue() < 0 || row.intValue() >= rows.size() || !(rows.get(row.intValue()).get(timeField) instanceof String timestamp)) {
        throw invalidReview();
      }
      try { times.put(entry, OffsetDateTime.parse(timestamp)); }
      catch (DateTimeParseException error) { throw invalidReview(); }
    }
    StringBuilder answer = new StringBuilder("以下按记录时间排列已读样例。时间先后不能证明是同一诉求的重试，也不能确认之前的需求已解决；操作日志时间可能是完成结算时间。\n\n");
    times.entrySet().stream().sorted(java.util.Comparator.comparing(e -> e.getValue().toInstant()))
        .forEach(e -> answer.append(renderExample(e.getKey(), results, citations)));
    return answer.append("本次展示 ").append(times.size()).append(" 个已读样例，不代表期间的全部操作。\n\n").toString();
  }

  private static String renderRelated(Object specification, Map<String, Object> source, Map<?, ?> sourceRow,
                                      List<Map<String, Object>> results, List<Citation> citations) {
    if (!(specification instanceof List<?> related) || related.isEmpty()) throw invalidReview();
    StringBuilder answer = new StringBuilder();
    Set<List<String>> selected = new HashSet<>();
    for (var item : related) {
      if (!(item instanceof Map<?, ?> selection) || !selection.keySet().equals(Set.of("relation", "query", "fields"))
          || !(selection.get("relation") instanceof String relation) || !(selection.get("query") instanceof String query)
          || !selected.add(List.of(relation, query))
          || !(selection.get("fields") instanceof List<?> fields) || fields.isEmpty()) throw invalidReview();
      var target = results.stream().filter(r -> Objects.equals(r.get("id"), selection.get("query")))
          .findFirst().orElseThrow(EasyVRecordReviewRenderer::invalidReview);
      if (!(target.get("objectType") instanceof ObjectTypeView type)
          || !Set.of("query_objects", "read_object", "traverse_objects").contains(target.get("tool"))) throw invalidReview();
      if (!(source.get("relationships") instanceof List<?> links)) throw invalidReview();
      var link = links.stream().filter(l -> l instanceof OntologyLink relationship
          && relationship.key().equals(selection.get("relation")) && relationship.targetObjectKey().equals(type.key()))
          .map(OntologyLink.class::cast).findFirst().orElseThrow(EasyVRecordReviewRenderer::invalidReview);
      Object sourceValue = sourceRow.get(link.sourceProperty());
      if (sourceValue == null || String.valueOf(sourceValue).isBlank()) throw invalidReview();
      List<PropertyView> properties = new ArrayList<>();
      Set<String> chosen = new HashSet<>();
      for (var field : fields) {
        if (!(field instanceof String key) || !chosen.add(key) || strings(target.get("textFields")).contains(key)) throw invalidReview();
        properties.add(reviewProperty(target, key));
      }
      var rows = maps(target.get("rows"));
      int matched = 0;
      answer.append("**关联的").append(literal(type.label())).append("**\n\n| ")
          .append(String.join(" | ", properties.stream().map(p -> literal(p.label())).toList()))
          .append(" |\n|").append(" --- |".repeat(properties.size())).append("\n");
      for (int row = 0; row < rows.size(); row++) {
        Object targetValue = rows.get(row).get(link.targetProperty());
        if (targetValue == null || !String.valueOf(sourceValue).equals(String.valueOf(targetValue))) continue;
        matched++;
        List<String> values = new ArrayList<>();
        for (var property : properties) {
          Object value = rows.get(row).get(property.key());
          values.add(reviewValue(property, value));
          if (value != null && (!(value instanceof String text) || !text.isBlank())) {
            citations.add(new Citation(text(target.get("id")), row, property.key()));
          }
        }
        answer.append("| ").append(String.join(" | ", values)).append(" |\n");
      }
      if (matched == 0) throw invalidReview();
      answer.append("\n本次查询找到 ").append(matched)
          .append(" 条关联记录；不代表该请求的全部处理过程。\n\n");
    }
    return answer.toString();
  }

  private static PropertyView reviewProperty(Map<String, Object> result, String field) {
    if (result.get("objectType") instanceof ObjectTypeView type) {
      return type.properties().stream().filter(p -> p.key().equals(field) && !p.identifier())
          .findFirst().orElseThrow(EasyVRecordReviewRenderer::invalidReview);
    }
    for (var column : maps(result.get("columns"))) {
      if (!Objects.equals(field, column.get("key")) || Boolean.TRUE.equals(column.get("identifier"))) continue;
      if (column.get("valueLabels") instanceof Map<?, ?> labels && !labels.isEmpty()) {
        Map<String, String> names = new LinkedHashMap<>();
        for (var entry : labels.entrySet()) {
          if (!(entry.getKey() instanceof String key) || !(entry.getValue() instanceof String label)) throw invalidReview();
          names.put(key, label);
        }
        return new PropertyView(field, text(column.get("label")), OntologyProperty.Type.STRING, false, false, false, names);
      }
      if (maps(result.get("rows")).stream().allMatch(row -> row.get(field) == null || row.get(field) instanceof Number)) {
        return new PropertyView(field, text(column.get("label")), OntologyProperty.Type.NUMBER, false, false, false, Map.of());
      }
    }
    throw invalidReview();
  }

  private static String reviewValue(PropertyView property, Object value) {
    if (value == null || "".equals(value)) return "未记录";
    if (!property.valueLabels().isEmpty()) return literal(property.valueLabels().getOrDefault(String.valueOf(value), "未提供业务名称"));
    if (property.type() == OntologyProperty.Type.BOOLEAN && value instanceof Boolean flag) return flag ? "是" : "否";
    if (property.type() == OntologyProperty.Type.NUMBER && value instanceof Number) return literal(String.valueOf(value));
    if (property.type() == OntologyProperty.Type.TIME && value instanceof String timestamp) {
      try {
        return OffsetDateTime.parse(timestamp).atZoneSameInstant(ZoneId.of("Asia/Shanghai"))
            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")) + "（北京时间）";
      } catch (DateTimeParseException error) {
        throw new BackendException("EASYV_ANSWER_INVALID", "记录回看的时间属性不能解析：" + property.key(), error);
      }
    }
    if (property.type() == OntologyProperty.Type.STRING && property.title() && value instanceof String text) return literal(text);
    throw new BackendException("EASYV_ANSWER_INVALID", "记录正文必须使用连续原文摘录，不能混入记录表：" + property.key());
  }

  /** 文本引用协议：校验逐字引文；位置、权限与非文本值仍由应用层统一校验。 */
  static void validateQuotedCitation(Map<?, ?> citation, int row, String answer, List<Map<String, Object>> results) {
    for (var result : results) {
      if (!Objects.equals(result.get("id"), citation.get("query"))) continue;
      var rows = maps(result.get("rows"));
      if (row < 0 || row >= rows.size()) return;
      Object value = rows.get(row).get(citation.get("field"));
      if (!(value instanceof String original) || original.isEmpty()) return;
      String source = citation.get("query") + " 第 " + row + " 行字段 " + citation.get("field");
      boolean required = quotedFields(result).contains(citation.get("field"));
      if (!required && !citation.containsKey("quote")) return;
      if (!(citation.get("quote") instanceof String quote) || quote.isBlank()) {
        throw new BackendException("EASYV_ANSWER_INVALID", "文本引用 " + source + " 缺少连续原文 quote。");
      }
      if (!original.contains(quote)) {
        throw new BackendException("EASYV_ANSWER_INVALID", "文本引用 " + source + " 的 quote 不是来源中的连续原文，禁止改写或拼接。");
      }
      if (!isPrototypeResult(result) && !answer.contains(quote)) {
        throw new BackendException("EASYV_ANSWER_INVALID", "文本引用 " + source + " 的 quote「" + quote + "」未在 answer 中原样呈现。");
      }
      return;
    }
  }

  static List<String> quotedFields(Map<String, Object> result) {
    if (!"read_object".equals(result.get("tool")) || !(result.get("objectType") instanceof ObjectTypeView type)) return List.of();
    return type.properties().stream().filter(property -> property.type() == OntologyProperty.Type.STRING
        && !property.identifier() && property.valueLabels().isEmpty()).map(PropertyView::key).toList();
  }

  static boolean hasTextEvidence(List<Map<String, Object>> results) {
    return results.stream().anyMatch(result -> "read_object".equals(result.get("tool"))
        && result.get("objectType") instanceof ObjectTypeView type
        && !isPrototypeResult(result)
        && type.properties().stream().anyMatch(property -> property.type() == OntologyProperty.Type.STRING
            && strings(result.get("textFields")).contains(property.key())
            && !property.identifier() && property.valueLabels().isEmpty()
            && maps(result.get("rows")).stream().anyMatch(row -> row.get(property.key()) instanceof String text && !text.isBlank())));
  }

  static boolean isPrototypeResult(Map<String, Object> result) {
    return result.get("objectType") instanceof ObjectTypeView type
        && Set.of(EasyVOntologyModel.PROTOTYPE_LAYOUT.key(), EasyVOntologyModel.PROTOTYPE_BLOCK.key(),
            EasyVOntologyModel.PROTOTYPE_COMPONENT.key()).contains(type.key());
  }

  static String text(Object value) {
    return value instanceof String text && !text.isBlank() ? text.trim() : null;
  }

  static List<String> strings(Object value) {
    if (!(value instanceof List<?> list)) return List.of();
    return list.stream().map(EasyVRecordReviewRenderer::text).filter(Objects::nonNull).toList();
  }

  static List<Map<?, ?>> maps(Object value) {
    if (!(value instanceof List<?> list)) return List.of();
    List<Map<?, ?>> out = new ArrayList<>();
    for (Object item : list) {
      if (item instanceof Map<?, ?> map) out.add(map);
    }
    return out;
  }

  private static String quotedText(String value) {
    return "> " + literal(value).replace("\n", "  \n> ") + "\n\n";
  }

  private static BackendException invalidReview() {
    return new BackendException("EASYV_ANSWER_INVALID", "记录回看的来源、字段或行选择无效；不接受自由标题、正文或摘要。");
  }

  private static String literal(String text) {
    String escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    return MARKDOWN_SPECIAL.matcher(escaped).replaceAll("\\\\$0")
        .replace("\r\n", "\n").replace("\r", "\n");
  }
}
