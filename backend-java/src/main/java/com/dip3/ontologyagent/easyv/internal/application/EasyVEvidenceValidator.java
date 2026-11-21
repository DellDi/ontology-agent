package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Citation;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposedAnswer;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Highlight;
import com.dip3.ontologyagent.easyv.internal.application.EasyVSemanticAgent.ExecutedQuery;
import com.dip3.ontologyagent.easyv.internal.application.EasyVSemanticAgent.ExecutedTool;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVChartConfiguration;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery;
import com.dip3.ontologyagent.semantic.api.QueryIntentCodec;
import com.dip3.ontologyagent.semantic.api.ResolvedTimeRange;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.DataCoverage;
import com.dip3.ontologyagent.semantic.api.TimeCoverage;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * EasyV 证据组装、模型观察投影生成与引文/视图校验协作者。
 */
final class EasyVEvidenceValidator {

  static final String COMPARE_SUFFIX = ":compare";
  private static final Set<String> SUPPORTED_VIZ = Set.of("bar", "line", "pie", "table", "none");

  private final SemanticModel semantic;

  EasyVEvidenceValidator(SemanticModel semantic) {
    this.semantic = semantic;
  }

  List<Evidence> evidence(List<ExecutedQuery> executed, List<ExecutedTool> objectResults, OntologyCatalog ontology,
                          String datasetVersionSetId, DatasetVersionSet versionSet, String dataScope) {
    List<Evidence> evidence = new ArrayList<>();
    Set<String> allProducts = new LinkedHashSet<>();
    for (ExecutedQuery query : executed) {
      allProducts.addAll(query.compiled().productKeys());
      Evidence.Provenance provenance =
          provenance(query.compiled().productKeys(), ontology, datasetVersionSetId, versionSet);
      if (!query.result().rows().isEmpty()) {
        evidence.add(new Evidence(EasyVSemanticAgent.QUERY_EVIDENCE_PREFIX + query.id(), query.label(),
            evidenceRows(query.result().rows()), provenance));
      }
      if (!query.result().compareRows().isEmpty()) {
        evidence.add(new Evidence(EasyVSemanticAgent.QUERY_EVIDENCE_PREFIX + query.id() + COMPARE_SUFFIX,
            query.label() + "（对比期 " + query.compiled().compareRange().description() + "）",
            evidenceRows(query.result().compareRows()), provenance));
      }
    }
    for (ExecutedTool tool : objectResults) {
      allProducts.addAll(tool.output().products());
      if (!tool.output().rows().isEmpty()) {
        evidence.add(new Evidence(EasyVSemanticAgent.QUERY_EVIDENCE_PREFIX + tool.id(), tool.output().label(),
            evidenceRows(tool.output().rows()),
            provenance(tool.output().products(), ontology, datasetVersionSetId, versionSet)));
      }
    }
    Map<String, Object> scopeRow = new LinkedHashMap<>();
    scopeRow.put("dataScope", dataScope);
    if (allProducts.stream().anyMatch(EasyVChartConfiguration.REFERENCES::contains)) {
      scopeRow.put("referenceDataScope", "全局参考配置（冻结采集版本），不代表历史生成时采用的规则");
    }
    scopeRow.put("queryCount", executed.size());
    scopeRow.put("toolCount", executed.size() + objectResults.size());
    scopeRow.put("resultRows", executed.stream().mapToInt(query -> query.result().rows().size()).sum()
        + objectResults.stream().mapToInt(tool -> tool.output().rows().size()).sum());
    scopeRow.put("freshnessAt", versionSet.capturedAt().toString());
    evidence.add(0, new Evidence(EasyVSemanticAgent.DATA_SCOPE_EVIDENCE, "数据范围与冻结版本", List.of(scopeRow),
        provenance(allProducts, ontology, datasetVersionSetId, versionSet)));
    return List.copyOf(evidence);
  }

  List<Map<String, Object>> projections(List<ExecutedQuery> executed, List<ExecutedTool> objectResults,
                                        List<Evidence> evidence, boolean includeHandles) {
    Map<String, Evidence> bySource = new LinkedHashMap<>();
    evidence.forEach(item -> bySource.put(item.source(), item));
    List<Map<String, Object>> out = new ArrayList<>();
    for (ExecutedQuery query : executed) {
      out.add(projection(query.id(), query.label(), query.compiled().range().description(),
          query.compiled().range(), query, query.result().rows(),
          bySource.get(EasyVSemanticAgent.QUERY_EVIDENCE_PREFIX + query.id())));
      if (query.compiled().compareRange() != null) {
        out.add(projection(query.id() + COMPARE_SUFFIX, query.label() + "（对比期）",
            query.compiled().compareRange().description(), query.compiled().compareRange(), query,
            query.result().compareRows(),
            bySource.get(EasyVSemanticAgent.QUERY_EVIDENCE_PREFIX + query.id() + COMPARE_SUFFIX)));
      }
    }
    for (var tool : objectResults) {
      if (includeHandles) {
        out.add(tool.output().observation());
      } else {
        // 句柄仅供规划调用工具；回答使用真实业务字段，审计与证据保留原始结果。
        Map<String, Object> observation = new LinkedHashMap<>(tool.output().observation());
        observation.put("rows", tool.output().rows().stream().limit(EasyVSemanticAgent.EVIDENCE_ROW_CAP).map(row -> {
          Map<String, Object> values = new LinkedHashMap<>(row);
          values.remove("handle");
          return values;
        }).toList());
        out.add(observation);
      }
    }
    out.sort(Comparator.comparingInt(item -> Integer.parseInt(((String) item.get("id")).split(":")[0].substring(1))));
    return out;
  }

  List<GroundedConclusion.EvidenceReference> validateAndGround(ComposedAnswer answer, List<ExecutedQuery> executed,
                                                               List<ExecutedTool> objectResults, List<Evidence> evidence,
                                                               List<String> violations) {
    for (Highlight highlight : answer == null ? List.<Highlight>of() : answer.highlights()) {
      if (highlight.viz() == null || !SUPPORTED_VIZ.contains(highlight.viz())) {
        violations.add("highlight 的 viz 不支持：" + highlight.viz());
      }
      if (executed.stream().noneMatch(query -> query.id().equals(highlight.query()))
          && objectResults.stream().noneMatch(tool -> tool.id().equals(highlight.query()))) {
        violations.add("highlight 的查询不存在：" + highlight.query());
      }
    }
    return references(answer, evidence, violations);
  }

  static boolean citableValue(Object value) {
    return value instanceof Number || value instanceof Boolean
        || (value instanceof String text && !text.isEmpty());
  }

  private Map<String, Object> projection(String id, String label, String range,
                                         ResolvedTimeRange coverageRange, ExecutedQuery query,
                                         List<Map<String, Object>> rows, Evidence evidence) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", id);
    out.put("label", label);
    out.put("intent", QueryIntentCodec.write(query.compiled().intent()));
    out.put("range", range);
    DataCoverage dataCoverage = query.coverage();
    out.put("dataCoverage", dataCoverage == null || dataCoverage.empty() ? "无数据"
        : dataCoverage.from() + " 至 " + dataCoverage.to());
    TimeCoverage coverage = dataCoverage == null
        ? null : coverageRange.coverage(dataCoverage.from(), dataCoverage.to());
    out.put("coverageStatus", coverage == null ? "none" : EasyVWorkflowAssembler.lower(coverage.status()));
    if (coverage != null && coverage.status() == TimeCoverage.Status.PARTIAL) {
      out.put("effectiveRange", coverage.effectiveFrom() + " 至 " + coverage.effectiveTo());
    }
    out.put("columns", query.compiled().columns().stream()
        .map(column -> {
          Map<String, Object> metadata = new LinkedHashMap<>();
          metadata.put("key", column.key());
          metadata.put("label", column.label());
          metadata.put("kind", EasyVWorkflowAssembler.lower(column.kind()));
          boolean dimension = column.kind() == CompiledSemanticQuery.ColumnKind.DIMENSION;
          var property = dimension ? semantic.resolve(query.compiled().objectKey(), column.key()).property() : null;
          metadata.put("identifier", property != null && property.identifier());
          if (property != null && !property.valueLabels().isEmpty()) metadata.put("valueLabels", property.valueLabels());
          return metadata;
        }).toList());
    out.put("totalRows", rows.size());
    out.put("rows", evidence == null ? List.of() : evidence.rows());
    return out;
  }

  private static List<GroundedConclusion.EvidenceReference> references(
      ComposedAnswer answer, List<Evidence> evidence, List<String> violations) {
    if (answer == null || answer.markdown() == null || answer.markdown().isBlank()) {
      violations.add("answer 不能为空");
      return List.of();
    }
    Map<String, Evidence> bySource = new LinkedHashMap<>();
    evidence.forEach(item -> bySource.put(item.source(), item));
    // 可引用值与下方 citation 校验同一规则；全空行（如比率 0/0 产生 null）不构成可引用证据
    boolean hasQueryEvidence = evidence.stream()
        .filter(item -> item.source().startsWith(EasyVSemanticAgent.QUERY_EVIDENCE_PREFIX))
        .anyMatch(item -> item.rows().stream()
            .anyMatch(row -> row.values().stream().anyMatch(EasyVEvidenceValidator::citableValue)));
    List<GroundedConclusion.EvidenceReference> references = new ArrayList<>();
    for (Citation citation : answer.citations()) {
      Evidence item = citation.query() == null ? null : bySource.get(EasyVSemanticAgent.QUERY_EVIDENCE_PREFIX + citation.query());
      if (item == null) {
        violations.add("引用的查询不存在或无结果：" + citation.query());
        continue;
      }
      if (citation.row() < 0 || citation.row() >= item.rows().size()) {
        violations.add("引用 " + citation.query() + " 的行下标越界：" + citation.row());
        continue;
      }
      Object value = item.rows().get(citation.row()).get(citation.field());
      if (!citableValue(value)) {
        violations.add("引用 " + citation.query() + " 第 " + citation.row() + " 行的字段无效或为空：" + citation.field()
            + "；可引用字段：" + item.rows().get(citation.row()).entrySet().stream()
                .filter(entry -> citableValue(entry.getValue())).map(Map.Entry::getKey).toList());
        continue;
      }
      references.add(new GroundedConclusion.EvidenceReference(item.source(), citation.row(), citation.field(), value));
    }
    if (hasQueryEvidence && references.isEmpty() && violations.isEmpty()) {
      violations.add("citations 至少引用一个支撑结论的数据点");
    }
    if (!hasQueryEvidence) {
      Evidence scope = bySource.get(EasyVSemanticAgent.DATA_SCOPE_EVIDENCE);
      references.add(new GroundedConclusion.EvidenceReference(scope.source(), 0, "resultRows",
          scope.rows().getFirst().get("resultRows")));
    }
    return references;
  }

  private static List<Map<String, Object>> evidenceRows(List<Map<String, Object>> rows) {
    return rows.stream().limit(EasyVSemanticAgent.EVIDENCE_ROW_CAP).map(row -> {
      Map<String, Object> copy = new LinkedHashMap<>();
      row.forEach((key, value) -> copy.put(key, value == null ? "" : value));
      return (Map<String, Object>) copy;
    }).toList();
  }

  private static Evidence.Provenance provenance(Iterable<String> productKeys, OntologyCatalog ontology,
                                                String datasetVersionSetId, DatasetVersionSet versionSet) {
    Map<String, String> versions = new LinkedHashMap<>();
    for (String productKey : productKeys) {
      String version = versionSet.productVersionIds().get(productKey);
      if (version == null) {
        throw new BackendException("DATASET_VERSION_SET_INCOMPLETE",
            "冻结数据集版本缺少数据产品 " + productKey + "。");
      }
      versions.put(productKey, version);
    }
    return new Evidence.Provenance(ontology.versionId(), datasetVersionSetId, versionSet.capturedAt(), versions);
  }
}
