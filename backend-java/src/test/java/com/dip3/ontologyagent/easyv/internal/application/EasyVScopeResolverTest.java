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
  void bindRequiresPositiveUserIdAndEasyVAnalystRole() {
    AuthSession principal = principal("123", List.of("EASYV_ANALYST"));
    ResolvedScopeSnapshot snapshot = resolver.resolveScope(principal);

    assertEquals(Map.of("userId", "123", "accessMode", "all"), snapshot.values());
    assertThrows(
        BackendException.class,
        () -> resolver.resolveScope(principal("0", List.of("EASYV_ANALYST"))));
    assertEquals(
        "EASYV_SCOPE_FORBIDDEN",
        assertThrows(
                BackendException.class, () -> resolver.resolveScope(principal("123", List.of())))
            .code());
  }

  @Test
  void workerWithEmptyRolesMayValidateOnlyTheFrozenSameUserSnapshot() {
    ResolvedScopeSnapshot snapshot = resolver.resolveScope(principal("123", List.of("EASYV_ANALYST")));

    resolver.validateScope(snapshot, principal("123", List.of()));
    assertEquals(
        "EASYV_SCOPE_INVALID",
        assertThrows(
                BackendException.class,
                () -> resolver.validateScope(snapshot, principal("124", List.of())))
            .code());
  }

  @Test
  void tamperedDomainSchemaOrFieldsAreRejected() {
    AuthSession principal = principal("123", List.of());
    assertEquals(
        "EASYV_SCOPE_INVALID",
        assertThrows(
                BackendException.class,
                () ->
                    resolver.validateScope(
                        new ResolvedScopeSnapshot("property", 1, Map.of("userId", "123", "accessMode", "all")),
                        principal))
            .code());
  }

  @Test
  void platformAdminMayAnalyseAllDataWithoutBinding() {
    AuthSession admin = principal("1", List.of("PLATFORM_ADMIN"));

    assertEquals(Map.of("userId", "1", "accessMode", "all"), resolver.resolveScope(admin).values());
    assertEquals(Scope.everything(), resolver.dataScope(admin));
    verifyNoInteractions(accounts);
  }

  @Test
  void analystDataScopeIsRestrictedToTheBoundEasyVUser() {
    when(accounts.subjectValue(2L, "easyv", "userId")).thenReturn(Optional.of("16"));

    assertEquals(Scope.restricted(Map.of("userId", List.of("16"))),
        resolver.dataScope(principal("2", List.of("EASYV_ANALYST"))));
  }

  @Test
  void analystWithoutValidBindingFailsLoudly() {
    when(accounts.subjectValue(3L, "easyv", "userId")).thenReturn(Optional.empty());
    when(accounts.subjectValue(4L, "easyv", "userId")).thenReturn(Optional.of("abc"));

    assertEquals("EASYV_USER_BINDING_REQUIRED", assertThrows(BackendException.class,
        () -> resolver.dataScope(principal("3", List.of("EASYV_ANALYST")))).code());
    assertEquals("EASYV_USER_BINDING_INVALID", assertThrows(BackendException.class,
        () -> resolver.dataScope(principal("4", List.of("EASYV_ANALYST")))).code());
    assertEquals("EASYV_SCOPE_FORBIDDEN", assertThrows(BackendException.class,
        () -> resolver.dataScope(principal("5", List.of()))).code());
  }

  private static AuthSession principal(String userId, List<String> roles) {
    return new AuthSession(
        "auth-1",
        userId,
        "用户",
        new AccessScope("org-1", List.of(), List.of(), roles),
        Instant.MAX);
  }
}
