package com.dip3.ontologyagent.property.internal.application;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityAvailability;
import com.dip3.ontologyagent.capability.api.CapabilityRegistry;
import com.dip3.ontologyagent.easyv.internal.application.EasyVCapabilityRegistration;
import com.dip3.ontologyagent.easyv.internal.application.EasyVMainAgent;
import com.dip3.ontologyagent.easyv.internal.application.EasyVScopeResolver;
import com.dip3.ontologyagent.workspace.WorkspaceHomeMapper;
import com.dip3.ontologyagent.workspace.WorkspaceHomeService;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

class WorkspaceCapabilityAvailabilityTest {
  @Configuration(proxyBeanMethods = false)
  @ComponentScan("com.dip3.ontologyagent.capability.internal.application")
  @Import({PropertyCapabilityRegistration.class, EasyVCapabilityRegistration.class,
      EasyVScopeResolver.class, WorkspaceHomeService.class})
  static class Config {}

  private final ApplicationContextRunner runner = new ApplicationContextRunner()
      .withUserConfiguration(Config.class)
      .withBean(MainAgent.class, () -> mock(MainAgent.class))
      .withBean(PropertyProjectScopeResolver.class, () -> mock(PropertyProjectScopeResolver.class))
      .withBean(EasyVMainAgent.class, () -> mock(EasyVMainAgent.class))
      .withBean(WorkspaceHomeMapper.class, () -> mock(WorkspaceHomeMapper.class));

  private AuthSession viewer(String userId, boolean property, boolean easyv) {
    return new AuthSession("auth-1", userId, "分析员",
        new AccessScope("org-1", property ? List.of("p1") : List.of(), List.of(),
            easyv ? List.of("EASYV_ANALYST") : List.of("PROPERTY_ANALYST")), Instant.MAX);
  }

  private CapabilityAvailability capability(List<CapabilityAvailability> items, String domain) {
    return items.stream().filter(item -> item.domainKey().equals(domain)).findFirst().orElseThrow();
  }

  @Test
  void registeredCapabilitiesUseActualDomainScopesForAllPermissionCombinations() {
    runner.withPropertyValues("dip3.easyv.enabled=true").run(context -> {
      assertNull(context.getStartupFailure());
      var registry = context.getBean(CapabilityRegistry.class);
      var home = context.getBean(WorkspaceHomeService.class);
      for (boolean property : List.of(false, true)) {
        for (boolean easyv : List.of(false, true)) {
          var response = home.load(viewer("123", property, easyv));
          assertEquals(2, response.capabilities().size());
          assertEquals(property, capability(response.capabilities(), "property").available());
          assertEquals(easyv, capability(response.capabilities(), "easyv").available());
          for (var item : response.capabilities()) {
            assertEquals(item.domainKey(), registry.selectInitial(item.exampleQuestion()).domainKey());
            if (item.available()) {
              assertNull(item.unavailableReason());
              assertNotNull(item.resolvedScope());
            } else {
              assertFalse(item.unavailableReason().isBlank());
              assertNull(item.resolvedScope());
            }
          }
          if (easyv && !property) {
            assertTrue(response.viewer().workspaceAccess());
            assertEquals("123", capability(response.capabilities(), "easyv").resolvedScope().values().get("userId"));
            assertTrue(response.projects().isEmpty());
          }
        }
      }
      verifyNoInteractions(context.getBean(MainAgent.class), context.getBean(EasyVMainAgent.class));
    });
  }

  @Test
  void disabledEasyvIsAbsentEvenWhenViewerHasItsRole() {
    runner.withPropertyValues("dip3.easyv.enabled=false").run(context -> {
      assertNull(context.getStartupFailure());
      var items = context.getBean(CapabilityRegistry.class).availableFor(viewer("123", false, true));
      assertEquals(List.of("property"), items.stream().map(CapabilityAvailability::domainKey).toList());
      assertFalse(items.getFirst().available());
    });
  }

  @Test
  void invalidEasyvIdentityIsUnavailableWithoutGrantingScope() {
    runner.withPropertyValues("dip3.easyv.enabled=true").run(context -> {
      var easyv = capability(context.getBean(CapabilityRegistry.class)
          .availableFor(viewer("employee-1", false, true)), "easyv");
      assertFalse(easyv.available());
      assertNull(easyv.resolvedScope());
      assertTrue(easyv.unavailableReason().contains("用户 ID"));
    });
  }
}
