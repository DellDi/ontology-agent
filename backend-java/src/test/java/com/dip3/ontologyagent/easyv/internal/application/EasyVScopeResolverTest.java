package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.IdentityAccountService;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.Scope;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class EasyVScopeResolverTest {
  private final IdentityAccountService accounts = mock(IdentityAccountService.class);
  private final EasyVScopeResolver resolver = new EasyVScopeResolver(accounts);

  @Test
  void platformAdminFreezesAllDataWithoutBinding() {
    ResolvedScopeSnapshot snapshot = resolver.resolveScope(principal("1", List.of("PLATFORM_ADMIN")));

    assertEquals(new ResolvedScopeSnapshot("easyv", 2, Map.of("userId", "1", "accessMode", "all")), snapshot);
    assertEquals(Scope.everything(), EasyVScopeResolver.dataScope(snapshot));
    assertEquals("全部数据", EasyVScopeResolver.dataScopeLabel(snapshot));
    verifyNoInteractions(accounts);
  }

  @Test
  void analystFreezesTheBoundEasyVUser() {
    when(accounts.subjectValue(2L, "easyv", "userId")).thenReturn(Optional.of("16"));

    ResolvedScopeSnapshot snapshot = resolver.resolveScope(principal("2", List.of("EASYV_ANALYST")));

    assertEquals(Map.of("userId", "2", "accessMode", "scoped", "easyvUserId", "16"), snapshot.values());
    assertEquals(Scope.restricted(Map.of("userId", List.of("16"))), EasyVScopeResolver.dataScope(snapshot));
    assertEquals("EasyV 用户 16 的数据", EasyVScopeResolver.dataScopeLabel(snapshot));
  }

  @Test
  void missingRoleOrBindingFailsLoudly() {
    when(accounts.subjectValue(3L, "easyv", "userId")).thenReturn(Optional.empty());
    when(accounts.subjectValue(4L, "easyv", "userId")).thenReturn(Optional.of("abc"));

    assertEquals("EASYV_USER_BINDING_REQUIRED", assertThrows(BackendException.class,
        () -> resolver.resolveScope(principal("3", List.of("EASYV_ANALYST")))).code());
    assertEquals("EASYV_USER_BINDING_INVALID", assertThrows(BackendException.class,
        () -> resolver.resolveScope(principal("4", List.of("EASYV_ANALYST")))).code());
    assertEquals("EASYV_SCOPE_FORBIDDEN", assertThrows(BackendException.class,
        () -> resolver.resolveScope(principal("5", List.of()))).code());
    assertEquals("EASYV_SCOPE_INVALID", assertThrows(BackendException.class,
        () -> resolver.resolveScope(principal("0", List.of("PLATFORM_ADMIN")))).code());
  }

  @Test
  void workerWithEmptyRolesMayValidateOnlyTheFrozenSameUserSnapshot() {
    when(accounts.subjectValue(2L, "easyv", "userId")).thenReturn(Optional.of("16"));
    ResolvedScopeSnapshot snapshot = resolver.resolveScope(principal("2", List.of("EASYV_ANALYST")));

    resolver.validateScope(snapshot, principal("2", List.of()));
    assertEquals("EASYV_SCOPE_INVALID", assertThrows(BackendException.class,
        () -> resolver.validateScope(snapshot, principal("3", List.of()))).code());
  }

  @Test
  void legacyOrTamperedSnapshotsAreRejected() {
    AuthSession principal = principal("2", List.of());
    for (ResolvedScopeSnapshot snapshot : List.of(
        new ResolvedScopeSnapshot("easyv", 1, Map.of("userId", "2", "accessMode", "all")),
        new ResolvedScopeSnapshot("property", 2, Map.of("userId", "2", "accessMode", "all")),
        new ResolvedScopeSnapshot("easyv", 2, Map.of("userId", "2", "accessMode", "scoped")),
        new ResolvedScopeSnapshot("easyv", 2, Map.of("userId", "2", "accessMode", "all", "easyvUserId", "16")))) {
      assertEquals("EASYV_SCOPE_INVALID", assertThrows(BackendException.class,
          () -> resolver.validateScope(snapshot, principal)).code());
    }
    assertEquals("EASYV_SCOPE_INVALID", assertThrows(BackendException.class,
        () -> EasyVScopeResolver.dataScope(
            new ResolvedScopeSnapshot("easyv", 1, Map.of("userId", "2", "accessMode", "all")))).code());
  }

  private static AuthSession principal(String userId, List<String> roles) {
    return new AuthSession("auth-1", userId, "用户", new AccessScope("org-1", List.of(), List.of(), roles),
        Instant.MAX);
  }
}
