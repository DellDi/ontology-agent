package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.analysis.*;
import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class EasyVScreenReviewServiceTest {
  private final EasyVObjectReadService objects = mock(EasyVObjectReadService.class);
  private final AnalysisService analyses = mock(AnalysisService.class);
  private final EasyVScreenReviewService service = new EasyVScreenReviewService(objects, analyses);
  private final AuthSession viewer = new AuthSession("auth", "1", "用户", new AccessScope("org", List.of(), List.of(), List.of()), Instant.MAX);
  private final List<ObjectQueryPort.Reference> refs = List.of("a", "b", "c").stream()
      .map(id -> new ObjectQueryPort.Reference("easyv-prototype-layout", id, "layouts-old")).toList();
  private final InitialObjectSelection selection = new InitialObjectSelection("set-old", refs);

  private EasyVObjectReadService.Result result(ObjectQueryPort.Reference ref) {
    return new EasyVObjectReadService.Result(null, "set-old", "ontology", new ObjectQueryPort.Page(ref.objectKey(),
        List.of(new ObjectQueryPort.Row(ref, Map.of())), 1, 0, false), null, null, Map.of(), null, null, Map.of());
  }

  @Test
  void everyChosenObjectIsReauthorizedBeforeCreatingOneSessionWithoutAnExecution() {
    when(objects.browseCatalog(eq(viewer), any())).thenAnswer(call -> {
      var request = call.<EasyVObjectReadService.CatalogRequest>getArgument(1);
      assertEquals("set-old", request.datasetVersionSetId());
      return result(refs.stream().filter(ref -> ref.objectId().equals(request.objectId())).findFirst().orElseThrow());
    });
    when(analyses.createObjectSession(eq(viewer), anyString(), any(), eq(selection))).thenAnswer(call -> {
      assertTrue(call.<String>getArgument(1).contains("用于运营复盘，保留指标"));
      return new AnalysisSession("session", "1", viewer.scope(), call.getArgument(1), Map.of(), "pending", Instant.now(), Instant.now());
    });
    assertEquals("session", service.start(viewer, "用于运营复盘，保留指标", selection));
    verify(objects, times(3)).browseCatalog(eq(viewer), any());
    verify(analyses, times(1)).createObjectSession(eq(viewer), anyString(), any(), eq(selection));
    verifyNoMoreInteractions(analyses);
  }

  @Test
  void revokedMemberOrChangedVersionCannotCreateAPartialSession() {
    when(objects.browseCatalog(eq(viewer), any())).thenAnswer(call -> {
      var request = call.<EasyVObjectReadService.CatalogRequest>getArgument(1);
      if (request.objectId().equals("b")) throw new BackendException("OBJECT_SCOPE_FORBIDDEN", "权限已收回");
      return result(refs.getFirst());
    });
    assertEquals("OBJECT_SCOPE_FORBIDDEN", assertThrows(BackendException.class, () -> service.start(viewer, "运营复盘", selection)).code());
    verifyNoInteractions(analyses);
    when(objects.browseCatalog(eq(viewer), any())).thenReturn(result(new ObjectQueryPort.Reference("easyv-prototype-layout", "a", "wrong-version")));
    assertEquals("OBJECT_VERSION_MISMATCH", assertThrows(BackendException.class, () -> service.start(viewer, "运营复盘", selection)).code());
    verifyNoInteractions(analyses);
  }

  @Test
  void invalidOrInjectedSelectionIsRejectedRatherThanWidened() {
    for (var raw : List.of(
        Map.of("datasetVersionSetId", "set", "references", List.of()),
        Map.of("datasetVersionSetId", "set", "references", List.of(refs.getFirst(), refs.getFirst())),
        Map.of("datasetVersionSetId", "set", "references", List.of(Map.of("objectKey", "easyv-prototype-layout", "objectId", "a", "productVersionId", "v", "properties", Map.of()))),
        Map.of("datasetVersionSetId", "set", "references", List.of(), "executionId", "fake"))) {
      assertThrows(BackendException.class, () -> InitialObjectSelection.read(raw));
    }
    assertThrows(BackendException.class, () -> new InitialObjectSelection("set", List.of(refs.getFirst(), new ObjectQueryPort.Reference("easyv-prototype-layout", "b", "other"))));
    assertThrows(BackendException.class, () -> service.start(viewer, " ", selection));
    assertThrows(BackendException.class, () -> service.start(viewer, "长".repeat(181), selection));
    verifyNoInteractions(objects, analyses);
    assertEquals(selection, InitialObjectSelection.read(selection.snapshot()));
    assertEquals("real-execution", selection.bind("real-execution").executionId());
  }
}
