package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.dip3.ontologyagent.analysis.AnalysisSessionRepository;
import com.dip3.ontologyagent.ontology.*;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.capability.api.*;
import com.dip3.ontologyagent.execution.*;
import com.dip3.ontologyagent.ingestion.api.*;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class EasyVObjectReadServiceTest {
  private static final String LAYOUT = "easyv-prototype-layout";
  private static final Instant NOW = Instant.parse("2026-10-03T12:00:00Z");
  private final AnalysisSessionRepository sessions = mock(AnalysisSessionRepository.class);
  private final OntologyRepository ontologies = mock(OntologyRepository.class);
  private final ExecutionRepository executions = mock(ExecutionRepository.class);
  private final DatasetVersionSetRegistry datasets = mock(DatasetVersionSetRegistry.class);
  private final IdentityAccountService accounts = mock(IdentityAccountService.class);
  private final ObjectQueryPort objects = mock(ObjectQueryPort.class);
  private final PrototypeStructureReadPort structures = mock(PrototypeStructureReadPort.class);
  private final AuthSession admin = viewer("1", "PLATFORM_ADMIN");
  private final AuthSession analyst = viewer("1", "EASYV_ANALYST");
  private EasyVObjectReadService service;
  private CapabilityBinding binding;

  @BeforeEach
  void setup() {
    service = new EasyVObjectReadService(sessions, ontologies, executions, datasets, new EasyVScopeResolver(accounts),
        objects, SemanticModel.discover(), structures);
    binding = binding(Map.of("userId", "1", "accessMode", "all"));
    when(ontologies.published("ontology-old")).thenReturn(new OntologyCatalog("ontology-old", "1",
        List.of(new OntologyCatalog.Item(EasyVGenerationOntology.ENTITY_KEY, "应用", Map.of())),
        List.of(new OntologyCatalog.Item(EasyVGenerationOntology.METRIC_KEY, "质量", Map.of())), List.of(), List.of(),
        List.of(new OntologyCatalog.Item(EasyVGenerationOntology.TIME_KEY, "时间", Map.of())), List.of(), List.of()));
    snapshot(binding, "set-old");
    Map<String, String> versions = Map.of("easyv-ai-application", "apps-old", LAYOUT, "layouts-old",
        "easyv-prototype-block", "blocks-old", "easyv-prototype-component", "components-old");
    when(datasets.requireFrozen(eq("set-old"), anySet())).thenReturn(new DatasetVersionSet(
        "set-old", versions, NOW, DatasetVersionSet.Status.FROZEN, NOW, NOW, "test"));
    when(objects.query(any(), any())).thenAnswer(call -> {
      ObjectQueryPort.Query query = call.getArgument(0);
      return new ObjectQueryPort.Page(query.objectKey(), List.of(), query.limit(), query.offset(), false);
    });
  }

  @Test
  void listUsesExactExecutionManifestWithoutSelectingLatest() {
    var result = service.read("session", admin, request(null, null, "set-old"));
    assertEquals("set-old", result.datasetVersionSetId());
    assertEquals("ontology-old", result.ontologyVersionId());
    assertTrue(result.page().rows().isEmpty());
    assertNull(result.structure());
    verify(objects).query(any(), argThat(access -> access.scope().all()
        && "layouts-old".equals(access.productVersions().get(LAYOUT))));
    verify(datasets, never()).latestFrozen(anySet());
    verify(ontologies).published("ontology-old");
    verify(datasets).requireFrozen("set-old", EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS);
  }

  @Test
  void drilldownRestoresOnlySavedFiltersAndRetainsFrozenVersionAcrossPages() {
    savedDrilldown();
    for (int offset : List.of(0, 20)) {
      var result = service.read("session", admin, drilldown("q1:0:count", LAYOUT, null, offset));
      assertEquals("set-old", result.datasetVersionSetId());
      assertEquals(offset, result.page().offset());
    }
    verify(objects, times(2)).query(argThat(query -> query.filters().equals(List.of(
        new QueryIntent.Filter("layoutSignature", QueryIntent.Operator.EQUALS, List.of("L1-a"))))),
        argThat(access -> "layouts-old".equals(access.productVersions().get(LAYOUT))));
    verify(datasets, never()).latestFrozen(anySet());
  }

  @Test
  void drilldownRejectsUnknownIdChangedTypeAndClientFiltersBeforeFacts() {
    savedDrilldown();
    assertEquals("OBJECT_DRILLDOWN_NOT_FOUND", assertThrows(BackendException.class,
        () -> service.read("session", admin, drilldown("q1:wrong:count", LAYOUT, null, 0))).code());
    assertEquals("OBJECT_DRILLDOWN_MISMATCH", assertThrows(BackendException.class,
        () -> service.read("session", admin, drilldown("q1:0:count", "easyv-prototype-block", null, 0))).code());
    assertEquals("OBJECT_QUERY_INVALID", assertThrows(BackendException.class,
        () -> service.read("session", admin, drilldown("q1:0:count", LAYOUT,
            List.of(new QueryIntent.Filter("layoutSignature", QueryIntent.Operator.EQUALS, List.of("L1-b"))), 0))).code());
    verifyNoInteractions(objects);
    snapshot(binding, "set-old");
    assertEquals("OBJECT_DRILLDOWN_NOT_FOUND", assertThrows(BackendException.class,
        () -> service.read("session", admin, drilldown("q1:0:count", LAYOUT, null, 0))).code(), "历史未保存绑定不能改读最新集合");
  }

  private void savedDrilldown() {
    var json = new com.dip3.ontologyagent.support.JsonCodec();
    var saved = new EasyVResultDrilldown.Binding("q1:0:count", 0, 0, LAYOUT, "版式 L1-a",
        List.of(new QueryIntent.Filter("layoutSignature", QueryIntent.Operator.EQUALS, List.of("L1-a"))));
    when(executions.findJavaSnapshot("session", "execution", "1")).thenReturn(Optional.of(new ExecutionSnapshot(
        "execution", "session", "1", null, "ontology-old", Map.of("source", "grounded-context"), binding.snapshot(),
        "set-old", "completed", Map.of("_executionContract", "java-initial-v1"), List.of(), null,
        List.of(json.map(json.write(Map.of("type", "kv-list", "datasetVersionSetId", "set-old", "drilldowns", List.of(saved))))),
        null, null, null, "trace", NOW, NOW)));
  }

  private static EasyVObjectReadService.Request drilldown(String id, String objectKey, List<QueryIntent.Filter> filters, int offset) {
    return new EasyVObjectReadService.Request("execution", "set-old", objectKey, null, null, filters, null, 20, offset, id);
  }

  @Test
  void rejectsCrossOwnerSessionAndExecutionBeforeReadingFacts() {
    when(sessions.requireOwned("session", admin)).thenThrow(new BackendException("SESSION_NOT_FOUND", "拒绝"));
    assertEquals("SESSION_NOT_FOUND", assertThrows(BackendException.class,
        () -> service.read("session", admin, request(null, null, "set-old"))).code());
    verifyNoInteractions(objects, structures, executions);
    reset(sessions);
    when(executions.findJavaSnapshot("session", "execution", "2")).thenReturn(Optional.empty());
    assertEquals("EXECUTION_NOT_FOUND", assertThrows(BackendException.class,
        () -> service.read("session", viewer("2", "PLATFORM_ADMIN"), request(null, null, "set-old"))).code());
  }

  @Test
  void refusesForgedOrUnavailableFrozenSet() {
    assertEquals("OBJECT_VERSION_MISMATCH", assertThrows(BackendException.class,
        () -> service.read("session", admin, request(null, null, "set-new"))).code());
    verifyNoInteractions(objects, structures, datasets);
    when(datasets.requireFrozen(eq("set-old"), anySet()))
        .thenThrow(new BackendException("DATASET_VERSION_SET_NOT_FROZEN", "已撤销"));
    assertEquals("DATASET_VERSION_SET_NOT_FROZEN", assertThrows(BackendException.class,
        () -> service.read("session", admin, request(null, null, "set-old"))).code());
    verifyNoInteractions(objects);
  }

  @Test
  void currentPermissionsCanOnlyNarrowFrozenPermissions() {
    when(accounts.subjectValue(1L, "easyv", "userId")).thenReturn(Optional.of("16"));
    service.read("session", analyst, request(null, null, "set-old"));
    verify(objects).query(any(), argThat(access -> !access.scope().all()
        && access.scope().values().equals(Map.of("userId", List.of("16")))));
    clearInvocations(objects);
    binding = binding(Map.of("userId", "1", "accessMode", "scoped", "easyvUserId", "16"));
    snapshot(binding, "set-old");
    service.read("session", admin, request(null, null, "set-old"));
    verify(objects).query(any(), argThat(access -> !access.scope().all()
        && access.scope().values().equals(Map.of("userId", List.of("16")))));
  }

  @Test
  void revokedRoleAndChangedBindingCannotReadOldObjects() {
    assertEquals("EASYV_SCOPE_FORBIDDEN", assertThrows(BackendException.class,
        () -> service.read("session", viewer("1", "OTHER"), request(null, null, "set-old"))).code());
    binding = binding(Map.of("userId", "1", "accessMode", "scoped", "easyvUserId", "16"));
    snapshot(binding, "set-old");
    when(accounts.subjectValue(1L, "easyv", "userId")).thenReturn(Optional.of("17"));
    assertEquals("OBJECT_SCOPE_FORBIDDEN", assertThrows(BackendException.class,
        () -> service.read("session", analyst, request(null, null, "set-old"))).code());
    verifyNoInteractions(objects, structures);
  }

  @Test
  void detailDistinguishesParseFailureMissingHistoryAndRetainedStructure() {
    ObjectQueryPort.Reference ref = new ObjectQueryPort.Reference(LAYOUT, "app-1", "layouts-old");
    when(objects.require(eq(LAYOUT), eq("app-1"), any()))
        .thenReturn(new ObjectQueryPort.Row(ref, Map.of("parseStatus", "invalid_xml")));
    assertEquals("parse_failed", service.read("session", admin, request("app-1", null, "set-old")).structure().status());
    verifyNoInteractions(structures);
    when(objects.require(eq(LAYOUT), eq("app-1"), any()))
        .thenReturn(new ObjectQueryPort.Row(ref, Map.of("parseStatus", "ok")));
    when(structures.structure("layouts-old", "app-1")).thenReturn(null);
    assertEquals("not_retained", service.read("session", admin, request("app-1", null, "set-old")).structure().status());
    when(structures.structure("layouts-old", "app-1"))
        .thenReturn(Map.of("tag", "Pages", "attributes", Map.of(), "children", List.of()));
    var result = service.read("session", admin, request("app-1", null, "set-old"));
    assertEquals("available", result.structure().status());
    assertEquals("Pages", result.structure().layout().get("tag"));
    assertEquals("layouts-old", result.page().rows().getFirst().reference().productVersionId());
  }

  @Test
  void relationUsesDeclaredTargetAndRefusesUnknownObjectsOrRelationships() {
    when(objects.related(eq(LAYOUT), eq("app-1"), eq("blocks"), any(), any()))
        .thenReturn(new ObjectQueryPort.Page("easyv-prototype-block", List.of(), 50, 0, false));
    assertEquals("easyv-prototype-block", service.read("session", admin,
        request("app-1", "blocks", "set-old")).page().objectKey());
    assertThrows(BackendException.class, () -> service.read("session", admin, request("app-1", "unknown", "set-old")));
    assertEquals("OBJECT_QUERY_INVALID", assertThrows(BackendException.class, () -> service.read("session", admin,
        new EasyVObjectReadService.Request("execution", "set-old", "property-project", null, null, null, null, null, null))).code());
    assertEquals("OBJECT_QUERY_INVALID", assertThrows(BackendException.class, () -> service.read("session", admin,
        request("app-1", "application", "set-old"))).code());
  }

  @Test
  void runningWorkerReadsFrozenObjectsWithoutACompletedSnapshotAndUsesCurrentRoles() {
    var worker = new AuthSession("worker", "1", "用户", new AccessScope("org", List.of(), List.of(), List.of()), Instant.MAX);
    var account = new IdentityAccount(1L, "user", "用户", "hash", "active", "test", "org", null, List.of("EASYV_ANALYST"));
    when(accounts.findById(1L)).thenReturn(Optional.of(account));
    when(accounts.scope(account)).thenReturn(analyst.scope());
    when(accounts.subjectValue(1L, "easyv", "userId")).thenReturn(Optional.of("16"));
    var context = runtime(worker);
    service.readDuringExecution(context, binding.resolvedScope(), request(null, null, "set-old"));
    verify(executions).renewLease("execution", "worker", ExecutionRepository.EXECUTION_LEASE);
    verify(executions, never()).findJavaSnapshot(anyString(), anyString(), anyString());
    verify(sessions).requireOwned("session", new AuthSession("worker", "1", "用户", analyst.scope(), Instant.MAX));
    verify(objects).query(any(), argThat(access -> access.scope().values().equals(Map.of("userId", List.of("16")))));
  }

  @Test
  void runtimeRejectsMissingLeaseDisabledAccountAndChangedOrganizationBeforeFacts() {
    var context = runtime(admin);
    doThrow(new BackendException("JOB_LEASE_LOST", "租约丢失")).when(executions).renewLease("execution", "worker", ExecutionRepository.EXECUTION_LEASE);
    assertEquals("JOB_LEASE_LOST", assertThrows(BackendException.class,
        () -> service.readDuringExecution(context, binding.resolvedScope(), request(null, null, "set-old"))).code());
    verifyNoInteractions(accounts, objects);
    reset(executions);
    var disabled = new IdentityAccount(1L, "user", "用户", "hash", "disabled", "test", "org", null, List.of("PLATFORM_ADMIN"));
    when(accounts.findById(1L)).thenReturn(Optional.of(disabled));
    assertEquals("ACCOUNT_DISABLED", assertThrows(BackendException.class,
        () -> service.readDuringExecution(context, binding.resolvedScope(), request(null, null, "set-old"))).code());
    var moved = new IdentityAccount(1L, "user", "用户", "hash", "active", "test", "other", null, List.of("PLATFORM_ADMIN"));
    when(accounts.findById(1L)).thenReturn(Optional.of(moved));
    var currentScope = new AccessScope("other", List.of(), List.of(), List.of("PLATFORM_ADMIN"));
    when(accounts.scope(moved)).thenReturn(currentScope);
    when(sessions.requireOwned(eq("session"), argThat(v -> "other".equals(v.scope().organizationId()))))
        .thenThrow(new BackendException("SESSION_NOT_FOUND", "账号组织已变化"));
    assertEquals("OBJECT_SCOPE_FORBIDDEN", assertThrows(BackendException.class,
        () -> service.readDuringExecution(context, binding.resolvedScope(), request(null, null, "set-old"))).code());
    verifyNoInteractions(objects);
    assertEquals("OBJECT_VERSION_MISMATCH", assertThrows(BackendException.class,
        () -> service.readDuringExecution(context, binding.resolvedScope(), request(null, null, "set-new"))).code());
  }

  private static CapabilityExecutionContext runtime(AuthSession worker) {
    return new CapabilityExecutionContext(worker,
        new com.dip3.ontologyagent.agent.AgentTurn("java-initial-v1", "session", "读取对象", null, null, Map.of(), Map.of(), NOW),
        "execution", new com.dip3.ontologyagent.ontology.OntologyCatalog("ontology-old", "1", List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()), "set-old", "trace", "worker");
  }

  private void snapshot(CapabilityBinding binding, String set) {
    when(executions.findJavaSnapshot("session", "execution", "1")).thenReturn(Optional.of(new ExecutionSnapshot(
        "execution", "session", "1", null, "ontology-old", Map.of("source", "grounded-context"), binding.snapshot(),
        set, "completed", Map.of("_executionContract", "java-initial-v1"), List.of(), null, List.of(), null, null,
        null, "trace", NOW, NOW)));
  }
  private static CapabilityBinding binding(Map<String, Object> values) {
    return new CapabilityBinding(new CapabilityId("easyv", "generation-quality-analysis"), "ontology-old",
        new ResolvedScopeSnapshot("easyv", 2, values));
  }
  private static EasyVObjectReadService.Request request(String id, String relation, String set) {
    return new EasyVObjectReadService.Request("execution", set, LAYOUT, id, relation, null, null, null, null);
  }
  private static AuthSession viewer(String id, String role) {
    return new AuthSession("cookie", id, "用户", new AccessScope("org", List.of(), List.of(), List.of(role)), NOW.plusSeconds(3600));
  }
}
