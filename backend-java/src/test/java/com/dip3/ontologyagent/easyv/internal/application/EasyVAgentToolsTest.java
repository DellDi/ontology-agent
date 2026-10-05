package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.capability.api.*;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class EasyVAgentToolsTest {
  private static final String LAYOUT = "easyv-prototype-layout", BLOCK = "easyv-prototype-block", COMPONENT = "easyv-prototype-component";
  private static final ResolvedScopeSnapshot ALL = new ResolvedScopeSnapshot("easyv", 2, Map.of("userId", "7", "accessMode", "all"));
  private final EasyVObjectReadService objects = mock(EasyVObjectReadService.class);
  private final EasyVSchemeAssessmentService assessments = mock(EasyVSchemeAssessmentService.class);
  private final EasyVScopeResolver scopes = mock(EasyVScopeResolver.class);
  private final SemanticModel model = SemanticModel.discover();
  private final Map<String, String> versions = Map.of("easyv-ai-application", "apps-old", LAYOUT, "layouts-old", BLOCK, "blocks-old", COMPONENT, "components-old", "easyv-scheme-library", "schemes-old");
  private final AuthSession principal = new AuthSession("auth", "7", "用户", new AccessScope("org", List.of(), List.of(), List.of()), Instant.MAX);
  private final CapabilityExecutionContext context = new CapabilityExecutionContext(principal,
      new AgentTurn("java-initial-v1", "session", "比较方案", null, null, Map.of(), Map.of(), Instant.now()),
      "execution-old", new OntologyCatalog("ontology-old", "1", List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()), "set-old", "trace", "worker");
  private EasyVAgentTools tools;

  @BeforeEach void setup() {
    tools = new EasyVAgentTools(objects, assessments, new EasyVObjectSelectionService(null, null, null, model), scopes, model, new JsonCodec());
    when(scopes.executionPrincipal(principal)).thenReturn(principal);
    when(scopes.resolveScope(principal)).thenReturn(ALL);
  }

  @Test void listDetailRelationAndAssessmentUseOnlyReturnedHandlesAndFrozenContext() throws Exception {
    var run = tools.open(context, ALL, versions, null, List.of());
    var layout = row(LAYOUT, "1", Map.of("appId", "1"));
    var block = row(BLOCK, "1:b", Map.of("appId", "1", "blockKey", "1:b", "blockId", "b"));
    when(objects.readDuringExecution(eq(context), eq(ALL), any())).thenAnswer(call -> {
      EasyVObjectReadService.Request req = call.getArgument(2);
      return result(req.relation() == null ? LAYOUT : BLOCK, req.relation() == null ? layout : block, false);
    });
    var listed = run.execute("q1", run.prepare("query_objects", Map.of("objectKey", LAYOUT)));
    assertEquals("o1", listed.rows().getFirst().get("handle"));
    assertEquals(false, listed.observation().get("hasMore"));
    var related = run.execute("q2", run.prepare("traverse_objects", Map.of("handle", "o1", "relation", "blocks")));
    assertEquals("o2", related.rows().getFirst().get("handle"));
    assertEquals("1:b", related.references().getFirst().objectId());
    assertEquals("set-old", related.renderBlock().get("datasetVersionSetId"));
    when(objects.readDuringExecution(eq(context), eq(ALL), argThat(req -> "1:b".equals(req.objectId())))).thenReturn(result(BLOCK, block, false));
    var fixture = assessmentFixture();
    var assessment = new EasyVSchemeAssessmentService.Result(fixture.assessmentId(), fixture.selection(), fixture.ontologyVersionId(), versions,
        fixture.status(), fixture.reason(), fixture.geometry(), fixture.candidateInputs(), fixture.comparison());
    when(assessments.assessDuringExecution(eq(context), eq(ALL), eq(assessment.selection()))).thenReturn(assessment);
    var assessed = run.execute("q3", run.prepare("assess_scheme", Map.of("handle", "o2")));
    assertEquals("scheme-comparison", assessed.renderBlock().get("type"));
    assertEquals("primary", assessed.renderBlock().get("role"));
    assertEquals(assessment.comparison().current().score(), assessed.rows().getFirst().get("score"));
    assertEquals(true, assessed.observation().get("candidateSetComplete"));
    assertEquals(versions, assessed.audit().get("productVersionIds"));
    verify(objects, atLeastOnce()).readDuringExecution(eq(context), eq(ALL), argThat(req -> req.executionId().equals(context.executionId()) && req.datasetVersionSetId().equals(context.datasetVersionSetId())));
  }

  @Test void strictInputsRejectForgedIdsVersionsHandlesAndRelationsBeforeFacts() {
    var run = tools.open(context, ALL, versions, null, List.of());
    for (var input : List.<Map<String, Object>>of(Map.of("objectKey", LAYOUT, "objectId", "invented"), Map.of("objectKey", LAYOUT, "productVersionId", "new"),
        Map.of("objectKey", LAYOUT, "filters", List.of(Map.of("member", "appId", "operator", "EQUALS", "values", List.of("1"), "sql", "select"))),
        Map.of("objectKey", LAYOUT, "limit", 51))) {
      code("EASYV_PLAN_INVALID", () -> run.prepare("query_objects", input));
    }
    code("EASYV_PLAN_INVALID", () -> run.prepare("read_object", Map.of("handle", "invented")));
    var selected = tools.open(context, ALL, versions, row(LAYOUT, "1", Map.of("appId", "1")), List.of());
    code("EASYV_PLAN_INVALID", () -> selected.prepare("traverse_objects", Map.of("handle", "selected", "relation", "sql")));
    code("EASYV_PLAN_INVALID", () -> selected.prepare("assess_scheme", Map.of("handle", "selected")));
    verifyNoInteractions(objects, assessments);
  }

  @Test void previousReferencesAreReauthorizedAndCannotEscapeSelectedBlock() {
    var selected = row(BLOCK, "1:b", Map.of("appId", "1", "blockKey", "1:b"));
    var other = row(BLOCK, "1:other", Map.of("appId", "1", "blockKey", "1:other"));
    var trace = List.of(Map.<String, Object>of("id", "q1", "tool", "query_objects", "label", "区域", "input", Map.of("objectKey", BLOCK), "references", List.of(other.reference())));
    var run = tools.open(context, ALL, versions, selected, trace);
    assertEquals(false, run.knownObjects().getLast().get("read"));
    assertEquals(new QueryIntent.Filter("blockKey", QueryIntent.Operator.EQUALS, List.of("1:b")), run.prepare("query_objects", Map.of("objectKey", COMPONENT)).request().filters().getFirst());
    when(objects.readDuringExecution(eq(context), eq(ALL), any())).thenReturn(result(BLOCK, other, false));
    code("OBJECT_SCOPE_FORBIDDEN", () -> run.execute("q1", run.prepare("read_object", Map.of("handle", "o1"))));
    verify(objects).readDuringExecution(eq(context), eq(ALL), argThat(req -> req.objectId().equals("1:other")));
  }

  @Test void ordinaryFollowUpReauthorizesHistoricalIdentityInCurrentFrozenVersion() {
    var historical = new ObjectQueryPort.Reference(COMPONENT, "1:c", "components-previous");
    var trace = List.of(Map.<String, Object>of("id", "q1", "tool", "read_object", "label", "组件", "input", Map.of("handle", "o1"), "references", List.of(historical)));
    var run = tools.open(context, ALL, versions, null, trace);
    var current = row(COMPONENT, "1:c", Map.of("appId", "1", "blockKey", "1:b"));
    assertEquals(current.reference(), run.knownObjects().getFirst().get("reference"));
    assertEquals(false, run.knownObjects().getFirst().get("read"));
    when(objects.readDuringExecution(eq(context), eq(ALL), any())).thenReturn(result(COMPONENT, current, false));
    var output = run.execute("q1", run.prepare("read_object", Map.of("handle", "o1")));
    assertEquals(List.of(current.reference()), output.references());
    assertEquals(historical, ((List<?>) trace.getFirst().get("references")).getFirst());
    verify(objects).readDuringExecution(eq(context), eq(ALL), argThat(req -> req.objectId().equals("1:c") && req.datasetVersionSetId().equals("set-old")));
  }

  @Test void historicalIdentityDoesNotRestoreMissingOrUnauthorizedCurrentObject() {
    var historical = new ObjectQueryPort.Reference(COMPONENT, "1:c", "components-previous");
    var trace = List.of(Map.<String, Object>of("id", "q1", "tool", "read_object", "label", "组件", "input", Map.of("handle", "o1"), "references", List.of(historical)));
    var run = tools.open(context, ALL, versions, null, trace);
    when(objects.readDuringExecution(eq(context), eq(ALL), any()))
        .thenThrow(new BackendException("OBJECT_NOT_FOUND", "当前版本对象不存在或无权访问"));
    code("OBJECT_NOT_FOUND", () -> run.execute("q1", run.prepare("read_object", Map.of("handle", "o1"))));
    verifyNoInteractions(assessments);
  }

  @Test void runtimeScopeChangesAndReturnedVersionsFailWithoutMixingEvidence() {
    var run = tools.open(context, ALL, versions, null, List.of()); run.currentScope();
    var scoped = new ResolvedScopeSnapshot("easyv", 2, Map.of("userId", "7", "accessMode", "scoped", "easyvUserId", "16"));
    when(scopes.resolveScope(principal)).thenReturn(scoped);
    code("OBJECT_SCOPE_FORBIDDEN", run::currentScope);
    when(scopes.resolveScope(principal)).thenReturn(ALL);
    var bad = new ObjectQueryPort.Row(new ObjectQueryPort.Reference(LAYOUT, "1", "layouts-new"), Map.of("appId", "1"));
    when(objects.readDuringExecution(eq(context), eq(ALL), any())).thenReturn(result(LAYOUT, bad, false));
    code("OBJECT_VERSION_MISMATCH", () -> run.execute("q1", run.prepare("query_objects", Map.of("objectKey", LAYOUT))));
  }

  @Test void paginationAndUnassessableScoresStayExplicit() {
    var selected = row(BLOCK, "1:b", Map.of("appId", "1", "blockKey", "1:b"));
    var run = tools.open(context, ALL, versions, selected, List.of());
    when(objects.readDuringExecution(eq(context), eq(ALL), any())).thenReturn(result(BLOCK, selected, true));
    var listed = run.execute("q1", run.prepare("query_objects", Map.of("objectKey", BLOCK)));
    assertEquals(true, listed.observation().get("hasMore"));
    var selection = new ObjectSelection(context.executionId(), context.datasetVersionSetId(), selected.reference());
    var unassessable = new EasyVSchemeAssessmentService.Result("assessment", selection, "ontology-old", versions, "unassessable", "SCHEME_CANDIDATES_NOT_RETAINED", null, List.of(), null);
    when(assessments.assessDuringExecution(context, ALL, selection)).thenReturn(unassessable);
    var output = run.execute("q2", run.prepare("assess_scheme", Map.of("handle", "selected")));
    assertFalse(output.rows().getFirst().containsKey("score"));
    assertEquals("SCHEME_CANDIDATES_NOT_RETAINED", output.rows().getFirst().get("reason"));
    assertNull(output.audit().get("comparison"));
  }

  @Test void fullAssessmentAuditAndComparisonRemainIntactWhenModelEvidenceIsCapped() throws Exception {
    var fixture = assessmentFixture();
    var block = row(BLOCK, "1:b", Map.of("appId", "1", "blockKey", "1:b"));
    var run = tools.open(context, ALL, versions, block, List.of());
    when(objects.readDuringExecution(eq(context), eq(ALL), any())).thenReturn(result(BLOCK, block, false));
    var base = fixture.comparison().current();
    var candidates = java.util.stream.IntStream.range(0, 60).mapToObj(i ->
        new com.dip3.ontologyagent.easyv.internal.domain.SchemeAdaptation.Assessment("candidate-" + i, base.status(), base.score(), base.assignments(), base.findings())).toList();
    var comparison = new com.dip3.ontologyagent.easyv.internal.domain.SchemeAdaptation.Comparison(fixture.comparison().rules(), fixture.comparison().input(), base, candidates);
    var source = fixture.candidateInputs().getFirst();
    var inputs = java.util.stream.IntStream.range(0, 60).mapToObj(i -> new com.dip3.ontologyagent.easyv.internal.domain.SchemeAdaptation.Candidate("candidate-" + i,
        source.blockTypeId(), source.chartCount(), source.parseStatus(), source.parseErrorCode(), source.slots())).toList();
    var result = new EasyVSchemeAssessmentService.Result(fixture.assessmentId(), fixture.selection(), fixture.ontologyVersionId(), versions, fixture.status(), fixture.reason(), fixture.geometry(), inputs, comparison);
    when(assessments.assessDuringExecution(eq(context), eq(ALL), any())).thenReturn(result);
    var output = run.execute("q1", run.prepare("assess_scheme", Map.of("handle", "selected")));
    assertEquals(61, output.observation().get("totalRows"));
    assertEquals(50, ((List<?>) output.observation().get("rows")).size());
    assertEquals(false, output.observation().get("candidateSetComplete"));
    assertEquals(60, ((List<?>) ((Map<?, ?>) output.audit().get("comparison")).get("candidates")).size());
    assertEquals(output.audit(), output.renderBlock().get("result"));
  }

  @Test void persistedTraceRejectsUnknownFieldsNoncontiguousIdsAndInvalidReferences() {
    var trace = Map.<String, Object>of("id", "q1", "tool", "read_object", "label", "读取区域", "input", Map.of("handle", "o1"), "references", List.of(Map.of("objectKey", BLOCK, "objectId", "1:b", "productVersionId", "blocks-old")));
    assertEquals(List.of(trace), EasyVAgentTools.readTrace(List.of(trace)));
    var invalid = new LinkedHashMap<>(trace); invalid.put("id", "q2");
    code("FOLLOW_UP_CONTEXT_INVALID", () -> EasyVAgentTools.readTrace(List.of(invalid)));
    invalid.put("id", "q1"); invalid.put("sql", "select");
    code("FOLLOW_UP_CONTEXT_INVALID", () -> EasyVAgentTools.readTrace(List.of(invalid)));
    invalid.remove("sql"); invalid.put("references", List.of(Map.of("objectKey", BLOCK, "objectId", "1:b", "productVersionId", "blocks-old", "properties", Map.of())));
    code("FOLLOW_UP_CONTEXT_INVALID", () -> EasyVAgentTools.readTrace(List.of(invalid)));
  }

  private ObjectQueryPort.Row row(String key, String id, Map<String, Object> properties) { return new ObjectQueryPort.Row(new ObjectQueryPort.Reference(key, id, versions.get(key)), properties); }
  private EasyVObjectReadService.Result result(String key, ObjectQueryPort.Row row, boolean more) {
    return new EasyVObjectReadService.Result(context.executionId(), context.datasetVersionSetId(), "ontology-old", new ObjectQueryPort.Page(key, List.of(row), 50, 0, more), null,
        new EasyVObjectReadService.ObjectTypeView(key, model.require(key).label(), List.of(), List.of()));
  }
  private static EasyVSchemeAssessmentService.Result assessmentFixture() throws Exception {
    Path path = Path.of("../contracts/backend/fixtures/scheme-assessment.json");
    if (!Files.exists(path)) path = Path.of("contracts/backend/fixtures/scheme-assessment.json");
    return new ObjectMapper().readValue(Files.readString(path), EasyVSchemeAssessmentService.Result.class);
  }
  private static void code(String code, Runnable action) { assertEquals(code, assertThrows(BackendException.class, action::run).code()); }
}
