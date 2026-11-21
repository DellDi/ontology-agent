package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Citation;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposedAnswer;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Highlight;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanDecision;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanStatus;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.SuggestedAction;
import com.dip3.ontologyagent.easyv.internal.application.EasyVSemanticAgent.ExecutedQuery;
import com.dip3.ontologyagent.easyv.internal.application.EasyVSemanticAgent.ExecutedTool;
import com.dip3.ontologyagent.easyv.internal.domain.BlockImprovement;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVChartConfiguration;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.semantic.api.ObjectQueryPort;
import com.dip3.ontologyagent.semantic.api.QueryIntentCodec;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.DataCoverage;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.SemanticQueryResult;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class EasyVSemanticAgentCollaboratorsTest {

  private static final Instant ANCHOR = Instant.parse("2026-09-28T02:00:00Z");
  private static final Instant CAPTURED = Instant.parse("2026-09-27T16:00:00Z");
  private static final Map<String, Object> ALL_TIME =
      Map.of("expression", Map.of("sourceText", "全部", "kind", "all"));
  private static final Map<String, Object> COUNT_INTENT =
      Map.of("object", "easyv-forge-task", "measures", List.of("count"), "time", ALL_TIME);

  private final SemanticModel semantic = SemanticModel.discover();
  private final SemanticQueryCompiler compiler = new SemanticQueryCompiler(semantic);
  private final EasyVObjectSelectionService selections = new EasyVObjectSelectionService(null, null, null, semantic);

  @Test
  void toolCallPlannerRejectsInvalidBudgetDuplicatesAndBatchShortage() {
    EasyVAnalysisModel model = mock(EasyVAnalysisModel.class);
    EasyVToolCallPlanner planner = new EasyVToolCallPlanner(model, semantic, compiler, selections);
    EasyVAgentTools.Run objectRun = mock(EasyVAgentTools.Run.class);
    when(objectRun.canQuery(any())).thenReturn(true);
    when(objectRun.knownObjects()).thenReturn(List.of());
    DatasetVersionSet versions = versionSet(Set.of());

    // Batch inspection budget check
    when(objectRun.batchSelected()).thenReturn(true);
    when(objectRun.batchInspection()).thenReturn(Optional.of(
        new EasyVAgentTools.Prepared("inspect_block_improvement", Map.of("handles", List.of("o1")), null, null)));
    BackendException batchShort = assertThrows(BackendException.class, () -> planner.plan(
        turn(Map.of()), null, List.of(Map.of("id", "q1")), 4, 0, futureDeadline(), objectRun, versionsWithPrototypes()));
    assertEquals("EASYV_REVIEW_INCOMPLETE", batchShort.code());

    // Budget exceeded on query_metrics
    when(objectRun.batchSelected()).thenReturn(false);
    when(model.plan(any())).thenReturn(new PlanDecision(PlanStatus.READY, List.of(
        Map.of("tool", "query_metrics", "input", Map.of("intent", COUNT_INTENT))), null, List.of()));
    BackendException budget = assertThrows(BackendException.class, () -> planner.plan(
        turn(Map.of()), null, List.of(), 0, 2, futureDeadline(), objectRun, versions));
    assertEquals("AGENT_TOOL_LIMIT", budget.code());

    // Intra-batch duplicate rejection twice -> EASYV_PLAN_INVALID
    when(model.plan(any())).thenReturn(new PlanDecision(PlanStatus.READY, List.of(
        Map.of("tool", "query_metrics", "input", Map.of("intent", COUNT_INTENT)),
        Map.of("tool", "query_metrics", "input", Map.of("intent", COUNT_INTENT))), null, List.of()));
    BackendException duplicate = assertThrows(BackendException.class, () -> planner.plan(
        turn(Map.of()), null, List.of(), 4, 8, futureDeadline(), objectRun, versions));
    assertEquals("EASYV_PLAN_INVALID", duplicate.code());
    assertTrue(duplicate.getMessage().contains("同一批次不接受重复调用"));
  }

  @Test
  void toolCallPlannerSelectedLayoutTriggersDirectReadBeforeLlm() {
    EasyVAnalysisModel model = mock(EasyVAnalysisModel.class);
    EasyVToolCallPlanner planner = new EasyVToolCallPlanner(model, semantic, compiler, selections);
    EasyVAgentTools.Run objectRun = mock(EasyVAgentTools.Run.class);
    var layout = new ObjectQueryPort.Row(
        new ObjectQueryPort.Reference("easyv-prototype-layout", "app-1", "v1"), Map.of("appId", "app-1"));
    var prepared = new EasyVAgentTools.Prepared("read_object", Map.of("handle", "selected"), null, null);
    when(objectRun.prepare("read_object", Map.of("handle", "selected"))).thenReturn(prepared);

    var calls = planner.plan(turn(Map.of()), layout, List.of(), 4, 8, futureDeadline(), objectRun, versionsWithPrototypes());

    assertEquals(1, calls.size());
    assertEquals("read_object", calls.getFirst().tool());
    verify(objectRun).prepare("read_object", Map.of("handle", "selected"));
  }

  @Test
  void evidenceValidatorStripsHandlesAndValidatesHighlightsAndCitations() {
    EasyVEvidenceValidator validator = new EasyVEvidenceValidator(semantic);
    var compiled = compiler.compile(QueryIntentCodec.read(COUNT_INTENT).intent(), ANCHOR).require();
    var query = new ExecutedQuery("q1", "生成任务数", compiled,
        new SemanticQueryResult(List.of(Map.of("count", 5)), List.of(), "select 1"),
        new DataCoverage(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 27)));
    var toolObs = new LinkedHashMap<String, Object>();
    toolObs.put("id", "q2");
    toolObs.put("tool", "query_objects");
    toolObs.put("rows", List.of(Map.of("handle", "o1", "name", "图表")));
    var toolResult = new ExecutedTool("q2", new EasyVAgentTools.Output(
        "图表配置", List.of(Map.of("handle", "o1", "name", "图表")),
        Set.of(EasyVChartConfiguration.CHART_KEY), toolObs, Map.of(), null, List.of()));

    var versions = versionSet(Set.of(EasyVChartConfiguration.CHART_KEY));
    var ontology = new OntologyCatalog("easyv-v2", "2.0.0", List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
    List<Evidence> evidence = validator.evidence(List.of(query), List.of(toolResult), ontology, "set-1", versions, "全部数据");

    assertEquals(3, evidence.size());
    assertTrue(evidence.getFirst().rows().getFirst().containsKey("referenceDataScope"));

    var modelInput = validator.projections(List.of(query), List.of(toolResult), evidence, false);
    assertEquals(2, modelInput.size());
    @SuppressWarnings("unchecked")
    var toolRows = (List<Map<String, Object>>) modelInput.get(1).get("rows");
    assertFalse(toolRows.getFirst().containsKey("handle"));
    assertEquals("图表", toolRows.getFirst().get("name"));

    var plannerInput = validator.projections(List.of(query), List.of(toolResult), evidence, true);
    @SuppressWarnings("unchecked")
    var plannerToolRows = (List<Map<String, Object>>) plannerInput.get(1).get("rows");
    assertEquals("o1", plannerToolRows.getFirst().get("handle"));

    List<String> violations = new java.util.ArrayList<>();
    validator.validateAndGround(new ComposedAnswer("共 5 个", List.of(new Citation("q1", 0, "count")),
        List.of(new Highlight("q9", "sparkline")), List.of(), List.of()), List.of(query), List.of(toolResult), evidence, violations);
    assertTrue(violations.stream().anyMatch(v -> v.contains("viz 不支持")));
    assertTrue(violations.stream().anyMatch(v -> v.contains("查询不存在")));

    violations.clear();
    List<GroundedConclusion.EvidenceReference> refs = validator.validateAndGround(
        new ComposedAnswer("共 5 个", List.of(new Citation("q1", 0, "count")),
            List.of(new Highlight("q1", "table")), List.of(), List.of()),
        List.of(query), List.of(toolResult), evidence, violations);
    assertTrue(violations.isEmpty());
    assertEquals(1, refs.size());
    assertEquals(5, refs.getFirst().value());
  }

  @Test
  void workflowAssemblerBuildsBatchProposalsAndSnapshotMetadata() {
    EasyVWorkflowAssembler assembler = new EasyVWorkflowAssembler(semantic);
    var ref = new ObjectQueryPort.Reference("easyv-prototype-block", "a:b", "v-block");
    var inspectedTool = new ExecutedTool("q1", new EasyVAgentTools.Output(
        "读取所选区域的完整指标依据",
        List.of(Map.of("handle", "o1", "pageTitle", "运营大屏", "title", "旧标题", "purpose", "旧用途")),
        Set.of("easyv-prototype-block"),
        Map.of("id", "q1", "tool", "inspect_block_improvement", "complete", true, "rows", List.of()),
        Map.of(), null, List.of(ref)));
    var preview = new BlockImprovement.Preview("proposal", "旧标题", "旧用途",
        new BlockImprovement.Diagnosis("标题与唯一指标不一致", "保持图形", "保持布局"),
        List.of(), null, List.of(),
        new BlockImprovement.TextChange("旧标题", "新指标名", "旧用途", "新指标含义"));
    var previewTool = new ExecutedTool("q2", new EasyVAgentTools.Output(
        "块内重组提案（尚未应用）",
        List.of(Map.of("name", "新指标名")),
        Set.of("easyv-prototype-block"),
        Map.of("id", "q2", "tool", "preview_block_improvement", "preview", preview),
        Map.of(), Map.of("type", "table", "title", "提案", "role", "primary", "columns", List.of(), "rows", List.of()),
        List.of(ref)));

    ComposedAnswer emptyBatch = assembler.batchReviewAnswer("已读取 1 张大屏", "全部数据", List.of(inspectedTool));
    assertTrue(emptyBatch.markdown().contains("本轮没有生成可确认的改法"));

    ComposedAnswer proposedBatch = assembler.batchReviewAnswer("已读取 1 张大屏", "全部数据", List.of(inspectedTool, previewTool));
    assertTrue(proposedBatch.markdown().contains("### 1. 运营大屏 · 旧标题"));
    assertTrue(proposedBatch.markdown().contains("标题：旧标题 → 新指标名"));
    assertTrue(proposedBatch.markdown().contains("用途：旧用途 → 新指标含义"));
    assertTrue(proposedBatch.markdown().contains("以上 1 项均尚未应用"));
    assertTrue(proposedBatch.citations().contains(new Citation("q1", 0, "title")));

    var compiled = compiler.compile(QueryIntentCodec.read(COUNT_INTENT).intent(), ANCHOR).require();
    var query = new ExecutedQuery("q1", assembler.label(compiled), compiled,
        new SemanticQueryResult(List.of(Map.of("count", 7)), List.of(), "select 1"),
        new DataCoverage(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 27)));
    var scope = new ResolvedScopeSnapshot("easyv", 2, Map.of("userId", "7", "accessMode", "all"));
    var evidence = List.of(new Evidence(EasyVSemanticAgent.DATA_SCOPE_EVIDENCE, "范围", List.of(Map.of("resultRows", 1)),
        new Evidence.Provenance("v2", "set-1", CAPTURED, Map.of("easyv-forge-task", "v-easyv-forge-task"))));
    var answer = new ComposedAnswer("共 7 个任务", List.of(new Citation("q1", 0, "count")),
        List.of(new Highlight("q1", "table")), List.of("按月看？"), List.of(new SuggestedAction("复核", "共 7 个")));

    var result = assembler.assemble(turn(Map.of()), scope, "全部数据", List.of(query), List.of(), evidence,
        answer, List.of(new GroundedConclusion.EvidenceReference("easyv-query:q1", 0, "count", 7)),
        List.of(), List.of(), null, versionSet(Set.of()), "set-1");

    assertEquals("共 7 个任务", result.conclusion());
    assertTrue(result.plan().containsKey("_understanding"));
    assertTrue(result.plan().containsKey("_editorCatalog"));
    assertEquals(List.of("按月看？"), result.plan().get("_suggestedQuestions"));
    assertEquals(1, ((List<?>) result.plan().get("_suggestedActions")).size());
    assertEquals("table", result.renderBlocks().getFirst().get("type"));
  }

  private static AgentTurn turn(Map<String, Object> context) {
    return new AgentTurn(ExecutionRepository.INITIAL_EXECUTION_CONTRACT, "s1", "生成任务数",
        null, null, Map.of(), context, ANCHOR);
  }

  private static long futureDeadline() {
    return System.nanoTime() + 60_000_000_000L;
  }

  private static DatasetVersionSet versionSet(Set<String> extra) {
    Map<String, String> versions = EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS.stream()
        .collect(Collectors.toMap(k -> k, k -> "v-" + k));
    extra.forEach(k -> versions.put(k, "v-" + k));
    return new DatasetVersionSet("set-1", versions, CAPTURED, DatasetVersionSet.Status.FROZEN, CAPTURED, CAPTURED, "test");
  }

  private static DatasetVersionSet versionsWithPrototypes() {
    return versionSet(Set.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component"));
  }
}
