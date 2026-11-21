package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class EasyVWritebackContractServiceTest {
  private final EasyVWritebackContractPort port = mock(EasyVWritebackContractPort.class);
  private final EasyVWritebackContractService service = new EasyVWritebackContractService(port);

  @Test
  void rejectsAnonymousActorBeforeProbing() {
    BackendException ex = assertThrows(BackendException.class, () -> service.check(null));
    assertEquals("AUTH_REQUIRED", ex.code());
    verifyNoInteractions(port);
  }

  @Test
  void rejectsNonPlatformAdminRolesBeforeProbing() {
    for (String role : List.of("EASYV_ANALYST", "PROPERTY_ANALYST", "ONTOLOGY_VIEWER", "ONTOLOGY_PUBLISHER")) {
      AuthSession actor = session(List.of(role));
      BackendException ex = assertThrows(BackendException.class, () -> service.check(actor));
      assertEquals("EASYV_WRITEBACK_CONTRACT_FORBIDDEN", ex.code());
    }
    AuthSession noRoles = session(List.of());
    BackendException ex = assertThrows(BackendException.class, () -> service.check(noRoles));
    assertEquals("EASYV_WRITEBACK_CONTRACT_FORBIDDEN", ex.code());
    verifyNoInteractions(port);
  }

  @Test
  void allowsPlatformAdminAndDelegatesToReadOnlyPort() {
    AuthSession admin = session(List.of("PLATFORM_ADMIN"));
    var expected = EasyVWritebackContract.disabledReport("easyv_saas", "未启用", Instant.now());
    when(port.check()).thenReturn(expected);

    var actual = service.check(admin);
    assertSame(expected, actual);
    verify(port).check();
  }

  private static AuthSession session(List<String> roles) {
    return new AuthSession("sess-1", "1", "用户",
        new AccessScope("platform", List.of(), List.of(), roles), Instant.MAX);
  }
}
