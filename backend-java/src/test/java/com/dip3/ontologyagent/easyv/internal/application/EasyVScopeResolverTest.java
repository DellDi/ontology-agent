package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EasyVScopeResolverTest {
  private final EasyVScopeResolver resolver = new EasyVScopeResolver();

  @Test
  void bindRequiresPositiveUserIdAndEasyVAnalystRole() {
    AuthSession principal = principal("123", List.of("EASYV_ANALYST"));
    ResolvedScopeSnapshot snapshot = resolver.resolveScope(principal);

    assertEquals(Map.of("userId", "123", "accessMode", "creator-owned"), snapshot.values());
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
                        new ResolvedScopeSnapshot("property", 1, Map.of("userId", "123", "accessMode", "creator-owned")),
                        principal))
            .code());
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
