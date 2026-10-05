package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.capability.api.*;
import com.dip3.ontologyagent.ingestion.api.*;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class EasyVObjectSelectionServiceTest {
  private static final String LAYOUT = "easyv-prototype-layout", BLOCK = "easyv-prototype-block", COMPONENT = "easyv-prototype-component";
  private final ObjectQueryPort objects = mock(ObjectQueryPort.class);
  private final DatasetVersionSetRegistry datasets = mock(DatasetVersionSetRegistry.class);
  private final IdentityAccountService accounts = mock(IdentityAccountService.class);
  private final SemanticModel model = SemanticModel.discover();
  private final EasyVObjectSelectionService service = new EasyVObjectSelectionService(objects, datasets, new EasyVScopeResolver(accounts), model);
  private final ResolvedScopeSnapshot all = scope(Map.of("userId", "1", "accessMode", "all"));
  private final ResolvedScopeSnapshot scoped = scope(Map.of("userId", "1", "accessMode", "scoped", "easyvUserId", "16"));
  private final ObjectSelection selection = new ObjectSelection("execution-old", "set-old", new ObjectQueryPort.Reference(BLOCK, "a:b", "blocks-old"));

  @BeforeEach void setup() {
    when(datasets.requireFrozen(eq("set-old"), anySet())).thenReturn(new DatasetVersionSet("set-old",
        Map.of("easyv-ai-application", "apps-old", LAYOUT, "layouts-old", BLOCK, "blocks-old", COMPONENT, "components-old"),
        Instant.EPOCH, DatasetVersionSet.Status.FROZEN, Instant.EPOCH, Instant.EPOCH, "test"));
    when(accounts.subjectValue(1L, "easyv", "userId")).thenReturn(Optional.of("16"));
    when(objects.require(eq(BLOCK), eq("a:b"), any())).thenReturn(row(BLOCK, "a:b", "blocks-old"));
  }

  @Test void selectionRejectsClientPropertiesPermissionsAndIncompleteReferences() {
    assertEquals(selection, ObjectSelection.read(selection.snapshot()));
    var extra = new HashMap<>(selection.snapshot()); extra.put("properties", Map.of("appId", "other"));
    assertEquals("OBJECT_SELECTION_INVALID", assertThrows(BackendException.class, () -> ObjectSelection.read(extra)).code());
    extra.remove("properties"); extra.put("reference", Map.of("objectKey", BLOCK, "objectId", "a:b"));
    assertThrows(BackendException.class, () -> ObjectSelection.read(extra));
    assertThrows(BackendException.class, () -> new ObjectSelection(" ", "set-old", selection.reference()));
  }

  @Test void exactVersionIsMandatoryAndNeverFallsBackToLatest() {
    var forged = new ObjectSelection("execution-old", "set-old", new ObjectQueryPort.Reference(BLOCK, "a:b", "blocks-new"));
    assertEquals("OBJECT_VERSION_MISMATCH", assertThrows(BackendException.class, () -> service.require(viewer("PLATFORM_ADMIN"), all, forged)).code());
    verifyNoInteractions(objects);
    var selected = service.require(viewer("PLATFORM_ADMIN"), all, selection);
    assertEquals("blocks-old", selected.object().reference().productVersionId());
    verify(objects).require(eq(BLOCK), eq("a:b"), argThat(access -> access.scope().all() && "apps-old".equals(access.productVersions().get("easyv-ai-application"))));
    verify(datasets, never()).latestFrozen(anySet());
  }

  @Test void permissionChangesCanNarrowButNeverWidenFrozenQueries() {
    assertEquals(scoped, service.require(viewer("EASYV_ANALYST"), all, selection).scope());
    verify(objects).require(eq(BLOCK), eq("a:b"), argThat(access -> access.scope().values().equals(Map.of("userId", List.of("16")))));
    assertEquals(scoped, service.require(viewer("PLATFORM_ADMIN"), scoped, selection).scope());
  }

  @Test void revokedRoleChangedBindingAndMissingAuthorizedObjectFailLoud() {
    assertEquals("EASYV_SCOPE_FORBIDDEN", assertThrows(BackendException.class, () -> service.require(viewer("OTHER"), all, selection)).code());
    when(accounts.subjectValue(1L, "easyv", "userId")).thenReturn(Optional.of("17"));
    assertEquals("OBJECT_SCOPE_FORBIDDEN", assertThrows(BackendException.class, () -> service.require(viewer("EASYV_ANALYST"), scoped, selection)).code());
    verifyNoInteractions(objects);
    when(objects.require(eq(BLOCK), eq("a:b"), any())).thenThrow(new BackendException("OBJECT_NOT_FOUND", "对象不存在或不在授权范围内。"));
    assertEquals("OBJECT_NOT_FOUND", assertThrows(BackendException.class, () -> service.require(viewer("PLATFORM_ADMIN"), all, selection)).code());
  }

  @Test void queryFiltersUsePrimaryKeyAndDeclaredCompositeRelations() {
    assertConstraint(BLOCK, row(BLOCK, "a:b", "blocks-old"), "blockKey", "a:b");
    assertConstraint(COMPONENT, row(BLOCK, "a:b", "blocks-old"), "blockKey", "a:b");
    assertConstraint(BLOCK, row(COMPONENT, "a:b:c", "components-old"), "blockKey", "a:b");
    assertConstraint(COMPONENT, row(LAYOUT, "a", "layouts-old"), "appId", "a");
    assertConstraint(LAYOUT, row(COMPONENT, "a:b:c", "components-old"), "appId", "a");
    assertConstraint("easyv-ai-application", row(BLOCK, "a:b", "blocks-old"), "appId", "a");
  }

  @Test void unrelatedQueryCannotSilentlyDiscardSelectionAndMissingLinkValueCannotBeGuessed() {
    assertEquals("OBJECT_SELECTION_QUERY_UNSUPPORTED", assertThrows(BackendException.class,
        () -> service.constrain(intent("easyv-generation-feedback"), row(BLOCK, "a:b", "blocks-old"))).code());
    assertEquals("OBJECT_SELECTION_INVALID", assertThrows(BackendException.class,
        () -> service.constrain(intent(COMPONENT), new ObjectQueryPort.Row(selection.reference(), Map.of()))).code());
  }

  private void assertConstraint(String target, ObjectQueryPort.Row selected, String property, String value) {
    var constrained = service.constrain(intent(target), selected);
    assertEquals(List.of(new QueryIntent.Filter(property, QueryIntent.Operator.EQUALS, List.of(value))), constrained.filters());
    assertEquals(constrained, service.constrain(constrained, selected));
    assertTrue(new SemanticQueryCompiler(model).compile(constrained, Instant.now()).accepted());
  }
  private static QueryIntent intent(String key) {
    return new QueryIntent(key, List.of("count"), List.of(), List.of(),
        new QueryIntent.TimeSpec(null, new TimeExpression("全部", TimeExpression.Kind.ALL, null, null, null, null, null, null), null), null, List.of(), null);
  }
  private static ObjectQueryPort.Row row(String key, String id, String version) {
    return new ObjectQueryPort.Row(new ObjectQueryPort.Reference(key, id, version), Map.of("appId", "a", "blockKey", "a:b"));
  }
  private static ResolvedScopeSnapshot scope(Map<String, Object> values) { return new ResolvedScopeSnapshot("easyv", 2, values); }
  private static AuthSession viewer(String role) { return new AuthSession("cookie", "1", "用户", new AccessScope("org", List.of(), List.of(), List.of(role)), Instant.MAX); }
}
