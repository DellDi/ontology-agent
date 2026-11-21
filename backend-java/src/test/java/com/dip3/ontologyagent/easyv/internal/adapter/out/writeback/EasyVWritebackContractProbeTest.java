package com.dip3.ontologyagent.easyv.internal.adapter.out.writeback;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.easyv.internal.adapter.in.EasyVWritebackContractController;
import com.dip3.ontologyagent.easyv.internal.application.EasyVWritebackContractPort;
import com.dip3.ontologyagent.easyv.internal.application.EasyVWritebackContractService;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ContractStatus;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ItemStatus;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.Report;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeBlockWriteback;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;
import java.net.ServerSocket;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class EasyVWritebackContractProbeTest {
  @Container
  static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

  @Container
  static final GenericContainer<?> REDIS = new GenericContainer<>("redis:8-alpine")
      .withExposedPorts(6379);

  private static final ObjectMapper JSON = new ObjectMapper().registerModule(new JavaTimeModule());
  private static JdbcTemplate adminJdbc;

  private RedisClient redisClient;
  private StatefulRedisConnection<String, String> redisConn;
  private RedisCommands<String, String> redis;
  private EasyVWritebackContractProbe probe;

  @BeforeAll
  static void initRoles() {
    adminJdbc = new JdbcTemplate(new DriverManagerDataSource(
        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    adminJdbc.execute("""
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'easyv_probe_ro') THEN
            CREATE ROLE easyv_probe_ro LOGIN PASSWORD 'ro_probe_pass';
          END IF;
        END $$;
        """);
  }

  @BeforeEach
  void resetSchemaAndRedis() {
    adminJdbc.execute("DROP SCHEMA IF EXISTS easyv_saas CASCADE");
    adminJdbc.execute("CREATE SCHEMA easyv_saas");
    adminJdbc.execute("""
        CREATE TABLE easyv_saas.ai_screen_app (
          app_id text PRIMARY KEY,
          app_name text,
          generation_task_id text,
          scope_type text NOT NULL,
          user_id bigint,
          space_id bigint,
          team_id bigint,
          is_delete text
        )""");
    adminJdbc.execute("""
        CREATE TABLE easyv_saas.ai_screen_prototype (
          id bigint PRIMARY KEY,
          app_id text UNIQUE,
          screen_structure_xml text,
          screen_template_json jsonb,
          screen_prototype_json jsonb,
          update_time timestamp
        )""");
    adminJdbc.execute("""
        CREATE TABLE easyv_saas.ai_pipeline_node_record (
          id bigint PRIMARY KEY,
          task_id text,
          step_name text,
          output jsonb
        )""");
    adminJdbc.execute("""
        CREATE TABLE easyv_saas.ai_block_data (
          id int PRIMARY KEY,
          block_type_id text,
          chat_count int,
          block_slots_data text
        )""");
    adminJdbc.execute("""
        CREATE TABLE easyv_saas.ai_block_internal_data (
          id int PRIMARY KEY,
          allowed_chart_categories text,
          recommend_type text
        )""");
    adminJdbc.execute("""
        CREATE TABLE easyv_saas.ai_chart_type_mapping (
          id int PRIMARY KEY,
          chart_type text,
          chart_family text,
          scene_tag text,
          status text,
          sort_order int
        )""");
    adminJdbc.execute("GRANT USAGE ON SCHEMA easyv_saas TO easyv_probe_ro");
    adminJdbc.execute("GRANT SELECT ON ALL TABLES IN SCHEMA easyv_saas TO easyv_probe_ro");

    if (redisConn != null && redisConn.isOpen()) {
      redisConn.close();
    }
    if (redisClient != null) {
      redisClient.shutdown();
    }
    redisClient = RedisClient.create("redis://" + REDIS.getHost() + ":" + REDIS.getMappedPort(6379));
    redisConn = redisClient.connect();
    redis = redisConn.sync();
    redis.flushall();

    probe = new EasyVWritebackContractProbe(adminJdbc, redis, "easyv_saas");
  }

  @AfterEach
  void closeRedis() {
    if (redisConn != null && redisConn.isOpen()) {
      redisConn.close();
      redisConn = null;
    }
    if (redisClient != null) {
      redisClient.shutdown();
      redisClient = null;
    }
  }

  @Test
  void passesAllChecksAndSamplesLatestThreeUndeletedAppsWithZeroWrites() throws Exception {
    seedValidDataset();
    // Seed an older 4th active app, a deleted app, and a draft app with broken payloads that must NOT be sampled.
    adminJdbc.update(
        "INSERT INTO easyv_saas.ai_screen_app VALUES ('app-old','旧应用','task-old','USER',3,4,0,'0')");
    adminJdbc.update(
        "INSERT INTO easyv_saas.ai_screen_prototype VALUES (1,'app-old','<Pages/>','{}'::jsonb,'{\"broken\":true}'::jsonb,'2026-10-01 00:00:00')");
    adminJdbc.update(
        "INSERT INTO easyv_saas.ai_pipeline_node_record VALUES (1,'task-old','PipelineCompleted','{\"broken\":true}'::jsonb)");

    adminJdbc.update(
        "INSERT INTO easyv_saas.ai_screen_app VALUES ('app-deleted','已删','task-del','USER',3,4,0,'1')");
    adminJdbc.update(
        "INSERT INTO easyv_saas.ai_screen_prototype VALUES (99,'app-deleted','<Pages/>','{}'::jsonb,'{\"broken\":true}'::jsonb,'2026-11-21 00:00:00')");

    adminJdbc.update(
        "INSERT INTO easyv_saas.ai_screen_app VALUES ('app-draft','草稿',NULL,'USER',3,4,0,'0')");
    adminJdbc.update(
        "INSERT INTO easyv_saas.ai_screen_prototype VALUES (100,'app-draft','<Pages/>','{}'::jsonb,'{\"broken\":true}'::jsonb,'2026-11-21 00:00:00')");

    redis.set("ai:screen:regen:task-4", "keep-existing-cache");
    redis.set("probe:sentinel", "untouched");

    long delCallsBefore = redisCommandCalls(redis.info("commandstats"), "del");
    long setCallsBefore = redisCommandCalls(redis.info("commandstats"), "set");
    long pingCallsBefore = redisCommandCalls(redis.info("commandstats"), "ping");
    long dbSizeBefore = redis.dbsize();
    List<Map<String, Object>> prototypesBefore = adminJdbc.queryForList(
        "SELECT id, app_id, screen_prototype_json::text, update_time FROM easyv_saas.ai_screen_prototype ORDER BY id");

    // Also run via SELECT-only DB role to verify read-only privilege sufficiency and READ ONLY transaction enforcement.
    JdbcTemplate roJdbc = new JdbcTemplate(new DriverManagerDataSource(
        POSTGRES.getJdbcUrl(), "easyv_probe_ro", "ro_probe_pass"));
    Report report = new EasyVWritebackContractProbe(roJdbc, redis, "easyv_saas").check();

    assertEquals(ContractStatus.PASSED, report.status());
    assertTrue(report.actionEnabled());
    assertEquals("easyv_saas", report.schema());
    assertEquals(ItemStatus.PASSED, report.schemaCheck().status());
    assertEquals(6, report.schemaCheck().tables().size());
    assertTrue(report.schemaCheck().tables().stream().allMatch(t -> t.status() == ItemStatus.PASSED));
    assertEquals(ItemStatus.PASSED, report.sampleCheck().status());
    assertEquals(3, report.sampleCheck().sampledAppCount());
    assertEquals(List.of("app-4", "app-3", "app-2"),
        report.sampleCheck().samples().stream().map(EasyVWritebackContract.SampleResult::appId).toList());
    assertEquals(ItemStatus.PASSED, report.chartMappingCheck().status());
    assertEquals(3L, report.chartMappingCheck().totalCount());
    assertEquals(2L, report.chartMappingCheck().enabledCount());
    assertEquals(ItemStatus.PASSED, report.redisCheck().status());
    assertEquals("PONG", report.redisCheck().pingResponse());
    assertEquals("ai:screen:regen:<generationTaskId>", report.redisCheck().expectedInvalidationKeyPattern());
    assertNotNull(report.redisCheck().latencyMs());
    assertTrue(report.diagnostics().isEmpty());
    assertTrue(report.contractChecklist().stream().allMatch(c -> c.status() == ItemStatus.PASSED));

    // Zero writes on Redis and PostgreSQL.
    String statsAfter = redis.info("commandstats");
    assertEquals(delCallsBefore, redisCommandCalls(statsAfter, "del"));
    assertEquals(setCallsBefore, redisCommandCalls(statsAfter, "set"));
    assertEquals(pingCallsBefore + 1, redisCommandCalls(statsAfter, "ping"));
    assertEquals(dbSizeBefore, redis.dbsize());
    assertEquals("keep-existing-cache", redis.get("ai:screen:regen:task-4"));
    assertEquals("untouched", redis.get("probe:sentinel"));
    assertEquals(prototypesBefore, adminJdbc.queryForList(
        "SELECT id, app_id, screen_prototype_json::text, update_time FROM easyv_saas.ai_screen_prototype ORDER BY id"));
  }

  @Test
  void failsLoudlyOnMissingTableMissingColumnAndIncompatibleType() {
    seedValidDataset();

    // 1. Missing table
    adminJdbc.execute("DROP TABLE easyv_saas.ai_block_internal_data");
    Report missingTable = probe.check();
    assertEquals(ContractStatus.FAILED, missingTable.status());
    assertEquals(ItemStatus.FAILED, missingTable.schemaCheck().status());
    assertTrue(missingTable.diagnostics().stream()
        .anyMatch(d -> "TABLE_MISSING".equals(d.code()) && d.target().contains("ai_block_internal_data")));
    assertEquals(ItemStatus.PASSED, missingTable.redisCheck().status());

    // Recreate table and test missing column
    adminJdbc.execute("""
        CREATE TABLE easyv_saas.ai_block_internal_data (
          id int PRIMARY KEY,
          allowed_chart_categories text,
          recommend_type text
        )""");
    adminJdbc.execute("ALTER TABLE easyv_saas.ai_chart_type_mapping DROP COLUMN sort_order");
    Report missingColumn = probe.check();
    assertEquals(ContractStatus.FAILED, missingColumn.status());
    assertEquals(ItemStatus.SKIPPED, missingColumn.chartMappingCheck().status());
    assertTrue(missingColumn.diagnostics().stream()
        .anyMatch(d -> "COLUMN_MISSING".equals(d.code()) && d.target().equals("ai_chart_type_mapping.sort_order")));

    // Restore sort_order and break column types (output jsonb -> text, allowed_chart_categories text -> jsonb)
    adminJdbc.execute("ALTER TABLE easyv_saas.ai_chart_type_mapping ADD COLUMN sort_order int");
    adminJdbc.execute("ALTER TABLE easyv_saas.ai_pipeline_node_record ALTER COLUMN output TYPE text USING output::text");
    adminJdbc.execute("ALTER TABLE easyv_saas.ai_block_internal_data ALTER COLUMN allowed_chart_categories TYPE jsonb USING '{}'::jsonb");
    Report badTypes = probe.check();
    assertEquals(ContractStatus.FAILED, badTypes.status());
    assertEquals(ItemStatus.SKIPPED, badTypes.sampleCheck().status());
    assertTrue(badTypes.diagnostics().stream()
        .anyMatch(d -> "COLUMN_TYPE_INCOMPATIBLE".equals(d.code()) && d.target().equals("ai_pipeline_node_record.output")));
    assertTrue(badTypes.diagnostics().stream()
        .anyMatch(d -> "COLUMN_TYPE_INCOMPATIBLE".equals(d.code()) && d.target().equals("ai_block_internal_data.allowed_chart_categories")));
  }

  @Test
  void failsLoudlyOnBrokenJsonProjectionPathsOrMissingPipelineCompletedRecord() throws Exception {
    seedValidDataset();

    // Break screen_prototype_json: rename blocks -> regions on app-4
    adminJdbc.update(
        "UPDATE easyv_saas.ai_screen_prototype SET screen_prototype_json = '{\"page-1\":{\"regions\":{}}}'::jsonb WHERE app_id = 'app-4'");
    // Break PipelineCompleted output on app-3: remove currentBlockThemes & blockCandidates
    ObjectNode brokenOutput = validEditingOutput("b");
    ((ObjectNode) brokenOutput.at(PrototypeBlockWriteback.REGEN_CONTEXT_SNAPSHOT_PATH)).remove("currentBlockThemes");
    ((ObjectNode) brokenOutput.at("/output/raw/regenContextSnapshot/step5Candidates")).remove("blockCandidates");
    adminJdbc.update(
        "UPDATE easyv_saas.ai_pipeline_node_record SET output = ?::jsonb WHERE task_id = 'task-3'",
        brokenOutput.toString());
    // Break PipelineCompleted step_name on app-2
    adminJdbc.update(
        "UPDATE easyv_saas.ai_pipeline_node_record SET step_name = 'Step6' WHERE task_id = 'task-2'");

    Report report = probe.check();
    assertEquals(ContractStatus.FAILED, report.status());
    assertEquals(ItemStatus.FAILED, report.sampleCheck().status());
    assertEquals(3, report.sampleCheck().sampledAppCount());

    var byApp = report.sampleCheck().samples().stream()
        .collect(java.util.stream.Collectors.toMap(
            EasyVWritebackContract.SampleResult::appId, s -> s));
    assertTrue(byApp.get("app-4").missingOrInvalidPaths().contains("page/blocks"));
    assertTrue(byApp.get("app-3").missingOrInvalidPaths().contains(PrototypeBlockWriteback.CURRENT_BLOCK_THEMES_PATH));
    assertTrue(byApp.get("app-3").missingOrInvalidPaths().contains(PrototypeBlockWriteback.BLOCK_CANDIDATES_PATH));
    assertTrue(byApp.get("app-2").missingOrInvalidPaths().stream()
        .anyMatch(p -> p.contains("PipelineCompleted")));
    assertTrue(report.diagnostics().stream().anyMatch(d -> "JSON_PATH_BROKEN".equals(d.code())));
  }

  @Test
  void reportsExplicitEmptySampleWarningAndNeverFalselyPasses() {
    // All 6 tables exist, Redis is up, but tables have zero rows -> SAMPLE_EMPTY (not PASSED).
    Report emptyReport = probe.check();
    assertEquals(ContractStatus.SAMPLE_EMPTY, emptyReport.status());
    assertEquals(ItemStatus.PASSED, emptyReport.schemaCheck().status());
    assertEquals(ItemStatus.SAMPLE_EMPTY, emptyReport.sampleCheck().status());
    assertEquals(ItemStatus.SAMPLE_EMPTY, emptyReport.chartMappingCheck().status());
    assertEquals(ItemStatus.PASSED, emptyReport.redisCheck().status());
    assertTrue(emptyReport.diagnostics().stream().anyMatch(d -> "SAMPLE_EMPTY".equals(d.code())));
    assertTrue(emptyReport.diagnostics().stream().anyMatch(d -> "CHART_MAPPING_EMPTY".equals(d.code())));

    // Also test: chart rules exist, but no active apps -> still SAMPLE_EMPTY (never PASSED).
    adminJdbc.update("INSERT INTO easyv_saas.ai_chart_type_mapping VALUES (1,'柱状图','bar','对比','0',1)");
    Report partialEmpty = probe.check();
    assertEquals(ContractStatus.SAMPLE_EMPTY, partialEmpty.status());
    assertEquals(ItemStatus.SAMPLE_EMPTY, partialEmpty.sampleCheck().status());
    assertEquals(ItemStatus.PASSED, partialEmpty.chartMappingCheck().status());
    adminJdbc.execute("TRUNCATE easyv_saas.ai_chart_type_mapping");

    // Now populate valid apps, but all chart mapping rules are disabled (status='1') -> FAILED.
    seedValidDataset();
    adminJdbc.update("UPDATE easyv_saas.ai_chart_type_mapping SET status = '1'");
    Report noEnabledCharts = probe.check();
    assertEquals(ContractStatus.FAILED, noEnabledCharts.status());
    assertEquals(ItemStatus.PASSED, noEnabledCharts.sampleCheck().status());
    assertEquals(ItemStatus.FAILED, noEnabledCharts.chartMappingCheck().status());
    assertEquals(3L, noEnabledCharts.chartMappingCheck().totalCount());
    assertEquals(0L, noEnabledCharts.chartMappingCheck().enabledCount());
    assertTrue(noEnabledCharts.diagnostics().stream()
        .anyMatch(d -> "CHART_MAPPING_NONE_ENABLED".equals(d.code())));
  }

  @Test
  void failsLoudlyWhenSourceRedisIsUnreachableAndNeverLeaksCredentials() throws Exception {
    seedValidDataset();
    int deadPort;
    try (ServerSocket socket = new ServerSocket(0)) {
      deadPort = socket.getLocalPort();
    }

    String dbSecret = "pg-top-secret-password";
    String redisSecret = "redis-top-secret-password";
    new ApplicationContextRunner()
        .withUserConfiguration(EasyVActionConfiguration.class, EasyVWritebackContractService.class)
        .withPropertyValues(
            "dip3.easyv.enabled=true",
            "dip3.easyv.action.enabled=true",
            "dip3.easyv.action.jdbc-url=" + POSTGRES.getJdbcUrl(),
            "dip3.easyv.action.username=" + POSTGRES.getUsername(),
            "dip3.easyv.action.password=" + POSTGRES.getPassword(),
            "dip3.easyv.action.schema=easyv_saas",
            "dip3.easyv.action.redis-url=redis://:" + redisSecret + "@127.0.0.1:" + deadPort)
        .run(context -> {
          assertNull(context.getStartupFailure());
          Report report = context.getBean(EasyVWritebackContractPort.class).check();
          assertEquals(ContractStatus.FAILED, report.status());
          assertEquals(ItemStatus.PASSED, report.schemaCheck().status());
          assertEquals(ItemStatus.PASSED, report.sampleCheck().status());
          assertEquals(ItemStatus.PASSED, report.chartMappingCheck().status());
          assertEquals(ItemStatus.FAILED, report.redisCheck().status());
          assertTrue(report.diagnostics().stream().anyMatch(d -> "REDIS_UNREACHABLE".equals(d.code())));

          String serialized = JSON.writeValueAsString(report);
          assertFalse(serialized.contains(redisSecret));
          assertFalse(serialized.contains(dbSecret));
          assertFalse(serialized.contains(POSTGRES.getPassword()));
        });

    // Also test unreachable DB + Redis credential redaction.
    new ApplicationContextRunner()
        .withUserConfiguration(EasyVActionConfiguration.class, EasyVWritebackContractService.class)
        .withPropertyValues(
            "dip3.easyv.enabled=true",
            "dip3.easyv.action.enabled=true",
            "dip3.easyv.action.jdbc-url=jdbc:postgresql://127.0.0.1:" + deadPort + "/easyv?password=" + dbSecret,
            "dip3.easyv.action.username=secret_user",
            "dip3.easyv.action.password=" + dbSecret,
            "dip3.easyv.action.schema=easyv_saas",
            "dip3.easyv.action.redis-url=redis://:" + redisSecret + "@127.0.0.1:" + deadPort)
        .run(context -> {
          assertNull(context.getStartupFailure());
          Report report = context.getBean(EasyVWritebackContractPort.class).check();
          assertEquals(ContractStatus.FAILED, report.status());
          assertEquals(ItemStatus.FAILED, report.schemaCheck().status());
          assertEquals(ItemStatus.FAILED, report.redisCheck().status());
          assertTrue(report.diagnostics().stream().anyMatch(d -> "DATABASE_UNAVAILABLE".equals(d.code())));
          assertTrue(report.diagnostics().stream().anyMatch(d -> "REDIS_UNREACHABLE".equals(d.code())));

          String serialized = JSON.writeValueAsString(report);
          assertFalse(serialized.contains(redisSecret));
          assertFalse(serialized.contains(dbSecret));
        });

    // Also test a live Redis container stopping after probe initialization.
    try (GenericContainer<?> ephemeralRedis = new GenericContainer<>("redis:8-alpine").withExposedPorts(6379)) {
      ephemeralRedis.start();
      RedisURI uri = RedisURI.create("redis://" + ephemeralRedis.getHost() + ":" + ephemeralRedis.getMappedPort(6379));
      uri.setTimeout(Duration.ofSeconds(2));
      try (RedisClient client = RedisClient.create(uri);
           StatefulRedisConnection<String, String> conn = client.connect()) {
        var liveProbe = new EasyVWritebackContractProbe(adminJdbc, conn.sync(), "easyv_saas");
        assertEquals(ContractStatus.PASSED, liveProbe.check().status());
        ephemeralRedis.stop();
        Report afterStop = liveProbe.check();
        assertEquals(ContractStatus.FAILED, afterStop.status());
        assertEquals(ItemStatus.FAILED, afterStop.redisCheck().status());
        assertTrue(afterStop.diagnostics().stream().anyMatch(d -> "REDIS_UNREACHABLE".equals(d.code())));
      }
    }
  }

  @Test
  void returnsExplicitDisabledReportWhenActionWritebackIsDisabled() {
    new ApplicationContextRunner()
        .withUserConfiguration(
            EasyVActionConfiguration.class,
            EasyVWritebackContractService.class,
            EasyVWritebackContractController.class)
        .withBean(CookieSessionAuthenticator.class, () -> mock(CookieSessionAuthenticator.class))
        .withPropertyValues(
            "dip3.easyv.enabled=true",
            "dip3.easyv.action.enabled=false")
        .run(context -> {
          assertNull(context.getStartupFailure());
          Report report = context.getBean(EasyVWritebackContractPort.class).check();
          assertEquals(ContractStatus.DISABLED, report.status());
          assertFalse(report.actionEnabled());
          assertNotNull(report.disabledReason());
          assertFalse(report.disabledReason().isBlank());
          assertEquals(ItemStatus.DISABLED, report.schemaCheck().status());
          assertEquals(ItemStatus.DISABLED, report.sampleCheck().status());
          assertEquals(ItemStatus.DISABLED, report.chartMappingCheck().status());
          assertEquals(ItemStatus.DISABLED, report.redisCheck().status());
          assertEquals(EasyVWritebackContract.REQUIRED_TABLES.size()
              + EasyVWritebackContract.REQUIRED_JSON_PATHS.size() + 2,
              report.contractChecklist().size());
          assertTrue(report.contractChecklist().stream().allMatch(i -> i.status() == ItemStatus.PENDING));
        });
  }

  @Test
  void enforcesAdminAuthEndToEndWithIsolatedActionConnectionsAndRespectsEasyvFeatureFlag() {
    seedValidDataset();
    redis.set("ai:screen:regen:task-4", "keep-after-http");
    JdbcTemplate mainJdbc = mock(JdbcTemplate.class);
    StringRedisTemplate mainRedis = mock(StringRedisTemplate.class);
    CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);

    new ApplicationContextRunner()
        .withUserConfiguration(
            EasyVActionConfiguration.class,
            EasyVWritebackContractService.class,
            EasyVWritebackContractController.class)
        .withBean("jdbcTemplate", JdbcTemplate.class, () -> mainJdbc)
        .withBean("stringRedisTemplate", StringRedisTemplate.class, () -> mainRedis)
        .withBean(CookieSessionAuthenticator.class, () -> auth)
        .withPropertyValues(
            "dip3.easyv.enabled=true",
            "dip3.easyv.action.enabled=true",
            "dip3.easyv.action.jdbc-url=" + POSTGRES.getJdbcUrl(),
            "dip3.easyv.action.username=" + POSTGRES.getUsername(),
            "dip3.easyv.action.password=" + POSTGRES.getPassword(),
            "dip3.easyv.action.schema=easyv_saas",
            "dip3.easyv.action.redis-url=redis://" + REDIS.getHost() + ":" + REDIS.getMappedPort(6379))
        .run(context -> {
          assertNull(context.getStartupFailure());
          assertSame(mainJdbc, context.getBean(JdbcTemplate.class));
          assertSame(mainRedis, context.getBean(StringRedisTemplate.class));
          // Spring invokes InitializingBean.afterPropertiesSet() on mock JdbcTemplate at startup; clear before probing.
          clearInvocations(mainJdbc, mainRedis);

          MockMvc mvc = MockMvcBuilders.standaloneSetup(context.getBean(EasyVWritebackContractController.class))
              .setControllerAdvice(new ApiExceptionHandler())
              .build();

          // 401 anonymous
          when(auth.authenticate(any())).thenReturn(Optional.empty());
          mvc.perform(get("/api/admin/easyv/writeback/contract-check"))
              .andExpect(status().isUnauthorized())
              .andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));

          // 403 non-admin
          when(auth.authenticate(any())).thenReturn(Optional.of(new AuthSession(
              "sess-analyst", "10", "分析师",
              new AccessScope("org-1", List.of(), List.of(), List.of("EASYV_ANALYST")), Instant.MAX)));
          mvc.perform(get("/api/admin/easyv/writeback/contract-check"))
              .andExpect(status().isForbidden())
              .andExpect(jsonPath("$.code").value("EASYV_WRITEBACK_CONTRACT_FORBIDDEN"));

          // 200 platform admin
          when(auth.authenticate(any())).thenReturn(Optional.of(new AuthSession(
              "sess-admin", "1", "管理员",
              new AccessScope("platform", List.of(), List.of(), List.of("PLATFORM_ADMIN")), Instant.MAX)));
          mvc.perform(get("/api/admin/easyv/writeback/contract-check"))
              .andExpect(status().isOk())
              .andExpect(jsonPath("$.status").value("PASSED"))
              .andExpect(jsonPath("$.actionEnabled").value(true))
              .andExpect(jsonPath("$.schemaCheck.status").value("PASSED"))
              .andExpect(jsonPath("$.sampleCheck.sampledAppCount").value(3))
              .andExpect(jsonPath("$.chartMappingCheck.enabledCount").value(2))
              .andExpect(jsonPath("$.redisCheck.pingResponse").value("PONG"))
              .andExpect(jsonPath("$.redisCheck.expectedInvalidationKeyPattern")
                  .value("ai:screen:regen:<generationTaskId>"));

          verifyNoInteractions(mainJdbc, mainRedis);
          assertEquals("keep-after-http", redis.get("ai:screen:regen:task-4"));
        });

    new ApplicationContextRunner()
        .withUserConfiguration(
            EasyVActionConfiguration.class,
            EasyVWritebackContractService.class,
            EasyVWritebackContractController.class)
        .withBean(CookieSessionAuthenticator.class, () -> auth)
        .withPropertyValues("dip3.easyv.enabled=false")
        .run(context -> {
          assertNull(context.getStartupFailure());
          assertTrue(context.getBeansOfType(EasyVWritebackContractPort.class).isEmpty());
          assertTrue(context.getBeansOfType(EasyVWritebackContractService.class).isEmpty());
          assertTrue(context.getBeansOfType(EasyVWritebackContractController.class).isEmpty());
        });
  }

  private void seedValidDataset() {
    for (int i = 2; i <= 4; i++) {
      String appId = "app-" + i;
      String taskId = "task-" + i;
      adminJdbc.update(
          "INSERT INTO easyv_saas.ai_screen_app VALUES (?, ?, ?, 'USER', 3, 4, 0, '0')",
          appId, "大屏-" + i, taskId);
      adminJdbc.update(
          "INSERT INTO easyv_saas.ai_screen_prototype VALUES (?, ?, '<Pages/>', '{}'::jsonb, ?::jsonb, ?)",
          i, appId, validPrototype("b").toString(),
          java.sql.Timestamp.valueOf("2026-11-2" + i + " 10:00:00"));
      adminJdbc.update(
          "INSERT INTO easyv_saas.ai_pipeline_node_record VALUES (?, ?, 'PipelineCompleted', ?::jsonb)",
          i, taskId, validEditingOutput("b").toString());
    }
    adminJdbc.update(
        "INSERT INTO easyv_saas.ai_block_internal_data VALUES (1, '[\"chart\",\"indicator\"]', '[]')");
    adminJdbc.update(
        "INSERT INTO easyv_saas.ai_block_data VALUES (1, '1', 1, ?)",
        "[{\"block_internal_id\":1,\"role\":\"main\",\"weight\":1,\"position\":{\"col\":1,\"row\":1,\"colSpan\":12,\"rowSpan\":12}}]");
    adminJdbc.update(
        "INSERT INTO easyv_saas.ai_chart_type_mapping VALUES "
            + "(1,'柱状图','bar','对比','0',1),"
            + "(2,'条形图','horizontal-bar','对比','0',2),"
            + "(3,'停用图','legacy','对比','1',3)");
  }

  private static ObjectNode validPrototype(String blockId) {
    ObjectNode block = JSON.createObjectNode();
    block.put("id", blockId).put("themeId", "theme-1").put("businessModule", "收入概览")
        .put("title", "收入概览").put("blockTypeId", "1").put("schemeId", "1");
    ArrayNode components = block.putArray("components");
    components.addObject().put("id", "c0").put("chartFamily", "bar").put("metricName", "总收入");
    block.putArray("boundMetricIds").add("m0");
    block.putArray("boundMetrics").addObject().put("metricId", "m0").put("unit", "元");

    ObjectNode root = JSON.createObjectNode();
    ObjectNode blocks = root.putObject("page-1").putObject("blocks");
    blocks.set(blockId, block);
    blocks.putObject("other").put("schemeId", "other").putArray("components");
    return root;
  }

  private static ObjectNode validEditingOutput(String blockId) {
    ObjectNode event = JSON.createObjectNode();
    ObjectNode snapshot = event.putObject("output").putObject("raw").putObject("regenContextSnapshot");
    ObjectNode filled = snapshot.putArray("currentFilledBlocks").addObject().put("blockId", blockId);
    filled.putArray("slotBindings").addObject()
        .put("slotIndex", 0)
        .put("chartType", "柱状图")
        .putObject("boundMetric").put("metricId", "m0");
    ObjectNode theme = snapshot.putArray("currentBlockThemes").addObject()
        .put("themeId", "theme-1").put("businessModule", "收入概览");
    ObjectNode candidates = snapshot.putObject("step5Candidates");
    candidates.putArray("blockCandidates").addObject().put("blockId", blockId);
    ArrayNode assignments = candidates.putObject("step4Output").putArray("blockAssignments");
    assignments.addObject().put("blockId", blockId).put("themeId", "theme-1")
        .set("assignedTheme", theme.deepCopy());
    assignments.addObject().put("blockId", "other").put("themeId", "theme-other");
    return event;
  }

  private static long redisCommandCalls(String commandStats, String command) {
    if (commandStats == null) {
      return 0L;
    }
    Matcher matcher = Pattern.compile("cmdstat_" + Pattern.quote(command) + ":calls=(\\d+)")
        .matcher(commandStats);
    return matcher.find() ? Long.parseLong(matcher.group(1)) : 0L;
  }
}
