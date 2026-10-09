package com.dip3.ontologyagent.config;

import static org.junit.jupiter.api.Assertions.*;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;

/** 用真实的 Spring 启动流程验证护栏：校验发生在任何业务 Bean 创建之前。 */
class RuntimeEnvironmentConfigurationTest {
  private static final String REMOTE = "jdbc:postgresql://192.0.2.10:5432/shared_platform";

  private static AnnotationConfigApplicationContext context(Map<String, Object> properties) {
    var context = new AnnotationConfigApplicationContext();
    context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("test", new HashMap<>(properties)));
    context.register(RuntimeEnvironmentConfiguration.class);
    return context;
  }

  @Test
  void aLocalProcessPointedAtARemoteDatabaseCannotStart() {
    try (var context = context(Map.of("spring.datasource.url", REMOTE))) {
      var error = assertThrows(IllegalStateException.class, context::refresh);
      assertTrue(error.getMessage().contains("192.0.2.10:5432/shared_platform"), error.getMessage());
    }
  }

  @Test
  void theDefaultDeclarationIsLocalDevSoUndeclaredProcessesAreGuarded() {
    try (var context = context(Map.of("spring.datasource.url", "jdbc:postgresql://127.0.0.1:55432/ontology_agent_local"))) {
      context.refresh();
      var environment = context.getBean(RuntimeEnvironment.class);
      assertEquals("local-dev", environment.name());
      assertEquals(55432, environment.database().port());
    }
  }

  @Test
  void aDeclaredSharedEnvironmentAndAnExplicitOptInBothStartAndStayIdentifiable() {
    try (var context = context(Map.of("spring.datasource.url", REMOTE, "dip3.environment.name", "easyv-dev"))) {
      context.refresh();
      assertEquals("公司验收 easyv-dev", context.getBean(RuntimeEnvironment.class).label());
    }
    try (var context = context(Map.of("spring.datasource.url", REMOTE, "dip3.environment.allow-remote-database", "true"))) {
      context.refresh();
      assertTrue(context.getBean(RuntimeEnvironment.class).remoteDatabase());
    }
  }

  @Test
  void anInvalidDeclarationStopsTheProcessInsteadOfBecomingLocalDev() {
    try (var context = context(Map.of("spring.datasource.url", "jdbc:postgresql://127.0.0.1:5432/x", "dip3.environment.name", ""))) {
      assertThrows(IllegalStateException.class, context::refresh);
    }
  }
}
