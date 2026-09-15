package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVQueryCatalog;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;

class EasyVGenerationWorkflowTest {
  private static final Instant REQUESTED_AT = Instant.parse("2026-08-19T03:00:00Z");
  private static final LocalDate FROM = LocalDate.of(2026, 8, 1);
  private static final LocalDate TO = LocalDate.of(2026, 8, 18);

  @Test
  void questionDrivenResultFollowsPlannerKeysAndComposerAnswer() {
    StubFacts facts = new StubFacts(facts(REQUESTED_AT.minusSeconds(1)));
    StubAnalyst analyst = new StubAnalyst(
        List.of("user-count", "user-first-active"),
        new EasyVQuestionAnalyst.ComposedAnswer(
            "采集范围内有 3 个操作用户；没有注册时间字段，按首次创建应用时间列出。",
            List.of(new EasyVQuestionAnalyst.Highlight("user-first-active", "table"))));

    WorkflowResult result = new EasyVGenerationWorkflow(facts, analyst).execute(request());

    assertEquals(List.of("user-count", "user-first-active"), facts.queriedKeys);
    assertEquals(
        List.of("easyv-ai-application", "easyv-pipeline-node", "easyv-forge-task",
            "easyv-generation-feedback", "easyv-query:user-count", "easyv-query:user-first-active"),
        result.evidence().stream().map(item -> item.source()).toList());
    assertEquals(1, result.claims().size());
    assertEquals("direct-answer", result.claims().getFirst().kind());
    assertEquals("question-driven-read-only", result.plan().get("mode"));
    assertEquals("EasyV 数据问答", result.plan().get("summary"));
    assertEquals(
        "采集范围内有 3 个操作用户；没有注册时间字段，按首次创建应用时间列出。",
        result.conclusion());
    List<Map<String, Object>> steps = (List<Map<String, Object>>) result.plan().get("steps");
    assertEquals("分析问题并规划查询", steps.get(1).get("title"));
    assertEquals("基于事实生成回答", steps.get(steps.size() - 1).get("title"));
    // 块结构：每个查询一个块；highlight 的查询为 primary，其余 supporting
    Map<String, Object> userBlock = result.renderBlocks().stream()
        .filter(block -> "各用户首次创建应用时间".equals(block.get("title"))).findFirst().orElseThrow();
    assertEquals("table", userBlock.get("type"));
    assertEquals("primary", userBlock.get("role"));
    Map<String, Object> countBlock = result.renderBlocks().stream()
        .filter(block -> "操作用户数".equals(block.get("title"))).findFirst().orElseThrow();
    assertEquals("kv-list", countBlock.get("type"));
    assertEquals("supporting", countBlock.get("role"));
  }

  @Test
  void plannerFailureFallsBackToDefaultOverviewQueries() {
    StubFacts facts = new StubFacts(facts(REQUESTED_AT.minusSeconds(1)));
    StubAnalyst analyst = new StubAnalyst(
        new BackendException("EASYV_PLAN_INVALID", "bad plan"),
        new EasyVQuestionAnalyst.ComposedAnswer("总览回答", List.of()));

    WorkflowResult result = new EasyVGenerationWorkflow(facts, analyst).execute(request());

    assertEquals(EasyVQueryCatalog.DEFAULT_KEYS, facts.queriedKeys);
    assertEquals("总览回答", result.conclusion());
  }

  @Test
  void composerFailurePropagates() {
    StubFacts facts = new StubFacts(facts(REQUESTED_AT.minusSeconds(1)));
    StubAnalyst analyst = new StubAnalyst(
        List.of("user-count"),
        new BackendException("EASYV_ANSWER_INVALID", "bad answer"));

    assertEquals("EASYV_ANSWER_INVALID",
        assertThrows(BackendException.class,
            () -> new EasyVGenerationWorkflow(facts, analyst).execute(request())).code());
  }

  @Test
  void evidenceReferenceValueMustBeScalarPerPublishedContract() {
    assertThrows(
        IllegalArgumentException.class,
        () -> new GroundedConclusion.EvidenceReference("src", 0, "field", Map.of("a", 1L)));
    new GroundedConclusion.EvidenceReference("src", 0, "field", "文本");
    new GroundedConclusion.EvidenceReference("src", 0, "field", 1L);
    new GroundedConclusion.EvidenceReference("src", 0, "field", true);
  }

  @Test
  void permitsQueryCompletionSlightlyAfterRequestButRejectsFarFutureAndOldFacts() {
    run(facts(REQUESTED_AT.plusSeconds(5 * 60)));
    run(facts(REQUESTED_AT.minusSeconds(24 * 60 * 60)));
    assertEquals(
        "EASYV_FACTS_STALE",
        assertThrows(
                BackendException.class,
                () -> run(facts(REQUESTED_AT.plusMillis(5 * 60 * 1000L + 1))))
            .code());
    assertEquals(
        "EASYV_FACTS_STALE",
        assertThrows(
                BackendException.class,
                () -> run(facts(REQUESTED_AT.minusMillis(24 * 60 * 60 * 1000L + 1))))
            .code());
    assertEquals(
        "EASYV_FACTS_SCOPE_INVALID",
        assertThrows(
                BackendException.class,
                () -> run(facts(null)))
            .code());
  }

  @Test
  void eachEmptySourceIsReportedAsFactsEmpty() {
    EasyVGenerationFacts.Snapshot base = facts(REQUESTED_AT);
    assertCode("EASYV_FACTS_EMPTY", () -> run(emptyApplication(base)));
    assertCode("EASYV_FACTS_EMPTY", () -> run(emptyPipeline(base)));
    assertCode("EASYV_FACTS_EMPTY", () -> run(emptyForge(base)));
    assertCode("EASYV_FACTS_EMPTY", () -> run(emptyFeedback(base)));
  }

  @Test
  void anySingleSourceWindowMismatchIsRejected() {
    EasyVGenerationFacts.Snapshot base = facts(REQUESTED_AT);
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> run(new EasyVGenerationFacts.Snapshot(
        new EasyVGenerationFacts.ApplicationFacts(window("124", "all", FROM, TO, REQUESTED_AT), 10, 8),
        base.pipeline(), base.forge(), base.feedback())));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> run(new EasyVGenerationFacts.Snapshot(
        base.application(), new EasyVGenerationFacts.PipelineFacts(window("123", "all", FROM.minusDays(1), TO, REQUESTED_AT),
            10, 6, 2, 2, 10, 9, "Step2-Main", 1200,
            List.of(new EasyVGenerationFacts.StageDuration("Step2-Main", 1200, 9))), base.forge(), base.feedback())));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> run(new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), new EasyVGenerationFacts.ForgeFacts(window("123", "other-mode", FROM, TO, REQUESTED_AT),
            10, 7, 2, 1, 10, 9, 100, 300, Map.of("unknown", 2L)), base.feedback())));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> run(new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), base.forge(), new EasyVGenerationFacts.FeedbackFacts(
            window("123", "all", FROM, TO.plusDays(1), REQUESTED_AT), 6, 2, 4.5, 1, 5, 1))));
  }

  @Test
  void eachSingleSourceNullFreshnessIsRejected() {
    EasyVGenerationFacts.Snapshot base = facts(REQUESTED_AT);
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> run(new EasyVGenerationFacts.Snapshot(
        new EasyVGenerationFacts.ApplicationFacts(window("123", "all", FROM, TO, null), 10, 8),
        base.pipeline(), base.forge(), base.feedback())));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> run(new EasyVGenerationFacts.Snapshot(
        base.application(), new EasyVGenerationFacts.PipelineFacts(window("123", "all", FROM, TO, null),
            10, 6, 2, 2, 10, 9, "Step2-Main", 1200,
            List.of(new EasyVGenerationFacts.StageDuration("Step2-Main", 1200, 9))), base.forge(), base.feedback())));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> run(new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), new EasyVGenerationFacts.ForgeFacts(window("123", "all", FROM, TO, null),
            10, 7, 2, 1, 10, 9, 100, 300, Map.of("unknown", 2L)), base.feedback())));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> run(new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), base.forge(), new EasyVGenerationFacts.FeedbackFacts(
            window("123", "all", FROM, TO, null), 6, 2, 4.5, 1, 5, 1))));
  }

  @Test
  void partialAndInconsistentFactsFailLoudly() {
    EasyVGenerationFacts.Snapshot base = facts(REQUESTED_AT);
    assertCode("EASYV_FACTS_INCOMPLETE", () -> run(new EasyVGenerationFacts.Snapshot(
        base.application(), null, base.forge(), base.feedback())));
    assertCode("EASYV_FACTS_INCOMPLETE", () -> run(new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), base.forge(), new EasyVGenerationFacts.FeedbackFacts(
            base.feedback().window(), 6, 7, 4.5, 1, 5, 1))));
    assertCode("EASYV_FACTS_INCOMPLETE", () -> run(new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), new EasyVGenerationFacts.ForgeFacts(base.forge().window(),
            10, 7, 2, 1, 10, 9, 100, 300, Map.of("unknown", 1L)), base.feedback())));
  }

  @Test
  void rejectsMissingOrInternallyInconsistentAggregateFacts() {
    assertEquals(
        "EASYV_FACTS_INCOMPLETE",
        assertThrows(BackendException.class, () -> run(null)).code());
    EasyVGenerationFacts.Snapshot invalid =
        new EasyVGenerationFacts.Snapshot(
            new EasyVGenerationFacts.ApplicationFacts(window(REQUESTED_AT), 1, 2),
            new EasyVGenerationFacts.PipelineFacts(window(REQUESTED_AT), 2, 1, 1, 1, 1, 0, "Step2", 10,
            List.of(new EasyVGenerationFacts.StageDuration("Step2", 10, 1))),
            new EasyVGenerationFacts.ForgeFacts(window(REQUESTED_AT), 1, 1, 0, 0, 1, 0, 1, 2, Map.of()),
            new EasyVGenerationFacts.FeedbackFacts(window(REQUESTED_AT), 1, 0, 0, 0, 0, 0));
    assertEquals(
        "EASYV_FACTS_INCOMPLETE",
        assertThrows(BackendException.class, () -> run(invalid)).code());
  }

  private static void run(EasyVGenerationFacts.Snapshot snapshot) {
    new EasyVGenerationWorkflow(new StubFacts(snapshot), StubAnalyst.simple()).execute(request());
  }

  private static EasyVGenerationFacts.Snapshot emptyApplication(EasyVGenerationFacts.Snapshot base) {
    return new EasyVGenerationFacts.Snapshot(
        new EasyVGenerationFacts.ApplicationFacts(base.application().window(), 0, 0),
        base.pipeline(), base.forge(), base.feedback());
  }

  private static EasyVGenerationFacts.Snapshot emptyPipeline(EasyVGenerationFacts.Snapshot base) {
    return new EasyVGenerationFacts.Snapshot(
        base.application(),
        new EasyVGenerationFacts.PipelineFacts(base.pipeline().window(), 0, 0, 0, 0, 0, 0, "Step2-Main", 0, List.of()),
        base.forge(), base.feedback());
  }

  private static EasyVGenerationFacts.Snapshot emptyForge(EasyVGenerationFacts.Snapshot base) {
    return new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(),
        new EasyVGenerationFacts.ForgeFacts(base.forge().window(), 0, 0, 0, 0, 0, 0, 0, 0, Map.of()),
        base.feedback());
  }

  private static EasyVGenerationFacts.Snapshot emptyFeedback(EasyVGenerationFacts.Snapshot base) {
    return new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), base.forge(),
        new EasyVGenerationFacts.FeedbackFacts(base.feedback().window(), 0, 0, 0, 0, 0, 0));
  }

  private static void assertCode(String expected, Executable action) {
    assertEquals(expected, assertThrows(BackendException.class, action).code());
  }

  private static EasyVGenerationFacts.FactWindow window(
      String userId, String accessMode, LocalDate from, LocalDate to, Instant freshness) {
    return new EasyVGenerationFacts.FactWindow(userId, accessMode, from, to, freshness);
  }

  private static EasyVGenerationRequest request() {
    return new EasyVGenerationRequest(
        "java-initial-v1", "execution-1", "session-1", "现在系统有多少用户了", "easyv-ontology-v1",
        "easyv-set-1",
        EasyVGenerationOntology.ENTITY_KEY, EasyVGenerationOntology.METRIC_KEY,
        EasyVGenerationOntology.TIME_KEY, ontology(), FROM, TO, "123", "all", Map.of(), REQUESTED_AT,
        null, null);
  }

  private static EasyVGenerationFacts.Snapshot facts(Instant freshness) {
    return new EasyVGenerationFacts.Snapshot(
        new EasyVGenerationFacts.ApplicationFacts(window(freshness), 10, 8),
        new EasyVGenerationFacts.PipelineFacts(window(freshness), 10, 6, 2, 2, 10, 9, "Step2-Main", 1200,
            List.of(
                new EasyVGenerationFacts.StageDuration("Step2-Main", 1200, 5),
                new EasyVGenerationFacts.StageDuration("Step1-Extract", 400, 4))),
        new EasyVGenerationFacts.ForgeFacts(window(freshness), 10, 7, 2, 1, 10, 9, 100, 300, Map.of("unknown", 2L)),
        new EasyVGenerationFacts.FeedbackFacts(window(freshness), 6, 2, 4.5, 1, 5, 1),
        Map.of(
            "easyv-ai-application", "product-easyv-ai-application",
            "easyv-prototype-task", "product-easyv-prototype-task",
            "easyv-pipeline-node", "product-easyv-pipeline-node",
            "easyv-forge-task", "product-easyv-forge-task",
            "easyv-generation-feedback", "product-easyv-generation-feedback"));
  }

  private static EasyVGenerationFacts.FactWindow window(Instant freshness) {
    return new EasyVGenerationFacts.FactWindow("123", "all", FROM, TO, freshness);
  }

  private static OntologyCatalog ontology() {
    return new OntologyCatalog(
        "easyv-ontology-v1", "1.0.0",
        List.of(new OntologyCatalog.Item(EasyVGenerationOntology.ENTITY_KEY, "应用", Map.of())),
        List.of(new OntologyCatalog.Item(EasyVGenerationOntology.METRIC_KEY, "生成质量", Map.of())),
        List.of(), List.of(),
        List.of(new OntologyCatalog.Item(EasyVGenerationOntology.TIME_KEY, "生成日期", Map.of())),
        List.of(), List.of());
  }

  private static final class StubFacts implements EasyVGenerationFacts {
    private final Snapshot snapshot;
    private final List<String> queriedKeys = new ArrayList<>();

    private StubFacts(Snapshot snapshot) {
      this.snapshot = snapshot;
    }

    @Override
    public Snapshot collect(Query query) {
      return snapshot;
    }

    @Override
    public Aggregation aggregate(Query query, String queryKey) {
      queriedKeys.add(queryKey);
      EasyVQueryCatalog.Spec spec = EasyVQueryCatalog.require(queryKey);
      List<Map<String, Object>> rows = spec.shape() == EasyVQueryCatalog.Shape.RECORD
          ? List.of(Map.of("user_count", 3L, "application_count", 10L))
          : List.of(
              Map.of("label", "101", "value", 2L),
              Map.of("label", "102", "value", 1L));
      return new Aggregation(rows, "select 1");
    }
  }

  private static final class StubAnalyst implements EasyVQuestionAnalyst {
    private final List<String> keys;
    private final BackendException planError;
    private final ComposedAnswer answer;
    private final BackendException answerError;

    private StubAnalyst(List<String> keys, ComposedAnswer answer) {
      this(keys, null, answer, null);
    }

    private StubAnalyst(BackendException planError, ComposedAnswer answer) {
      this(null, planError, answer, null);
    }

    private StubAnalyst(List<String> keys, BackendException answerError) {
      this(keys, null, null, answerError);
    }

    private StubAnalyst(List<String> keys, BackendException planError,
                        ComposedAnswer answer, BackendException answerError) {
      this.keys = keys;
      this.planError = planError;
      this.answer = answer;
      this.answerError = answerError;
    }

    static StubAnalyst simple() {
      return new StubAnalyst(List.of("ai-application-count"),
          new ComposedAnswer("回答", List.of()));
    }

    @Override
    public List<String> planQueries(String question, List<EasyVQueryCatalog.Spec> catalog) {
      if (planError != null) {
        throw planError;
      }
      return keys;
    }

    @Override
    public ComposedAnswer composeAnswer(
        String question, String rangeDescription, List<QueryResult> results) {
      if (answerError != null) {
        throw answerError;
      }
      return answer;
    }
  }
}
