package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;

class EasyVGenerationWorkflowTest {
  private static final Instant REQUESTED_AT = Instant.parse("2026-08-19T03:00:00Z");
  private static final LocalDate FROM = LocalDate.of(2026, 8, 1);
  private static final LocalDate TO = LocalDate.of(2026, 8, 18);

  @Test
  void rendersOnlyTheFiveGroundedClaimsAndStablePlanSteps() {
    WorkflowResult result = new EasyVGenerationWorkflow(query -> facts(REQUESTED_AT.minusSeconds(1))).execute(request());

    assertEquals(
        List.of("easyv-ai-application", "easyv-pipeline-node", "easyv-forge-task", "easyv-generation-feedback"),
        result.evidence().stream().map(item -> item.source()).toList());
    assertEquals(
        List.of("generation-quality", "stage-bottleneck", "failure-concentration", "feedback-association", "business-success-settlement-distinct"),
        result.claims().stream().map(item -> item.kind()).toList());
    assertEquals(7, ((List<?>) result.plan().get("steps")).size());
    assertEquals("deterministic-read-only", result.plan().get("mode"));
    assertEquals("EasyV 生成质量分析", result.plan().get("summary"));
    assertEquals("easyv-ai-application", result.evidence().getFirst().source());
    result.evidence().forEach(item -> assertEquals(
        REQUESTED_AT.minusSeconds(1).toString(),
        item.rows().getFirst().get("freshnessAt")));
    assertEquals(10L, result.evidence().get(1).rows().getFirst().get("mainNodeCount"));
    assertEquals(9L, result.evidence().get(1).rows().getFirst().get("timedNodeCount"));
    assertEquals(10L, result.evidence().get(2).rows().getFirst().get("terminalTaskCount"));
    assertEquals(9L, result.evidence().get(2).rows().getFirst().get("timedTerminalTaskCount"));
    org.junit.jupiter.api.Assertions.assertTrue(result.claims().getFirst().text().contains("9/10"));
    org.junit.jupiter.api.Assertions.assertTrue(result.claims().get(1).text().contains("9/10"));
    String distinct = result.claims().getLast().text();
    org.junit.jupiter.api.Assertions.assertTrue(distinct.contains("不能拆分"));
    result.claims().forEach(claim -> claim.evidenceRefs().forEach(ref -> assertEquals(0, ref.row())));
  }

  @Test
  void permitsQueryCompletionSlightlyAfterRequestButRejectsFarFutureAndOldFacts() {
    new EasyVGenerationWorkflow(query -> facts(REQUESTED_AT.plusSeconds(5 * 60))).execute(request());
    new EasyVGenerationWorkflow(query -> facts(REQUESTED_AT.minusSeconds(24 * 60 * 60))).execute(request());
    assertEquals(
        "EASYV_FACTS_STALE",
        assertThrows(
                BackendException.class,
                () -> new EasyVGenerationWorkflow(query -> facts(REQUESTED_AT.plusMillis(5 * 60 * 1000L + 1))).execute(request()))
            .code());
    assertEquals(
        "EASYV_FACTS_STALE",
        assertThrows(
                BackendException.class,
                () -> new EasyVGenerationWorkflow(query -> facts(REQUESTED_AT.minusMillis(24 * 60 * 60 * 1000L + 1))).execute(request()))
            .code());
    assertEquals(
        "EASYV_FACTS_SCOPE_INVALID",
        assertThrows(
                BackendException.class,
                () -> new EasyVGenerationWorkflow(query -> facts(null)).execute(request()))
            .code());
  }

  @Test
  void eachEmptySourceIsReportedAsFactsEmpty() {
    EasyVGenerationFacts.Snapshot base = facts(REQUESTED_AT);
    assertCode("EASYV_FACTS_EMPTY", () -> new EasyVGenerationWorkflow(query -> emptyApplication(base)).execute(request()));
    assertCode("EASYV_FACTS_EMPTY", () -> new EasyVGenerationWorkflow(query -> emptyPipeline(base)).execute(request()));
    assertCode("EASYV_FACTS_EMPTY", () -> new EasyVGenerationWorkflow(query -> emptyForge(base)).execute(request()));
    assertCode("EASYV_FACTS_EMPTY", () -> new EasyVGenerationWorkflow(query -> emptyFeedback(base)).execute(request()));
  }

  @Test
  void anySingleSourceWindowMismatchIsRejected() {
    EasyVGenerationFacts.Snapshot base = facts(REQUESTED_AT);
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        new EasyVGenerationFacts.ApplicationFacts(window("124", "creator-owned", FROM, TO, REQUESTED_AT), 10, 8),
        base.pipeline(), base.forge(), base.feedback())).execute(request()));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        base.application(), new EasyVGenerationFacts.PipelineFacts(window("123", "creator-owned", FROM.minusDays(1), TO, REQUESTED_AT),
            10, 6, 2, 2, 10, 9, "Step2-Main", 1200), base.forge(), base.feedback())).execute(request()));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), new EasyVGenerationFacts.ForgeFacts(window("123", "other-mode", FROM, TO, REQUESTED_AT),
            10, 7, 2, 1, 10, 9, 100, 300, Map.of("unknown", 2L)), base.feedback())).execute(request()));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), base.forge(), new EasyVGenerationFacts.FeedbackFacts(
            window("123", "creator-owned", FROM, TO.plusDays(1), REQUESTED_AT), 6, 2, 4.5, 1, 5, 1))).execute(request()));
  }

  @Test
  void eachSingleSourceNullFreshnessIsRejected() {
    EasyVGenerationFacts.Snapshot base = facts(REQUESTED_AT);
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        new EasyVGenerationFacts.ApplicationFacts(window("123", "creator-owned", FROM, TO, null), 10, 8),
        base.pipeline(), base.forge(), base.feedback())).execute(request()));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        base.application(), new EasyVGenerationFacts.PipelineFacts(window("123", "creator-owned", FROM, TO, null),
            10, 6, 2, 2, 10, 9, "Step2-Main", 1200), base.forge(), base.feedback())).execute(request()));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), new EasyVGenerationFacts.ForgeFacts(window("123", "creator-owned", FROM, TO, null),
            10, 7, 2, 1, 10, 9, 100, 300, Map.of("unknown", 2L)), base.feedback())).execute(request()));
    assertCode("EASYV_FACTS_SCOPE_INVALID", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), base.forge(), new EasyVGenerationFacts.FeedbackFacts(
            window("123", "creator-owned", FROM, TO, null), 6, 2, 4.5, 1, 5, 1))).execute(request()));
  }

  @Test
  void partialAndInconsistentFactsFailLoudly() {
    EasyVGenerationFacts.Snapshot base = facts(REQUESTED_AT);
    assertCode("EASYV_FACTS_INCOMPLETE", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        base.application(), null, base.forge(), base.feedback())).execute(request()));
    assertCode("EASYV_FACTS_INCOMPLETE", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), base.forge(), new EasyVGenerationFacts.FeedbackFacts(
            base.feedback().window(), 6, 7, 4.5, 1, 5, 1))).execute(request()));
    assertCode("EASYV_FACTS_INCOMPLETE", () -> new EasyVGenerationWorkflow(query -> new EasyVGenerationFacts.Snapshot(
        base.application(), base.pipeline(), new EasyVGenerationFacts.ForgeFacts(base.forge().window(),
            10, 7, 2, 1, 10, 9, 100, 300, Map.of("unknown", 1L)), base.feedback())).execute(request()));
  }

  @Test
  void rejectsMissingOrInternallyInconsistentAggregateFacts() {
    assertEquals(
        "EASYV_FACTS_INCOMPLETE",
        assertThrows(
                BackendException.class,
                () -> new EasyVGenerationWorkflow(query -> null).execute(request()))
            .code());
    EasyVGenerationFacts.Snapshot invalid =
        new EasyVGenerationFacts.Snapshot(
            new EasyVGenerationFacts.ApplicationFacts(window(REQUESTED_AT), 1, 2),
            new EasyVGenerationFacts.PipelineFacts(window(REQUESTED_AT), 2, 1, 1, 1, 1, 0, "Step2", 10),
            new EasyVGenerationFacts.ForgeFacts(window(REQUESTED_AT), 1, 1, 0, 0, 1, 0, 1, 2, Map.of()),
            new EasyVGenerationFacts.FeedbackFacts(window(REQUESTED_AT), 1, 0, 0, 0, 0, 0));
    assertEquals(
        "EASYV_FACTS_INCOMPLETE",
        assertThrows(
                BackendException.class,
                () -> new EasyVGenerationWorkflow(query -> invalid).execute(request()))
            .code());
  }

  private static EasyVGenerationFacts.Snapshot emptyApplication(EasyVGenerationFacts.Snapshot base) {
    return new EasyVGenerationFacts.Snapshot(
        new EasyVGenerationFacts.ApplicationFacts(base.application().window(), 0, 0),
        base.pipeline(), base.forge(), base.feedback());
  }

  private static EasyVGenerationFacts.Snapshot emptyPipeline(EasyVGenerationFacts.Snapshot base) {
    return new EasyVGenerationFacts.Snapshot(
        base.application(),
        new EasyVGenerationFacts.PipelineFacts(base.pipeline().window(), 0, 0, 0, 0, 0, 0, "Step2-Main", 0),
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
        "java-initial-v1", "execution-1", "session-1", "分析大屏生成质量", "easyv-ontology-v1",
        "easyv-set-1",
        EasyVGenerationOntology.ENTITY_KEY, EasyVGenerationOntology.METRIC_KEY,
        EasyVGenerationOntology.TIME_KEY, ontology(), FROM, TO, "123", "creator-owned", Map.of(), REQUESTED_AT);
  }

  private static EasyVGenerationFacts.Snapshot facts(Instant freshness) {
    return new EasyVGenerationFacts.Snapshot(
        new EasyVGenerationFacts.ApplicationFacts(window(freshness), 10, 8),
        new EasyVGenerationFacts.PipelineFacts(window(freshness), 10, 6, 2, 2, 10, 9, "Step2-Main", 1200),
        new EasyVGenerationFacts.ForgeFacts(window(freshness), 10, 7, 2, 1, 10, 9, 100, 300, Map.of("unknown", 2L)),
        new EasyVGenerationFacts.FeedbackFacts(window(freshness), 6, 2, 4.5, 1, 5, 1));
  }

  private static EasyVGenerationFacts.FactWindow window(Instant freshness) {
    return new EasyVGenerationFacts.FactWindow("123", "creator-owned", FROM, TO, freshness);
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
}
