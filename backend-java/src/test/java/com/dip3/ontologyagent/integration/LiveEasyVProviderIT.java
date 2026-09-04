package com.dip3.ontologyagent.integration;

import com.dip3.ontologyagent.analysis.AnalysisService;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVInvocationContract;
import com.dip3.ontologyagent.execution.AgentInvocationRepository;
import com.dip3.ontologyagent.execution.AnalysisWorker;
import com.dip3.ontologyagent.execution.ExecutionSnapshot;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import com.dip3.ontologyagent.ontology.bootstrap.OntologyBootstrapService;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Explicit live gate: real OpenAI-compatible model + real EasyV test PostgreSQL + local disposable
 * platform ledger. It is only included by the {@code live-integration} Maven profile.
 */
@Testcontainers
@SpringBootTest(properties = {
    "dip3.worker.enabled=false",
    "dip3.easyv.enabled=true",
    "dip3.easyv.require-read-only-role=false",
    "spring.main.web-application-type=none"
})
@ContextConfiguration(initializers = LiveEasyVProviderIT.RequiredEnvironment.class)
class LiveEasyVProviderIT {
  private static final boolean PERSIST_PLATFORM_RESULTS = Boolean.parseBoolean(
      System.getenv().getOrDefault("LIVE_EASYV_PERSIST_PLATFORM_RESULTS", "false"));
  private static final List<String> REQUIRED_ENVIRONMENT = List.of(
      "LLM_PROVIDER_BASE_URL",
      "LLM_PROVIDER_API_KEY",
      "LLM_PROVIDER_MODEL",
      "LLM_PROVIDER_MODE",
      "LLM_PROVIDER_TOOL_CALLING",
      "LLM_PROVIDER_STRUCTURED_OUTPUT",
      "EASYV_POSTGRES_JDBC_URL",
      "EASYV_POSTGRES_USERNAME",
      "EASYV_POSTGRES_PASSWORD",
      "LIVE_EASYV_USER_ID",
      "LIVE_EASYV_FROM",
      "LIVE_EASYV_TO");

  @Container
  static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", () -> PERSIST_PLATFORM_RESULTS
        ? required("JAVA_DATABASE_URL") : POSTGRES.getJdbcUrl());
    registry.add("spring.datasource.username", () -> PERSIST_PLATFORM_RESULTS
        ? required("JAVA_DATABASE_USERNAME") : POSTGRES.getUsername());
    registry.add("spring.datasource.password", () -> PERSIST_PLATFORM_RESULTS
        ? required("JAVA_DATABASE_PASSWORD") : POSTGRES.getPassword());
    registry.add("spring.data.redis.url", () -> "redis://127.0.0.1:1");
    registry.add("spring.ai.openai.base-url", () -> required("LLM_PROVIDER_BASE_URL"));
    registry.add("spring.ai.openai.api-key", () -> required("LLM_PROVIDER_API_KEY"));
    registry.add("spring.ai.openai.chat.model", () -> required("LLM_PROVIDER_MODEL"));
    registry.add("spring.ai.openai.chat.max-retries", () -> "0");
    registry.add("spring.ai.openai.chat.parallel-tool-calls", () -> "false");
    registry.add("dip3.ai.provider.mode", () -> required("LLM_PROVIDER_MODE"));
    registry.add("dip3.ai.provider.tool-calling", () -> required("LLM_PROVIDER_TOOL_CALLING"));
    registry.add("dip3.ai.provider.structured-output", () -> required("LLM_PROVIDER_STRUCTURED_OUTPUT"));
    registry.add("dip3.easyv.jdbc-url", () -> required("EASYV_POSTGRES_JDBC_URL"));
    registry.add("dip3.easyv.username", () -> required("EASYV_POSTGRES_USERNAME"));
    registry.add("dip3.easyv.password", () -> required("EASYV_POSTGRES_PASSWORD"));
    registry.add("dip3.easyv.schema", () -> "easyv_saas");
    registry.add("dip3.easyv.maximum-pool-size", () -> "1");
    registry.add("dip3.easyv.connection-timeout", () -> "5s");
    registry.add("dip3.easyv.validation-timeout", () -> "1s");
    registry.add("dip3.easyv.statement-timeout", () -> "10s");
    registry.add("dip3.easyv.lock-timeout", () -> "1s");
    registry.add("dip3.easyv.idle-in-transaction-session-timeout", () -> "5s");
    registry.add("spring.ai.chat.memory.repository.jdbc.initialize-schema", () -> "never");
    registry.add("dip3.session-secret", () -> "live-easyv-session-secret-with-adequate-entropy");
    registry.add("dip3.redis-key-prefix", () -> "live-easyv");
    registry.add("dip3.cube.api-url", () -> "http://127.0.0.1:1/cubejs-api/v1");
    registry.add("dip3.cube.api-secret", () -> "unused-live-easyv-cube-secret");
    registry.add("dip3.cube.timeout", () -> "1s");
    registry.add("dip3.neo4j.uri", () -> "bolt://127.0.0.1:1");
    registry.add("dip3.neo4j.username", () -> "neo4j");
    registry.add("dip3.neo4j.password", () -> "unused-live-easyv-neo4j-password");
    registry.add("dip3.neo4j.database", () -> "neo4j");
    registry.add("dip3.worker.poll-delay", () -> "1s");
    registry.add("dip3.stream.poll-delay", () -> "10ms");
    registry.add("dip3.stream.timeout", () -> "1s");
  }

  @BeforeAll
  static void migrate() {
    if (PERSIST_PLATFORM_RESULTS) {
      MigrationTestSupport.migrate(
          required("JAVA_DATABASE_URL"),
          required("JAVA_DATABASE_USERNAME"),
          required("JAVA_DATABASE_PASSWORD"));
      return;
    }
    MigrationTestSupport.migrate(POSTGRES);
  }

  @Autowired OntologyBootstrapService bootstrap;
  @Autowired AnalysisService analyses;
  @Autowired AnalysisWorker worker;
  @Autowired AgentInvocationRepository invocations;

  @MockitoBean WakeupPublisher wakeups;

  @Test
  void realModelCallsEasyVToolExactlyOnceAndPersistsGroundedTestDatabaseResult() {
    AuthSession admin = new AuthSession(
        "live-easyv-admin",
        "platform-admin",
        "live-easyv-admin",
        new AccessScope("live-easyv", List.of(), List.of(), List.of("PLATFORM_ADMIN")),
        Instant.now().plusSeconds(600));
    assertTrue(bootstrap.bootstrap(admin, "live-easyv-bootstrap").status().ready());

    String userId = required("LIVE_EASYV_USER_ID");
    LocalDate from = LocalDate.parse(required("LIVE_EASYV_FROM"));
    LocalDate to = LocalDate.parse(required("LIVE_EASYV_TO"));
    AuthSession owner = new AuthSession(
        "live-easyv-auth",
        userId,
        "live-easyv-user",
        new AccessScope("live-easyv", List.of(), List.of(), List.of("EASYV_ANALYST")),
        Instant.now().plusSeconds(600));
    String question = "查询 " + from + (from.equals(to) ? "" : " 到 " + to)
        + " 的 EasyV AI 大屏生成质量、阶段耗时、失败和评分。";

    var session = analyses.createSession(owner, question);
    @SuppressWarnings("unchecked")
    Map<String, Object> capabilityId = (Map<String, Object>) session.savedContext().get("_capabilityId");
    assertEquals("easyv", capabilityId.get("domainKey"));
    assertEquals("generation-quality-analysis", capabilityId.get("capabilityKey"));

    String executionId = analyses.submit(
        session.id(), owner, "live-easyv-" + UUID.randomUUID(), "live-easyv-trace");
    assertTrue(worker.runOne("live-easyv-worker"));

    ExecutionSnapshot snapshot = analyses.snapshot(session.id(), executionId, owner).orElseThrow();
    assertEquals("completed", snapshot.status(),
        () -> "live EasyV execution failed: " + snapshot.errorCode() + " " + snapshot.mobileProjection());
    assertEquals("easyv", snapshot.capabilityBinding().get("domainKey"));
    assertEquals("generation-quality-analysis", snapshot.capabilityBinding().get("capabilityKey"));
    assertEquals("deterministic-read-only", snapshot.planSnapshot().get("mode"));

    List<Map<String, Object>> evidence = listOfMaps(snapshot.conclusionState().get("evidence"));
    List<Map<String, Object>> claims = listOfMaps(snapshot.conclusionState().get("claims"));
    assertEquals(List.of(
            "easyv-ai-application",
            "easyv-pipeline-node",
            "easyv-forge-task",
            "easyv-generation-feedback"),
        evidence.stream().map(item -> item.get("source")).toList());
    assertEquals(5, claims.size());
    assertTrue(evidence.stream().flatMap(item -> listOfMaps(item.get("rows")).stream())
        .allMatch(row -> row.containsKey("freshnessAt")));
    assertEquals(1, invocations.count(
        executionId,
        EasyVInvocationContract.CONTRACT.invocationType(),
        EasyVInvocationContract.TOOL_NAME));
  }

  private static List<Map<String, Object>> listOfMaps(Object value) {
    assertNotNull(value);
    if (!(value instanceof List<?> items)) {
      throw new AssertionError("expected a list but got " + value.getClass().getSimpleName());
    }
    List<Map<String, Object>> result = new ArrayList<>();
    for (Object item : items) {
      if (!(item instanceof Map<?, ?> map)) {
        throw new AssertionError("expected a map item but got " + item);
      }
      @SuppressWarnings("unchecked")
      Map<String, Object> typed = (Map<String, Object>) map;
      result.add(typed);
    }
    return List.copyOf(result);
  }

  private static String required(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException("真实 EasyV 集成验证缺少环境变量 " + name);
    }
    return value.trim();
  }

  static final class RequiredEnvironment
      implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override
    public void initialize(ConfigurableApplicationContext context) {
      List<String> missing = REQUIRED_ENVIRONMENT.stream()
          .filter(name -> System.getenv(name) == null || System.getenv(name).isBlank())
          .toList();
      if (!missing.isEmpty()) {
        throw new IllegalStateException(
            "Live EasyV integration is missing environment variables: " + String.join(", ", missing));
      }
      if (PERSIST_PLATFORM_RESULTS) {
        List<String> missingPlatform = List.of(
                "JAVA_DATABASE_URL", "JAVA_DATABASE_USERNAME", "JAVA_DATABASE_PASSWORD")
            .stream()
            .filter(name -> System.getenv(name) == null || System.getenv(name).isBlank())
            .toList();
        if (!missingPlatform.isEmpty()) {
          throw new IllegalStateException(
              "Persistent live platform ledger is missing environment variables: "
                  + String.join(", ", missingPlatform));
        }
      }
    }
  }
}
