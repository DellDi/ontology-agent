package com.dip3.ontologyagent.integration;

import com.dip3.ontologyagent.analysis.AnalysisService;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVInvocationContract;
import com.dip3.ontologyagent.execution.AgentInvocationRepository;
import com.dip3.ontologyagent.execution.AnalysisWorker;
import com.dip3.ontologyagent.execution.ExecutionSnapshot;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.internal.application.DatasetReleasePublisher;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.ontology.bootstrap.OntologyBootstrapService;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import java.time.Instant;
import java.nio.file.Path;
import java.time.Duration;
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
import org.testcontainers.containers.BindMode;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.Network;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.lifecycle.Startable;
import org.testcontainers.postgresql.PostgreSQLContainer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Explicit live gate: real OpenAI-compatible model + real EasyV test PostgreSQL + real Cube semantic
 * layer + local disposable platform ledger. It is only included by the {@code live-integration} Maven profile.
 * Persistent mode reads Cube from {@code LIVE_CUBE_API_URL}/{@code LIVE_CUBE_API_SECRET}.
 */
@Testcontainers
@SpringBootTest(properties = {
    "dip3.worker.enabled=false",
    "dip3.easyv.enabled=true",
    "dip3.easyv.source.enabled=true",
    "dip3.easyv.source.require-read-only-role=false",
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
      "EASYV_POSTGRES_PASSWORD");
  private static final String CUBE_SECRET = "live-easyv-cube-secret-with-adequate-entropy";
  private static final Network NETWORK = Network.newNetwork();

  static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine")
      .withNetwork(NETWORK).withNetworkAliases("postgres");

  static final GenericContainer<?> CUBE = new GenericContainer<>("cubejs/cube:v1.6.31")
      .withNetwork(NETWORK)
      .dependsOn(POSTGRES)
      .withEnv("CUBEJS_DB_TYPE", "postgres")
      .withEnv("CUBEJS_DB_HOST", "postgres")
      .withEnv("CUBEJS_DB_PORT", "5432")
      .withEnv("CUBEJS_DB_NAME", "test")
      .withEnv("CUBEJS_DB_USER", "test")
      .withEnv("CUBEJS_DB_PASS", "test")
      .withEnv("CUBEJS_API_SECRET", CUBE_SECRET)
      .withEnv("CUBEJS_DEV_MODE", "false")
      .withEnv("CUBEJS_TELEMETRY", "false")
      .withEnv("CUBEJS_CACHE_AND_QUEUE_DRIVER", "memory")
      .withFileSystemBind(Path.of("..", "cube", "conf").toAbsolutePath().normalize().toString(),
          "/cube/conf", BindMode.READ_ONLY)
      .withExposedPorts(4000)
      .waitingFor(Wait.forHttp("/readyz").forPort(4000).forStatusCode(200))
      .withStartupTimeout(Duration.ofMinutes(3));

  @Container
  static final Startable PLATFORM_DATABASE = PERSIST_PLATFORM_RESULTS
      ? NoopStartable.INSTANCE : POSTGRES;

  @Container
  static final Startable CUBE_ENGINE = PERSIST_PLATFORM_RESULTS ? NoopStartable.INSTANCE : CUBE;

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
    registry.add("dip3.easyv.source.jdbc-url", () -> required("EASYV_POSTGRES_JDBC_URL"));
    registry.add("dip3.easyv.source.username", () -> required("EASYV_POSTGRES_USERNAME"));
    registry.add("dip3.easyv.source.password", () -> required("EASYV_POSTGRES_PASSWORD"));
    registry.add("dip3.easyv.source.schema", () -> "easyv_saas");
    registry.add("dip3.easyv.source.maximum-pool-size", () -> "1");
    registry.add("dip3.easyv.source.connection-timeout", () -> "5s");
    registry.add("dip3.easyv.source.validation-timeout", () -> "1s");
    registry.add("dip3.easyv.source.statement-timeout", () -> "30s");
    registry.add("dip3.easyv.source.lock-timeout", () -> "1s");
    registry.add("dip3.easyv.source.idle-in-transaction-session-timeout", () -> "5s");
    registry.add("spring.ai.chat.memory.repository.jdbc.initialize-schema", () -> "never");
    registry.add("dip3.session-secret", () -> "live-easyv-session-secret-with-adequate-entropy");
    registry.add("dip3.redis-key-prefix", () -> "live-easyv");
    registry.add("dip3.cube.api-url", () -> PERSIST_PLATFORM_RESULTS ? required("LIVE_CUBE_API_URL")
        : "http://" + CUBE.getHost() + ":" + CUBE.getMappedPort(4000) + "/cubejs-api/v1");
    registry.add("dip3.cube.api-secret", () -> PERSIST_PLATFORM_RESULTS ? required("LIVE_CUBE_API_SECRET")
        : CUBE_SECRET);
    registry.add("dip3.cube.timeout", () -> "60s");
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
  @Autowired DatasetReleasePublisher releases;

  @MockitoBean WakeupPublisher wakeups;

  @Test
  void realModelPlansSemanticQueriesAndPersistsGroundedTestDatabaseResult() {
    AuthSession admin = new AuthSession(
        "live-easyv-admin",
        "platform-admin",
        "live-easyv-admin",
        new AccessScope("live-easyv", List.of(), List.of(), List.of("PLATFORM_ADMIN")),
        Instant.now().plusSeconds(600));
    assertTrue(bootstrap.bootstrap(admin, "live-easyv-bootstrap").status().ready());
    String datasetVersionSetId = publishCanonicalEasyV();

    AuthSession owner = new AuthSession(
        "live-easyv-auth",
        "1",
        "live-easyv-admin",
        new AccessScope("live-easyv", List.of(), List.of(), List.of("PLATFORM_ADMIN")),
        Instant.now().plusSeconds(600));
    String question = "EasyV 大屏生成任务的成功率、失败原因分布和各月生成趋势";

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
    assertEquals("semantic-query-read-only", snapshot.planSnapshot().get("mode"));
    assertEquals(datasetVersionSetId, snapshot.datasetVersionSetId());

    List<Map<String, Object>> evidence = listOfMaps(snapshot.conclusionState().get("evidence"));
    List<Map<String, Object>> claims = listOfMaps(snapshot.conclusionState().get("claims"));
    assertEquals("easyv-data-scope", evidence.getFirst().get("source"));
    assertTrue(evidence.stream().skip(1).allMatch(item -> item.get("source").toString().startsWith("easyv-query:")));
    assertEquals(1, claims.size());
    assertEquals("direct-answer", claims.getFirst().get("kind"));
    assertTrue(!listOfMaps(claims.getFirst().get("evidenceRefs")).isEmpty());
    assertEquals(1, invocations.count(
        executionId,
        EasyVInvocationContract.CONTRACT.invocationType(),
        EasyVInvocationContract.TOOL_NAME));
  }

  private String publishCanonicalEasyV() {
    String suffix = UUID.randomUUID().toString();
    String setId = "live-easyv-set-" + suffix;
    return releases.publish(new DatasetReleasePublisher.Command(
        setId, "easyv", EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS,
        IngestionRun.Mode.FULL, IngestionRun.TriggerType.MANUAL,
        "live-integration", "live-easyv-" + suffix, 2_000)).versionSet().publicationId();
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

  private enum NoopStartable implements Startable {
    INSTANCE;

    @Override
    public void start() {
      // The persistent platform database is managed outside Testcontainers.
    }

    @Override
    public void stop() {
      // Nothing to stop in persistent mode.
    }
  }
}
