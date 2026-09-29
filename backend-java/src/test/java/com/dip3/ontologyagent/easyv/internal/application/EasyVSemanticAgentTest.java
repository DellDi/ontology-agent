package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.ExecutionProgress;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Citation;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposeRequest;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposedAnswer;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Highlight;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanDecision;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanRequest;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanStatus;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.InvocationEventRecorder;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery;
import com.dip3.ontologyagent.semantic.api.QueryIntent;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.AccessContext;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.DataCoverage;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.Scope;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.SemanticQueryResult;
import com.dip3.ontologyagent.semantic.api.TimeExpression;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class EasyVSemanticAgentTest {
  private static final Instant ANCHOR = Instant.parse("2026-09-28T02:00:00Z");
  private static final Instant CAPTURED = Instant.parse("2026-09-27T16:00:00Z");
  private static final Map<String, Object> ALL_TIME =
      Map.of("expression", Map.of("sourceText", "全部", "kind", "all"));
  private static final Map<String, Object> COUNT_QUERY =
      Map.of("object", "easyv-forge-task", "measures", List.of("count", "successRate"), "time", ALL_TIME);
  private static final ResolvedScopeSnapshot ALL =
      new ResolvedScopeSnapshot("easyv", 2, Map.of("userId", "7", "accessMode", "all"));
  private static final ResolvedScopeSnapshot SCOPED =
      new ResolvedScopeSnapshot("easyv", 2, Map.of("userId", "7", "accessMode", "scoped", "easyvUserId", "16"));

  private final EasyVAnalysisModel model = mock(EasyVAnalysisModel.class);
  private final SemanticQueryPort queries = mock(SemanticQueryPort.class);
  private final DatasetVersionSetRegistry datasets = mock(DatasetVersionSetRegistry.class);
  private final InvocationEventRecorder recorder = mock(InvocationEventRecorder.class);
  private final List<String> events = new ArrayList<>();
  private final List<String> deltas = new ArrayList<>();
  private final ExecutionProgress progress = new ExecutionProgress() {
    @Override
    public void emit(String kind, Map<String, Object> step, Map<String, Object> tool) {
      events.add(kind);
    }

    @Override
    public void emitAnswerDelta(String answerText) {
      deltas.add(answerText);
    }
  };
  private EasyVSemanticAgent agent;

  @BeforeEach
  void setUp() {
    SemanticModel semantic = SemanticModel.discover();
    agent = new EasyVSemanticAgent(model, semantic, new SemanticQueryCompiler(semantic), queries, datasets, recorder);
    Map<String, String> versions = EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS.stream()
        .collect(Collectors.toMap(key -> key, key -> "v-" + key));
    when(datasets.requireFrozen("easyv-set-1", EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS))
        .thenReturn(new DatasetVersionSet("easyv-set-1", versions, CAPTURED, DatasetVersionSet.Status.FROZEN,
            CAPTURED, CAPTURED, "test"));
    when(recorder.start(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), isNull(),
        anyMap(), anyString(), anyString())).thenReturn("invocation-1");
    when(queries.coverage(any(), any())).thenReturn(new DataCoverage(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 9, 27)));
  }

  @Test
  void plansCompilesExecutesAndGroundsTheAnswerInCitedRows() {
    when(model.plan(any())).thenReturn(ready(COUNT_QUERY));
    when(queries.execute(any(), any())).thenReturn(result(Map.of("count", 12, "successRate", 75.0)));
    when(model.compose(any(), any())).thenAnswer(invocation -> {
      invocation.<java.util.function.Consumer<String>>getArgument(1).accept("共 12 个任务，成功率 75%");
      return answer(List.of(new Citation("q1", 0, "count"), new Citation("q1", 0, "successRate")));
    });

    WorkflowResult result = run(initialTurn(), SCOPED);

    ArgumentCaptor<AccessContext> access = ArgumentCaptor.forClass(AccessContext.class);
    ArgumentCaptor<CompiledSemanticQuery> compiled = ArgumentCaptor.forClass(CompiledSemanticQuery.class);
    verify(queries).execute(compiled.capture(), access.capture());
    assertEquals(Scope.restricted(Map.of("userId", List.of("16"))), access.getValue().scope());
    assertEquals("v-easyv-forge-task", access.getValue().productVersions().get("easyv-forge-task"));
    assertEquals("easyv-forge-task", compiled.getValue().objectKey());

    assertEquals(List.of("easyv-data-scope", "easyv-query:q1"),
        result.evidence().stream().map(item -> item.source()).toList());
    assertEquals("EasyV 用户 16 的数据", result.evidence().getFirst().rows().getFirst().get("dataScope"));
    assertEquals(CAPTURED.toString(), result.evidence().getFirst().rows().getFirst().get("freshnessAt"));
    GroundedConclusion.Claim claim = result.claims().getFirst();
    assertEquals(EasyVSemanticAgent.CLAIM_KIND, claim.kind());
    assertEquals(List.of(12, 75.0), claim.evidenceRefs().stream().map(ref -> ref.value()).toList());
    assertEquals(EasyVSemanticAgent.MODE, result.plan().get("mode"));
    @SuppressWarnings("unchecked")
    Map<String, Object> resolved = (Map<String, Object>) result.plan().get("_resolvedContext");
    assertEquals("16", resolved.get("easyvUserId"));
    assertEquals(1, ((List<?>) resolved.get("queries")).size());
    assertEquals(List.of("追问 1"), result.plan().get("_suggestedQuestions"));
    assertEquals(List.of("共 12 个任务，成功率 75%"), deltas);
    assertTrue(events.containsAll(List.of("step-started", "tool-started", "tool-completed", "step-completed")));
    verify(recorder).succeedWhileLeased(eq("invocation-1"), anyMap(), eq("execution-1"), eq("worker-1"));
  }

  @Test
  void invalidPlanGetsOneCorrectionRoundWithViolations() {
    when(model.plan(any()))
        .thenReturn(ready(Map.of("object", "easyv-forge-task", "measures", List.of("nope"), "time", ALL_TIME)))
        .thenReturn(ready(COUNT_QUERY));
    when(queries.execute(any(), any())).thenReturn(result(Map.of("count", 3, "successRate", 100.0)));
    when(model.compose(any(), any())).thenReturn(answer(List.of(new Citation("q1", 0, "count"))));

    run(initialTurn(), ALL);

    ArgumentCaptor<PlanRequest> requests = ArgumentCaptor.forClass(PlanRequest.class);
    verify(model, times(2)).plan(requests.capture());
    assertEquals(List.of(), requests.getAllValues().get(0).violations());
    assertTrue(requests.getAllValues().get(1).violations().getFirst().startsWith("查询 q1："));
    assertEquals("2026-09-28", requests.getAllValues().get(0).anchorDate());
    assertEquals("Asia/Shanghai", requests.getAllValues().get(0).zone());
  }

  @Test
  void planFailingTwiceFailsLoudWithoutQuerying() {
    when(model.plan(any())).thenReturn(ready(Map.of("object", "unknown-object", "measures", List.of("count"), "time", ALL_TIME)));

    assertCode("EASYV_PLAN_INVALID", () -> run(initialTurn(), ALL));
    verify(queries, never()).execute(any(), any());
    verify(recorder).failWhileLeased(eq("invocation-1"), eq("EASYV_PLAN_INVALID"), anyString(), eq("execution-1"),
        eq("worker-1"));
  }

  @Test
  void queriesOutsideTheEasyVDomainAreRejected() {
    SemanticModel semantic = SemanticModel.discover();
    String foreign = semantic.contributions().stream()
        .filter(item -> !EasyVGenerationOntology.DOMAIN_KEY.equals(item.domainKey()))
        .flatMap(item -> item.objects().stream()).map(object -> object.key()).findFirst().orElse(null);
    if (foreign == null) return;
    when(model.plan(any())).thenReturn(ready(Map.of("object", foreign, "measures", List.of("count"), "time", ALL_TIME)));

    assertCode("EASYV_PLAN_INVALID", () -> run(initialTurn(), ALL));
  }

  @Test
  void clarifyCarriesStructuredQuestionAndOptions() {
    when(model.plan(any()))
        .thenReturn(new PlanDecision(PlanStatus.CLARIFY, List.of(), "指哪一周？", List.of("本周", "上周")));

    BackendException clarify = assertThrows(BackendException.class, () -> run(initialTurn(), ALL));

    assertEquals("EASYV_CLARIFICATION_REQUIRED", clarify.code());
    assertTrue(clarify.getMessage().contains("本周 / 上周"));
    BackendException.Clarification clarification = clarify.clarification().orElseThrow();
    assertEquals("指哪一周？", clarification.question());
    assertEquals(List.of("本周", "上周"), clarification.options());
  }

  @Test
  void clarificationOptionsAreNormalizedToTheContractLimit() {
    when(model.plan(any()))
        .thenReturn(new PlanDecision(PlanStatus.CLARIFY, List.of(), "指哪一周？",
            List.of(" 本周 ", " ", "上周", "本周", "上月", "上月 ", "", "昨天", "今天", "明天")));

    BackendException clarify = assertThrows(BackendException.class, () -> run(initialTurn(), ALL));

    BackendException.Clarification clarification = clarify.clarification().orElseThrow();
    assertEquals(List.of("本周", "上周", "上月", "昨天", "今天", "明天"), clarification.options());
    assertEquals(6, clarification.options().size());
    assertTrue(clarify.getMessage().contains("可选：本周 / 上周 / 上月 / 昨天 / 今天 / 明天。"));
  }

  @Test
  void ambiguousTimeClarificationCarriesStructuredCandidates() {
    when(model.plan(any())).thenReturn(ready(Map.of("object", "easyv-forge-task",
        "measures", List.of("count"),
        "time", Map.of("expression", Map.of("sourceText", "前阵子", "kind", "ambiguous", "candidates", List.of(
            Map.of("sourceText", "最近 7 天", "kind", "relative", "unit", "day", "n", 7),
            Map.of("sourceText", "最近 30 天", "kind", "relative", "unit", "day", "n", 30)))))));

    BackendException ambiguous = assertThrows(BackendException.class, () -> run(initialTurn(), ALL));

    assertEquals("EASYV_CLARIFICATION_REQUIRED", ambiguous.code());
    BackendException.Clarification clarification = ambiguous.clarification().orElseThrow();
    assertEquals("“前阵子”指哪段时间？", clarification.question());
    assertEquals(List.of("最近 7 天", "最近 30 天"), clarification.options());
  }

  @Test
  void planSnapshotExposesUnderstandingCoverageAndEditorCatalog() {
    Map<String, Object> taskQuery = Map.of("object", "easyv-forge-task",
        "measures", List.of("count", "successRate"), "dimensions", List.of("status"),
        "filters", List.of(Map.of("member", "status", "operator", "not-equals", "values", List.of("cancelled"))),
        "time", ALL_TIME);
    Map<String, Object> feedbackQuery = Map.of("object", "easyv-generation-feedback",
        "measures", List.of("count"), "limit", 10,
        "time", Map.of("dimension", "operatedAt", "granularity", "day",
            "expression", Map.of("sourceText", "最近 30 天", "kind", "relative", "unit", "day", "n", 30)));
    when(model.plan(any()))
        .thenReturn(new PlanDecision(PlanStatus.READY, List.of(taskQuery, feedbackQuery), null, List.of()));
    when(queries.execute(any(), any())).thenReturn(result(Map.of("count", 8, "successRate", 80.0)));
    when(model.compose(any(), any())).thenReturn(answer(List.of(new Citation("q1", 0, "count"))));

    WorkflowResult result = run(initialTurn(), ALL);

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> understanding =
        (List<Map<String, Object>>) result.plan().get("_understanding");
    assertEquals(2, understanding.size());

    Map<String, Object> first = understanding.get(0);
    assertEquals("q1", first.get("id"));
    assertEquals(Map.of("key", "easyv-forge-task", "label", "应用生成任务"), first.get("object"));
    assertEquals(
        List.of(Map.of("key", "count", "label", "生成任务数"),
            Map.of("key", "successRate", "label", "生成成功率（%）")),
        first.get("measures"));
    assertEquals(List.of(Map.of("key", "status", "label", "任务状态")), first.get("dimensions"));
    assertEquals(
        List.of(Map.of("member", "status", "label", "任务状态", "operator", "not-equals",
            "values", List.of("cancelled"))),
        first.get("filters"));
    @SuppressWarnings("unchecked")
    Map<String, Object> firstTime = (Map<String, Object>) first.get("time");
    assertEquals("createdAt", firstTime.get("dimension"));
    assertEquals("任务创建时间", firstTime.get("label"));
    assertEquals("全部", firstTime.get("sourceText"));
    assertEquals("all", firstTime.get("kind"));
    assertNull(firstTime.get("from"));
    assertEquals("2026-09-28", firstTime.get("to"));
    assertEquals(Boolean.TRUE, firstTime.get("allData"));
    assertNull(firstTime.get("granularity"));
    assertNull(first.get("compare"));
    assertNull(first.get("limit"));
    @SuppressWarnings("unchecked")
    Map<String, Object> firstCoverage = (Map<String, Object>) first.get("coverage");
    assertEquals("full", firstCoverage.get("status"));
    assertEquals("2026-01-01", firstCoverage.get("dataFrom"));
    assertEquals("2026-09-27", firstCoverage.get("dataTo"));
    assertEquals("2026-01-01", firstCoverage.get("effectiveFrom"));
    assertEquals("2026-09-27", firstCoverage.get("effectiveTo"));

    Map<String, Object> second = understanding.get(1);
    assertEquals("q2", second.get("id"));
    assertEquals(Map.of("key", "easyv-generation-feedback", "label", "操作反馈"), second.get("object"));
    assertEquals(List.of(), second.get("dimensions"));
    assertEquals(List.of(), second.get("filters"));
    assertEquals(10, second.get("limit"));
    @SuppressWarnings("unchecked")
    Map<String, Object> secondTime = (Map<String, Object>) second.get("time");
    assertEquals("operatedAt", secondTime.get("dimension"));
    assertEquals("relative", secondTime.get("kind"));
    assertEquals("2026-08-30", secondTime.get("from"));
    assertEquals("day", secondTime.get("granularity"));
    @SuppressWarnings("unchecked")
    Map<String, Object> secondCoverage = (Map<String, Object>) second.get("coverage");
    assertEquals("partial", secondCoverage.get("status"));
    assertEquals("2026-08-30", secondCoverage.get("effectiveFrom"));
    assertEquals("2026-09-27", secondCoverage.get("effectiveTo"));

    @SuppressWarnings("unchecked")
    Map<String, Object> catalog = (Map<String, Object>) result.plan().get("_editorCatalog");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> objects = (List<Map<String, Object>>) catalog.get("objects");
    assertEquals(List.of("easyv-forge-task", "easyv-generation-feedback"),
        objects.stream().map(item -> item.get("key")).toList());
    Map<String, Object> task = objects.get(0);
    assertEquals("应用生成任务", task.get("label"));
    assertEquals("createdAt", task.get("defaultTime"));
    assertTrue(((List<?>) task.get("measures")).size() >= 10);
    @SuppressWarnings("unchecked")
    List<String> dimensionKeys = ((List<Map<String, Object>>) task.get("dimensions")).stream()
        .map(item -> (String) item.get("key")).toList();
    assertTrue(dimensionKeys.containsAll(List.of("status", "appId", "application.userId")));
    assertTrue(dimensionKeys.stream().noneMatch("createdAt"::equals));
    @SuppressWarnings("unchecked")
    List<String> timeKeys = ((List<Map<String, Object>>) task.get("timeDimensions")).stream()
        .map(item -> (String) item.get("key")).toList();
    assertEquals(List.of("createdAt", "startedAt", "finishedAt", "application.createdAt"), timeKeys);
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> linkDimensions = ((List<Map<String, Object>>) task.get("dimensions"))
        .stream().filter(item -> item.get("key").toString().startsWith("application.")).toList();
    assertTrue(linkDimensions.stream().allMatch(item -> item.get("label").toString().startsWith("AI 应用·")));
  }

  @Test
  void everyCatalogMemberCompilesAsAQueryForItsObject() {
    when(model.plan(any())).thenReturn(ready(COUNT_QUERY));
    when(queries.execute(any(), any())).thenReturn(result(Map.of("count", 1, "successRate", 100.0)));
    when(model.compose(any(), any())).thenReturn(answer(List.of(new Citation("q1", 0, "count"))));

    WorkflowResult result = run(initialTurn(), ALL);

    SemanticQueryCompiler compiler = new SemanticQueryCompiler(SemanticModel.discover());
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> objects = (List<Map<String, Object>>) ((Map<String, Object>) result.plan()
        .get("_editorCatalog")).get("objects");
    for (Map<String, Object> object : objects) {
      String objectKey = (String) object.get("key");
      @SuppressWarnings("unchecked")
      List<Map<String, Object>> dimensions = (List<Map<String, Object>>) object.get("dimensions");
      for (Map<String, Object> dimension : dimensions) {
        QueryIntent intent = new QueryIntent(objectKey, List.of("count"),
            List.of((String) dimension.get("key")), List.of(),
            new QueryIntent.TimeSpec(null, allExpression(), null), null, List.of(), null);
        assertTrue(compiler.compile(intent, ANCHOR).accepted(),
            objectKey + " 的目录维度应可编译：" + dimension.get("key"));
      }
      @SuppressWarnings("unchecked")
      List<Map<String, Object>> timeDimensions = (List<Map<String, Object>>) object.get("timeDimensions");
      for (Map<String, Object> timeDimension : timeDimensions) {
        QueryIntent intent = new QueryIntent(objectKey, List.of("count"), List.of(), List.of(),
            new QueryIntent.TimeSpec((String) timeDimension.get("key"), allExpression(), null),
            null, List.of(), null);
        assertTrue(compiler.compile(intent, ANCHOR).accepted(),
            objectKey + " 的目录时间维度应可编译：" + timeDimension.get("key"));
      }
    }
  }

  @Test
  void emptyFrozenDataReportsNoCoverage() {
    when(queries.coverage(any(), any())).thenReturn(new DataCoverage(null, null));
    when(model.plan(any())).thenReturn(ready(COUNT_QUERY));
    when(queries.execute(any(), any())).thenReturn(result(Map.of("count", 0, "successRate", 0.0)));
    when(model.compose(any(), any())).thenReturn(answer(List.of(new Citation("q1", 0, "count"))));

    WorkflowResult result = run(initialTurn(), ALL);

    @SuppressWarnings("unchecked")
    Map<String, Object> coverage = (Map<String, Object>)
        ((List<Map<String, Object>>) result.plan().get("_understanding")).get(0).get("coverage");
    assertEquals("none", coverage.get("status"));
    assertNull(coverage.get("dataFrom"));
    assertNull(coverage.get("effectiveFrom"));
  }

  @Test
  void projectionReportsCoverageStatusToTheComposer() {
    when(model.plan(any())).thenReturn(ready(Map.of("object", "easyv-forge-task",
        "measures", List.of("count"),
        "time", Map.of("expression", Map.of("sourceText", "最近 30 天", "kind", "relative", "unit", "day", "n", 30)))));
    when(queries.execute(any(), any())).thenReturn(result(Map.of("count", 8)));
    when(model.compose(any(), any())).thenReturn(answer(List.of(new Citation("q1", 0, "count"))));

    run(initialTurn(), ALL);

    ArgumentCaptor<ComposeRequest> requests = ArgumentCaptor.forClass(ComposeRequest.class);
    verify(model).compose(requests.capture(), any());
    Map<String, Object> projection = requests.getValue().results().getFirst();
    assertEquals("partial", projection.get("coverageStatus"));
    assertEquals("2026-01-01 至 2026-09-27", projection.get("dataCoverage"));
    assertEquals("2026-08-30 至 2026-09-27", projection.get("effectiveRange"));
  }

  @Test
  void structuredOverrideCompilesWithoutCallingTheModel() {
    AgentTurn turn = followUpTurn(Map.of(
        "queries", List.of(COUNT_QUERY),
        "override", List.of(Map.of("id", "q1", "intent", COUNT_QUERY))));
    when(queries.execute(any(), any())).thenReturn(result(Map.of("count", 4, "successRate", 100.0)));
    when(model.compose(any(), any())).thenReturn(answer(List.of(new Citation("q1", 0, "count"))));

    WorkflowResult result = run(turn, ALL);

    verify(model, never()).plan(any());
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> steps = (List<Map<String, Object>>) result.plan().get("steps");
    assertEquals("应用结构化调整", steps.getFirst().get("title"));
    assertEquals("structured-adjustment", steps.getFirst().get("kind"));
  }

  @Test
  void invalidOverrideFailsLoudWithoutModelFallback() {
    AgentTurn turn = followUpTurn(Map.of(
        "queries", List.of(COUNT_QUERY),
        "override", List.of(Map.of("id", "q1", "intent",
            Map.of("object", "easyv-forge-task", "measures", List.of("nope"), "time", ALL_TIME)))));

    BackendException error = assertThrows(BackendException.class, () -> run(turn, ALL));

    assertEquals("EASYV_OVERRIDE_INVALID", error.code());
    assertTrue(error.getMessage().contains("q1"));
    verify(model, never()).plan(any());
    verify(queries, never()).execute(any(), any());
  }

  @Test
  void clarifyUnsupportedAndAmbiguousTimeFailLoud() {
    when(model.plan(any()))
        .thenReturn(new PlanDecision(PlanStatus.CLARIFY, List.of(), "指哪一周？", List.of("本周", "上周")))
        .thenReturn(new PlanDecision(PlanStatus.UNSUPPORTED, List.of(), "没有注册时间", List.of()))
        .thenReturn(ready(Map.of("object", "easyv-forge-task", "measures", List.of("count"),
            "time", Map.of("expression", Map.of("sourceText", "前阵子", "kind", "ambiguous", "candidates", List.of(
                Map.of("sourceText", "最近 7 天", "kind", "relative", "unit", "day", "n", 7),
                Map.of("sourceText", "最近 30 天", "kind", "relative", "unit", "day", "n", 30)))))));

    BackendException clarify = assertThrows(BackendException.class, () -> run(initialTurn(), ALL));
    assertEquals("EASYV_CLARIFICATION_REQUIRED", clarify.code());
    assertTrue(clarify.getMessage().contains("本周 / 上周"));
    assertCode("EASYV_QUESTION_UNSUPPORTED", () -> run(initialTurn(), ALL));
    BackendException ambiguous = assertThrows(BackendException.class, () -> run(initialTurn(), ALL));
    assertEquals("EASYV_CLARIFICATION_REQUIRED", ambiguous.code());
    assertTrue(ambiguous.getMessage().contains("最近 7 天 / 最近 30 天"));
  }

  @Test
  void ungroundedAnswerGetsOneCorrectionThenFailsLoud() {
    when(model.plan(any())).thenReturn(ready(COUNT_QUERY));
    when(queries.execute(any(), any())).thenReturn(result(Map.of("count", 12, "successRate", 75.0)));
    when(model.compose(any(), any()))
        .thenReturn(answer(List.of(new Citation("q9", 0, "count"))))
        .thenReturn(answer(List.of(new Citation("q1", 3, "count"))));

    BackendException error = assertThrows(BackendException.class, () -> run(initialTurn(), ALL));

    assertEquals("EASYV_ANSWER_UNGROUNDED", error.code());
    ArgumentCaptor<ComposeRequest> requests = ArgumentCaptor.forClass(ComposeRequest.class);
    verify(model, times(2)).compose(requests.capture(), any());
    assertTrue(requests.getAllValues().get(1).violations().getFirst().contains("q9"));
  }

  @Test
  void answerWithoutCitationsIsCorrectedAndEmptyResultsCiteTheScopeEvidence() {
    when(model.plan(any())).thenReturn(ready(COUNT_QUERY));
    when(queries.execute(any(), any())).thenReturn(new SemanticQueryResult(List.of(), List.of(), "select 1"));
    when(model.compose(any(), any())).thenReturn(answer(List.of()));

    WorkflowResult result = run(initialTurn(), ALL);

    assertEquals(List.of("easyv-data-scope"), result.evidence().stream().map(item -> item.source()).toList());
    assertEquals("easyv-data-scope", result.claims().getFirst().evidenceRefs().getFirst().source());
    verify(model, times(1)).compose(any(), any());
  }

  @Test
  void nullOnlyRowsFallBackToScopeEvidence() {
    // 复现线上失败：所选区间完全无数据时比率指标返回单行 null（0/0），
    // 聚合后无可引用数据点；回答应落数据范围证据而非 EASYV_ANSWER_UNGROUNDED
    Map<String, Object> rateQuery = Map.of("object", "easyv-forge-task",
        "measures", List.of("successRate"),
        "time", Map.of("expression", Map.of(
            "sourceText", "上个月", "kind", "calendar", "unit", "month", "offset", -1)));
    Map<String, Object> reasonQuery = Map.of("object", "easyv-forge-task",
        "measures", List.of("count"), "dimensions", List.of("failureReason"), "limit", 5,
        "time", Map.of("expression", Map.of(
            "sourceText", "上个月", "kind", "calendar", "unit", "month", "offset", -1)));
    when(model.plan(any()))
        .thenReturn(new PlanDecision(PlanStatus.READY, List.of(rateQuery, reasonQuery), null, List.of()));
    Map<String, Object> nullRow = new java.util.LinkedHashMap<>();
    nullRow.put("successRate", null);
    when(queries.execute(any(), any()))
        .thenReturn(new SemanticQueryResult(List.of(nullRow), List.of(), "select 1"))
        .thenReturn(new SemanticQueryResult(List.of(), List.of(), "select 1"));
    when(model.compose(any(), any())).thenReturn(answer(List.of()));

    WorkflowResult result = run(initialTurn(), ALL);

    GroundedConclusion.Claim claim = result.claims().getFirst();
    assertEquals(1, claim.evidenceRefs().size());
    GroundedConclusion.EvidenceReference ref = claim.evidenceRefs().getFirst();
    assertEquals("easyv-data-scope", ref.source());
    assertEquals("resultRows", ref.field());
    assertEquals(1, ref.value());
    verify(model, times(1)).compose(any(), any());
  }

  @Test
  void emptyCitationsStillFailLoudWhenCitableValuesExist() {
    when(model.plan(any())).thenReturn(ready(COUNT_QUERY));
    when(queries.execute(any(), any())).thenReturn(result(Map.of("count", 12, "successRate", 75.0)));
    when(model.compose(any(), any())).thenReturn(answer(List.of()));

    BackendException error = assertThrows(BackendException.class, () -> run(initialTurn(), ALL));

    assertEquals("EASYV_ANSWER_UNGROUNDED", error.code());
    assertTrue(error.getMessage().contains("citations"));
    verify(model, times(2)).compose(any(), any());
  }

  @Test
  void followUpPassesPreviousQueriesAndRequiresThem() {
    when(model.plan(any())).thenReturn(ready(COUNT_QUERY));
    when(queries.execute(any(), any())).thenReturn(result(Map.of("count", 12, "successRate", 75.0)));
    when(model.compose(any(), any())).thenReturn(answer(List.of(new Citation("q1", 0, "count"))));

    run(followUpTurn(Map.of("queries", List.of(COUNT_QUERY))), ALL);

    ArgumentCaptor<PlanRequest> request = ArgumentCaptor.forClass(PlanRequest.class);
    verify(model).plan(request.capture());
    assertEquals(List.of(COUNT_QUERY), request.getValue().previousQueries());
    assertEquals("上一轮", request.getValue().previousConclusion().get("title"));
    assertCode("FOLLOW_UP_CONTEXT_INVALID", () -> run(followUpTurn(Map.of()), ALL));
  }

  @Test
  void legacyScopeSnapshotAndMissingLeaseAreRejected() {
    assertCode("EASYV_SCOPE_INVALID", () -> run(initialTurn(),
        new ResolvedScopeSnapshot("easyv", 1, Map.of("userId", "7", "accessMode", "all"))));
    assertCode("JOB_LEASE_REQUIRED", () -> agent.execute(principal(), initialTurn(), "execution-1", ontology(),
        "easyv-set-1", ALL, "trace-1", " ", progress));
    verify(model, never()).plan(any());
  }

  private WorkflowResult run(AgentTurn turn, ResolvedScopeSnapshot scope) {
    return agent.execute(principal(), turn, "execution-1", ontology(), "easyv-set-1", scope, "trace-1", "worker-1",
        progress);
  }

  private static PlanDecision ready(Map<String, Object> query) {
    return new PlanDecision(PlanStatus.READY, List.of(query), null, List.of());
  }

  private static SemanticQueryResult result(Map<String, Object> row) {
    return new SemanticQueryResult(List.of(row), List.of(), "select 1");
  }

  private static ComposedAnswer answer(List<Citation> citations) {
    return new ComposedAnswer("共 12 个任务，成功率 75%", citations, List.of(new Highlight("q1", "table")),
        List.of("追问 1"), List.of());
  }

  private static TimeExpression allExpression() {
    return new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null);
  }

  private static AgentTurn initialTurn() {
    return new AgentTurn(ExecutionRepository.INITIAL_EXECUTION_CONTRACT, "session-1", "EasyV 生成任务数和成功率",
        null, null, Map.of(), Map.of(), ANCHOR);
  }

  private static AgentTurn followUpTurn(Map<String, Object> context) {
    return new AgentTurn(ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, "session-1", "按月看一下",
        "follow-up-1", "execution-0", Map.of("title", "上一轮", "summary", "共 12 个任务"), context, ANCHOR);
  }

  private static AuthSession principal() {
    return new AuthSession("auth-1", "7", "用户", new AccessScope("org-1", List.of(), List.of(), List.of()),
        Instant.MAX);
  }

  private static OntologyCatalog ontology() {
    return new OntologyCatalog("easyv-v2", "2.0.0", List.of(), List.of(), List.of(), List.of(), List.of(),
        List.of(), List.of());
  }

  private static void assertCode(String code, Supplier<?> action) {
    assertEquals(code, assertThrows(BackendException.class, action::get).code());
  }
}
