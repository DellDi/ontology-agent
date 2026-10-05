package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.support.MigrationTestSupport;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.containers.BindMode;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.Network;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** 显式 live 门禁：真实模型/Cube/Redis/HTTP，源 fixture 仅存在于隔离 PostgreSQL。 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "dip3.worker.enabled=false", "dip3.easyv.enabled=true", "dip3.easyv.source.enabled=false",
    "dip3.property.enabled=false", "dip3.auth.providers.local.enabled=true",
    "dip3.stream.poll-delay=50ms", "dip3.stream.timeout=2m"
})
@ContextConfiguration(initializers = EasyVPlanningEvalIT.RequiredEnvironment.class)
class EasyVRuntimeEvalIT {
  private static final String CUBE_SECRET = "easyv-runtime-eval-cube-secret-with-entropy";
  private static final Network NETWORK = Network.newNetwork();

  @Container
  static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine")
      .withNetwork(NETWORK).withNetworkAliases("postgres");

  @Container
  static final GenericContainer<?> REDIS = new GenericContainer<>("redis:8.2.5-bookworm")
      .withExposedPorts(6379);

  @Container
  static final GenericContainer<?> CUBE = new GenericContainer<>("cubejs/cube:v1.6.31")
      .withNetwork(NETWORK).dependsOn(POSTGRES)
      .withEnv("CUBEJS_DB_TYPE", "postgres").withEnv("CUBEJS_DB_HOST", "postgres")
      .withEnv("CUBEJS_DB_PORT", "5432").withEnv("CUBEJS_DB_NAME", "test")
      .withEnv("CUBEJS_DB_USER", "test").withEnv("CUBEJS_DB_PASS", "test")
      .withEnv("CUBEJS_API_SECRET", CUBE_SECRET).withEnv("CUBEJS_DEV_MODE", "false")
      .withEnv("CUBEJS_TELEMETRY", "false").withEnv("CUBEJS_CACHE_AND_QUEUE_DRIVER", "memory")
      .withEnv("CUBEJS_DEFAULT_TIMEZONE", "Asia/Shanghai")
      .withFileSystemBind(Path.of("..", "cube", "conf").toAbsolutePath().normalize().toString(),
          "/cube/conf", BindMode.READ_ONLY)
      .withExposedPorts(4000)
      .waitingFor(Wait.forHttp("/readyz").forPort(4000).forStatusCode(200))
      .withStartupTimeout(Duration.ofMinutes(3));

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    EasyVPlanningEvalIT.providerProperties(registry);
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.data.redis.url", () -> "redis://" + REDIS.getHost() + ":" + REDIS.getMappedPort(6379));
    registry.add("dip3.cube.api-url", () -> "http://" + CUBE.getHost() + ":" + CUBE.getMappedPort(4000) + "/cubejs-api/v1");
    registry.add("dip3.cube.api-secret", () -> CUBE_SECRET);
    registry.add("dip3.cube.timeout", () -> "60s");
  }

  @BeforeAll
  static void migrate() {
    MigrationTestSupport.migrate(POSTGRES);
  }

  @Autowired ApplicationContext application;
  @LocalServerPort int port;
  @MockitoSpyBean EasyVAnalysisModel model;
  @MockitoSpyBean org.springframework.ai.openai.OpenAiChatModel provider;
  private final List<EasyVAnalysisModel.PlanDecision> decisions = new ArrayList<>();
  private final List<String> responses = new ArrayList<>();

  @BeforeEach
  void recordRealModelDecisions() {
    org.mockito.Mockito.doAnswer(invocation -> {
      // 每轮首次真实规划前等待，确定性覆盖原先容器 30 秒异步超时截断 SSE 的故障。
      if (decisions.isEmpty() && responses.isEmpty()) Thread.sleep(Duration.ofSeconds(32));
      var decision = (EasyVAnalysisModel.PlanDecision) invocation.callRealMethod();
      decisions.add(decision);
      return decision;
    }).when(model).plan(org.mockito.ArgumentMatchers.any());
    org.mockito.Mockito.doAnswer(invocation -> {
      @SuppressWarnings("unchecked")
      var response = (reactor.core.publisher.Flux<org.springframework.ai.chat.model.ChatResponse>) invocation.callRealMethod();
      var text = new StringBuilder();
      return response.doOnNext(chunk -> {
        String value = chunk.getResult().getOutput().getText();
        if (value != null) text.append(value);
      }).doOnComplete(() -> responses.add(text.toString()));
    }).when(provider).stream(org.mockito.ArgumentMatchers.any(org.springframework.ai.chat.prompt.Prompt.class));
  }

  @Test
  void realMetricsDrillDownAndSelectedAssessmentThroughHttp() throws Exception {
    new EasyVHttpRuntimeEval(application, decisions, responses, port).verify();
  }
}
