package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Citation;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposedAnswer;
import com.dip3.ontologyagent.easyv.internal.application.EasyVSemanticAgent.ExecutedQuery;
import com.dip3.ontologyagent.easyv.internal.application.EasyVSemanticAgent.ExecutedTool;
import com.dip3.ontologyagent.easyv.internal.domain.BlockImprovement;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVOntologyModel;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery;
import com.dip3.ontologyagent.semantic.api.ObjectQueryPort;
import com.dip3.ontologyagent.semantic.api.ObjectSelection;
import com.dip3.ontologyagent.semantic.api.OntologyMetric;
import com.dip3.ontologyagent.semantic.api.OntologyObjectType;
import com.dip3.ontologyagent.semantic.api.OntologyProperty;
import com.dip3.ontologyagent.semantic.api.QueryIntent;
import com.dip3.ontologyagent.semantic.api.QueryIntentCodec;
import com.dip3.ontologyagent.semantic.api.ResolvedTimeRange;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.DataCoverage;
import com.dip3.ontologyagent.semantic.api.TimeCoverage;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * EasyV 批量检查提案组装、执行快照（_understanding / _editorCatalog）与最终 WorkflowResult 装配协作者。
 */
final class EasyVWorkflowAssembler {

  private final SemanticModel semantic;

  EasyVWorkflowAssembler(SemanticModel semantic) {
    this.semantic = semantic;
  }

  /** 同批检查只组织已经校验的提案，不让综合模型再次推断问题或改写前后结果。 */
  ComposedAnswer batchReviewAnswer(String coverage, String scope, List<ExecutedTool> tools) {
    var answer = new StringBuilder(coverage).append("\n\n");
    var citations = new ArrayList<Citation>();
    var source = tools.getFirst();
    source.output().rows().getFirst().entrySet().stream()
        .filter(entry -> !entry.getKey().equals("handle") && EasyVEvidenceValidator.citableValue(entry.getValue()))
        .findFirst().ifPresent(entry -> citations.add(new Citation(source.id(), 0, entry.getKey())));
    int count = 0;
    for (var tool : tools) {
      if (!"preview_block_improvement".equals(tool.output().observation().get("tool"))) continue;
      var preview = (BlockImprovement.Preview) tool.output().observation().get("preview");
      var reference = tool.output().references().stream()
          .filter(ref -> "easyv-prototype-block".equals(ref.objectKey())).findFirst().orElseThrow();
      var inspected = tools.stream()
          .filter(item -> Boolean.TRUE.equals(item.output().observation().get("complete"))
              && item.output().references().contains(reference))
          .findFirst()
          .orElseThrow(() -> new BackendException("EASYV_REVIEW_INCOMPLETE", "提案缺少本批区域的完整读取依据。"));
      int row = inspected.output().references().indexOf(reference);
      var region = inspected.output().rows().get(row);
      citations.add(new Citation(inspected.id(), row, "title"));
      answer.append("### ").append(++count).append(". ").append(region.get("pageTitle")).append(" · ")
          .append(preview.title()).append("\n\n")
          .append("建议依据：").append(preview.diagnosis().themeFit()).append("\n\n");
      var text = preview.textChange();
      if (text != null) {
        if (!text.beforeTitle().equals(text.afterTitle())) {
          answer.append("标题：").append(text.beforeTitle()).append(" → ").append(text.afterTitle()).append("\n\n");
        }
        if (!text.beforePurpose().equals(text.afterPurpose())) {
          answer.append("用途：").append(text.beforePurpose()).append(" → ").append(text.afterPurpose()).append("\n\n");
        }
      }
      if (!preview.changes().isEmpty()) answer.append("图形与组合调整见下方逐项预览。\n\n");
    }
    if (count == 0) {
      answer.append("本轮没有生成可确认的改法。没有提案不代表所有区域无需修改或已通过质量检查。\n\n");
    } else {
      answer.append("以上 ").append(count).append(" 项均尚未应用。请在下方逐项查看依据、准备结果并确认保存；没有提案的区域不视为检查通过。\n\n");
    }
    answer.append("真实字段、业务数值和最终画面尚未核验；提案的信息缺口保留在各项预览中。\n\n数据范围：")
        .append(scope).append("。");
    return new ComposedAnswer(answer.toString(), List.copyOf(citations), List.of(), List.of(), List.of());
  }

  WorkflowResult assemble(AgentTurn turn, ResolvedScopeSnapshot scope, String dataScope,
                          List<ExecutedQuery> executed, List<ExecutedTool> objectResults,
                          List<Evidence> evidence, ComposedAnswer answer,
                          List<GroundedConclusion.EvidenceReference> references,
                          List<Map<String, Object>> performedSteps, List<Map<String, Object>> callTrace,
                          ObjectQueryPort.Row selectedObject, DatasetVersionSet versionSet,
                          String datasetVersionSetId) {
    List<GroundedConclusion.Claim> claims =
        List.of(new GroundedConclusion.Claim(EasyVSemanticAgent.CLAIM_KIND, answer.markdown(), references));
    List<Map<String, Object>> blocks =
        new ArrayList<>(EasyVRenderBlocks.build(executed, answer.highlights(), semantic, datasetVersionSetId));
    blocks.addAll(EasyVRenderBlocks.objectBrowsers(executed, semantic, datasetVersionSetId,
        versionSet.productVersionIds().keySet()));
    blocks.addAll(objectResults.stream().map(tool -> tool.output().renderBlock()).filter(Objects::nonNull).toList());
    return new WorkflowResult(
        planSnapshot(turn, scope, dataScope, executed, evidence, answer, performedSteps, callTrace, selectedObject),
        evidence, answer.markdown(), claims, blocks);
  }

  String label(CompiledSemanticQuery compiled) {
    List<String> measures = new ArrayList<>();
    List<String> dimensions = new ArrayList<>();
    for (CompiledSemanticQuery.Column column : compiled.columns()) {
      switch (column.kind()) {
        case MEASURE -> measures.add(column.label());
        case DIMENSION -> dimensions.add(column.label());
        case TIME -> { }
      }
    }
    StringBuilder label = new StringBuilder(semantic.require(compiled.objectKey()).label())
        .append(" · ").append(String.join("、", measures));
    if (!dimensions.isEmpty()) label.append(" 按").append(String.join("、", dimensions));
    if (compiled.granularity() != null) label.append(" 按").append(granularityLabel(compiled.granularity()));
    return label.toString();
  }

  static String lower(Enum<?> value) {
    return value.name().toLowerCase(Locale.ROOT).replace('_', '-');
  }

  private Map<String, Object> planSnapshot(AgentTurn turn, ResolvedScopeSnapshot scope, String dataScope,
                                           List<ExecutedQuery> executed, List<Evidence> evidence,
                                           ComposedAnswer answer, List<Map<String, Object>> performedSteps,
                                           List<Map<String, Object>> callTrace, ObjectQueryPort.Row selectedObject) {
    Map<String, Object> resolved = new LinkedHashMap<>(scope.values());
    resolved.put("dataScope", dataScope);
    resolved.put("queries", executed.stream().map(query -> {
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("id", query.id());
      item.put("label", query.label());
      item.put("intent", QueryIntentCodec.write(query.compiled().intent()));
      item.put("range", query.compiled().range().description());
      if (query.compiled().range().from() != null) item.put("from", query.compiled().range().from().toString());
      item.put("to", query.compiled().range().to().toString());
      if (query.compiled().compareRange() != null) {
        item.put("compareRange", query.compiled().compareRange().description());
      }
      return (Map<String, Object>) item;
    }).toList());
    Map<String, Object> plan = new LinkedHashMap<>();
    plan.put("_executionContract", turn.contract());
    if (turn.effectiveContext().get("objectSelection") != null) {
      ObjectSelection selection = ObjectSelection.read(turn.effectiveContext().get("objectSelection"));
      plan.put("_objectSelection", selection.snapshot());
      plan.put("_objectSelectionLabel", selection.additionalReferences().isEmpty()
          ? selectionLabel(selectedObject) : selection.references().size() + " 张大屏的检查与改进");
    }
    resolved.put("toolCalls", List.copyOf(callTrace));
    plan.put("_resolvedContext", Map.copyOf(resolved));
    if (!executed.isEmpty()) {
      plan.put("_understanding", executed.stream().map(this::understanding).toList());
      plan.put("_editorCatalog", editorCatalog(executed));
    }
    plan.put("_evidenceTypes", evidence.stream().map(Evidence::source).toList());
    plan.put("summary", "EasyV 数据问答");
    plan.put("mode", EasyVSemanticAgent.MODE);
    plan.put("steps", List.copyOf(performedSteps));
    if (!answer.suggestions().isEmpty()) plan.put("_suggestedQuestions", answer.suggestions());
    if (!answer.actions().isEmpty()) {
      plan.put("_suggestedActions", answer.actions().stream()
          .map(action -> Map.of("label", action.label(), "rationale", action.rationale())).toList());
    }
    if (turn.followUpId() != null) plan.put("_followUpId", turn.followUpId());
    if (turn.referencedExecutionId() != null) plan.put("_referencedExecutionId", turn.referencedExecutionId());
    return Map.copyOf(plan);
  }

  /** “我的理解”投影：每条已执行查询的对象、指标、维度、过滤、解析后时间与数据覆盖。 */
  private Map<String, Object> understanding(ExecutedQuery query) {
    CompiledSemanticQuery compiled = query.compiled();
    QueryIntent intent = compiled.intent();
    OntologyObjectType object = semantic.require(compiled.objectKey());
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("id", query.id());
    item.put("label", query.label());
    item.put("object", Map.of("key", object.key(), "label", object.label()));
    item.put("measures", compiled.columns().stream()
        .filter(column -> column.kind() == CompiledSemanticQuery.ColumnKind.MEASURE)
        .map(column -> Map.of("key", column.key(), "label", column.label())).toList());
    item.put("dimensions", compiled.columns().stream()
        .filter(column -> column.kind() == CompiledSemanticQuery.ColumnKind.DIMENSION)
        .map(column -> Map.of("key", column.key(), "label", memberLabel(object, column.key()))).toList());
    item.put("filters", intent.filters().stream().map(filter -> {
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("member", filter.member());
      entry.put("label", filterLabel(object, filter.member()));
      entry.put("operator", lower(filter.operator()));
      entry.put("values", filter.values());
      var property = semantic.resolve(compiled.objectKey(), filter.member()).property();
      if (property != null && !property.valueLabels().isEmpty()) entry.put("valueLabels", property.valueLabels());
      return (Map<String, Object>) entry;
    }).toList());
    String timePath = intent.time().dimension() == null || intent.time().dimension().isBlank()
        ? object.defaultTimeProperty() : intent.time().dimension();
    ResolvedTimeRange range = compiled.range();
    Map<String, Object> time = new LinkedHashMap<>();
    time.put("dimension", timePath);
    time.put("label", memberLabel(object, timePath));
    time.put("sourceText", intent.time().expression().sourceText());
    time.put("kind", lower(intent.time().expression().kind()));
    time.put("from", range.from() == null ? null : range.from().toString());
    time.put("to", range.to().toString());
    time.put("allData", range.allData());
    time.put("granularity", compiled.granularity());
    item.put("time", time);
    ResolvedTimeRange compare = compiled.compareRange();
    item.put("compare", compare == null ? null : Map.of("sourceText", compare.sourceText(),
        "from", compare.from().toString(), "to", compare.to().toString()));
    item.put("limit", intent.limit());
    DataCoverage dataCoverage = query.coverage();
    TimeCoverage coverage = dataCoverage == null
        ? null : range.coverage(dataCoverage.from(), dataCoverage.to());
    Map<String, Object> coverageMap = new LinkedHashMap<>();
    coverageMap.put("status", coverage == null ? "none" : lower(coverage.status()));
    coverageMap.put("dataFrom", dataCoverage == null || dataCoverage.from() == null
        ? null : dataCoverage.from().toString());
    coverageMap.put("dataTo", dataCoverage == null || dataCoverage.to() == null
        ? null : dataCoverage.to().toString());
    coverageMap.put("effectiveFrom", coverage == null || coverage.effectiveFrom() == null
        ? null : coverage.effectiveFrom().toString());
    coverageMap.put("effectiveTo", coverage == null || coverage.effectiveTo() == null
        ? null : coverage.effectiveTo().toString());
    item.put("coverage", coverageMap);
    return item;
  }

  /** 结构化调整编辑器目录：本轮执行涉及的每个根对象的可选指标与成员路径（与编译器接受的路径一致）。 */
  private Map<String, Object> editorCatalog(List<ExecutedQuery> executed) {
    List<Map<String, Object>> objects = new ArrayList<>();
    Set<String> seen = new LinkedHashSet<>();
    for (ExecutedQuery query : executed) {
      String key = query.compiled().objectKey();
      if (!seen.add(key)) continue;
      OntologyObjectType object = semantic.require(key);
      List<Map<String, Object>> dimensions = new ArrayList<>();
      List<Map<String, Object>> timeDimensions = new ArrayList<>();
      for (SemanticModel.ResolvedMember member : semantic.members(key)) {
        Map<String, Object> item = Map.of("key", member.path(), "label", memberLabel(member));
        (member.property().type() == OntologyProperty.Type.TIME ? timeDimensions : dimensions).add(item);
      }
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("key", object.key());
      entry.put("label", object.label());
      entry.put("defaultTime", object.defaultTimeProperty());
      entry.put("measures", object.metrics().stream()
          .map(metric -> Map.of("key", metric.key(), "label", metric.label())).toList());
      entry.put("dimensions", List.copyOf(dimensions));
      entry.put("timeDimensions", List.copyOf(timeDimensions));
      objects.add(entry);
    }
    return Map.of("objects", List.copyOf(objects));
  }

  /** 标题来自已授权读取的对象与本体声明，不把主键作为用户可见名称。 */
  private String selectionLabel(ObjectQueryPort.Row object) {
    var type = semantic.require(object.reference().objectKey());
    for (var property : type.properties()) {
      var value = object.properties().get(property.key());
      if (!property.title() || property.identifier() || value == null || value.toString().isBlank()) continue;
      String title = property.valueLabels().isEmpty() ? value.toString()
          : property.valueLabels().getOrDefault(value.toString(), "未配置显示名称");
      return type.label().equals(title) ? title : type.label() + " · " + title;
    }
    var time = type.defaultTimeProperty() == null ? null : object.properties().get(type.defaultTimeProperty());
    return time == null ? type.label() : type.label() + " · " + DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss")
        .withZone(EasyVOntologyModel.BUSINESS_ZONE).format(Instant.parse(time.toString()));
  }

  /** 成员路径展示标签：一跳关联路径以“目标对象·属性”组合，标注数据来源对象。 */
  private String memberLabel(OntologyObjectType root, String path) {
    return memberLabel(semantic.resolve(root.key(), path));
  }

  private static String memberLabel(SemanticModel.ResolvedMember member) {
    return member.path().contains(".")
        ? member.owner().label() + "·" + member.property().label()
        : member.property().label();
  }

  /** 过滤成员标签：指标 key 取指标标签（HAVING），属性路径走成员解析。 */
  private String filterLabel(OntologyObjectType root, String member) {
    return root.findMetric(member).map(OntologyMetric::label).orElseGet(() -> memberLabel(root, member));
  }

  private static String granularityLabel(String granularity) {
    return switch (granularity) {
      case "day" -> "日";
      case "week" -> "周";
      case "month" -> "月";
      case "quarter" -> "季度";
      case "year" -> "年";
      default -> granularity;
    };
  }
}
