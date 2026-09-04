package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.config.EasyVPostgresProperties;
import com.dip3.ontologyagent.easyv.internal.application.EasyVGenerationFacts;
import com.dip3.ontologyagent.support.BackendException;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class EasyVPostgresFactAdapterTest {
  @Container
  static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");

  private static JdbcTemplate admin;
  private static HikariDataSource readerDataSource;
  private static EasyVPostgresFactAdapter readerAdapter;

  @BeforeAll
  static void setupDatabase() {
    admin = new JdbcTemplate(new DriverManagerDataSource(
        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    admin.execute("CREATE SCHEMA easyv_saas");
    admin.execute("CREATE TABLE easyv_saas.ai_screen_app (app_id varchar(128) PRIMARY KEY, generation_task_id varchar(128), user_id bigint NOT NULL, scope_type varchar(16) NOT NULL, create_time timestamp NOT NULL)");
    admin.execute("CREATE TABLE easyv_saas.ai_screen_prototype (app_id varchar(128) PRIMARY KEY)");
    admin.execute("CREATE TABLE easyv_saas.ai_pipeline_node_record (id bigserial PRIMARY KEY, task_id varchar(128) NOT NULL, step_name varchar(64) NOT NULL, branch varchar(16) NOT NULL, status varchar(16) NOT NULL, duration_ms bigint, create_time timestamp NOT NULL)");
    admin.execute("CREATE TABLE easyv_saas.generation_tasks (task_id varchar(128) PRIMARY KEY, app_id varchar(128) NOT NULL, status varchar(16) NOT NULL, failure_reason jsonb, started_at timestamp, finished_at timestamp, create_time timestamp NOT NULL)");
    admin.execute("CREATE TABLE easyv_saas.dt_ai_operation_log (id bigserial PRIMARY KEY, user_id bigint NOT NULL, app_id varchar(128), operate_time timestamptz NOT NULL, execute_result smallint NOT NULL, rating smallint, is_save_as_edit boolean)");
    admin.execute("CREATE ROLE easyv_reader LOGIN PASSWORD 'reader' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS");
    admin.execute("GRANT USAGE ON SCHEMA easyv_saas TO easyv_reader");
    admin.execute("GRANT SELECT ON ALL TABLES IN SCHEMA easyv_saas TO easyv_reader");
    insertFixture();
    readerDataSource = readerDataSource();
    readerAdapter = adapter(readerDataSource, true);
  }

  @BeforeEach
  void resetFixture() {
    admin.update("UPDATE easyv_saas.ai_pipeline_node_record SET duration_ms = 100, status = 'SUCCESS'");
    admin.update("UPDATE easyv_saas.generation_tasks SET started_at = TIMESTAMP '2026-08-01 00:05:00', finished_at = TIMESTAMP '2026-08-01 00:06:00' WHERE app_id = 'app-1'");
    admin.update("UPDATE easyv_saas.generation_tasks SET status = 'completed' WHERE task_id IN ('forge-task-1','forge-task-2')");
  }

  @AfterAll
  static void close() {
    if (readerDataSource != null) readerDataSource.close();
  }

  @Test
  void collectsOnlyCreatorFactsAndUsesAppIdForForgeCorrelation() {
    EasyVGenerationFacts.Snapshot snapshot = readerAdapter.collect(query("1"));

    assertEquals(1, snapshot.application().applicationCount());
    assertEquals(1, snapshot.application().prototypeCount());
    assertEquals(1, snapshot.pipeline().taskCount());
    assertEquals(1, snapshot.pipeline().completedTaskCount());
    assertEquals(2, snapshot.forge().taskCount());
    assertEquals(1, snapshot.forge().completedTaskCount());
    assertEquals(1, snapshot.forge().failedTaskCount());
    assertEquals(2, snapshot.feedback().operationCount());
    assertEquals(1, snapshot.feedback().combinedExecuteSuccessCount());
    assertEquals(1, snapshot.feedback().combinedExecuteFailureCount());
    assertEquals(1, snapshot.forge().failureReasonCounts().size());
    assertTrue(snapshot.forge().failureReasonCounts().keySet().stream().allMatch(key -> key.startsWith("md5:")));
    assertEquals("1", snapshot.application().window().userId());
    assertEquals(LocalDate.of(2026, 8, 1), snapshot.application().window().from());
    assertTrue(EasyVPostgresFactAdapter.TIME_SEMANTICS.get("forge").contains("generation_tasks.create_time"));
  }

  @Test
  void partialPipelineDurationIsAllowedAndCoverageIsExposed() {
    admin.update("UPDATE easyv_saas.ai_pipeline_node_record SET duration_ms = NULL WHERE task_id = 'java-task-1' AND step_name = 'Step1'");
    EasyVGenerationFacts.Snapshot snapshot = readerAdapter.collect(query("1"));
    assertEquals(2, snapshot.pipeline().mainNodeCount());
    assertEquals(1, snapshot.pipeline().timedNodeCount());
    assertEquals(100, snapshot.pipeline().bottleneckP95Millis());
  }

  @Test
  void allPipelineDurationMissingFailsLoudlyInsteadOfReturningZero() {
    admin.update("UPDATE easyv_saas.ai_pipeline_node_record SET duration_ms = NULL WHERE task_id = 'java-task-1'");
    BackendException error = assertThrows(BackendException.class, () -> readerAdapter.collect(query("1")));
    assertEquals("EASYV_FACTS_DURATION_MISSING", error.code());
  }

  @Test
  void incompleteForgeTaskFailsLoudly() {
    admin.update("UPDATE easyv_saas.generation_tasks SET status = 'running' WHERE task_id = 'forge-task-1'");
    BackendException error = assertThrows(BackendException.class, () -> readerAdapter.collect(query("1")));
    assertEquals("EASYV_FACTS_INCOMPLETE", error.code());
  }

  @Test
  void partialForgeDurationIsAllowedAndCoverageIsExposed() {
    admin.update("UPDATE easyv_saas.generation_tasks SET started_at = NULL WHERE task_id = 'forge-task-1'");
    EasyVGenerationFacts.Snapshot snapshot = readerAdapter.collect(query("1"));
    assertEquals(2, snapshot.forge().terminalTaskCount());
    assertEquals(1, snapshot.forge().timedTerminalTaskCount());
    assertEquals(60000, snapshot.forge().p50DurationMillis());
    assertEquals(60000, snapshot.forge().p95DurationMillis());
  }

  @Test
  void allForgeDurationMissingFailsLoudlyInsteadOfReturningZero() {
    admin.update("UPDATE easyv_saas.generation_tasks SET started_at = NULL, finished_at = NULL WHERE app_id = 'app-1'");
    BackendException error = assertThrows(BackendException.class, () -> readerAdapter.collect(query("1")));
    assertEquals("EASYV_FACTS_DURATION_MISSING", error.code());
  }

  @Test
  void defaultRoleGateRejectsSuperuserButExplicitDevelopmentOverrideKeepsReadOnlyTransaction() {
    HikariDataSource adminDataSource = adminDataSource();
    try {
      EasyVPostgresFactAdapter strict = adapter(adminDataSource, true);
      BackendException error = assertThrows(BackendException.class, () -> strict.collect(query("1")));
      assertEquals("EASYV_READ_ONLY_ROLE_REQUIRED", error.code());

      EasyVPostgresFactAdapter developmentOverride = adapter(adminDataSource, false);
      EasyVGenerationFacts.Snapshot snapshot = developmentOverride.collect(query("1"));
      assertEquals(1, snapshot.application().applicationCount());
    } finally {
      adminDataSource.close();
    }
  }

  @Test
  void sourceWriteIsRejectedByReadOnlyTransaction() {
    DataSourceTransactionManager manager = new DataSourceTransactionManager(readerDataSource);
    manager.setEnforceReadOnly(true);
    TransactionTemplate template = new TransactionTemplate(manager);
    template.setReadOnly(true);
    assertThrows(RuntimeException.class, () -> template.execute(status -> {
      new JdbcTemplate(readerDataSource).update("UPDATE easyv_saas.ai_screen_app SET scope_type = 'USER'");
      return null;
    }));
  }

  @Test
  void snapshotObservationMayBeSlightlyAfterClientRequest() {
    EasyVGenerationFacts.Snapshot snapshot = readerAdapter.collect(
        new EasyVGenerationFacts.Query("execution-1", "1", "creator-owned", "ontology-1",
            LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 1), Instant.now().minusMillis(1)));
    assertEquals("1", snapshot.application().window().userId());
    assertTrue(snapshot.application().window().freshnessAt().isAfter(Instant.EPOCH));
  }

  @Test
  void legalCreatorWithEmptyDateWindowGetsExplicitEmptyCode() {
    BackendException error = assertThrows(BackendException.class,
        () -> readerAdapter.collect(query("1", LocalDate.of(2025, 1, 1), LocalDate.of(2025, 1, 1))));
    assertEquals("EASYV_FACTS_EMPTY", error.code());
  }

  @Test
  void unknownExecuteResultIsRejectedWithoutInventingFailureMeaning() {
    admin.update("INSERT INTO easyv_saas.dt_ai_operation_log(user_id, app_id, operate_time, execute_result, rating, is_save_as_edit) VALUES (1,'app-1',TIMESTAMPTZ '2026-08-01 00:09:00+08',2,4,false)");
    try {
      BackendException error = assertThrows(BackendException.class, () -> readerAdapter.collect(query("1")));
      assertEquals("EASYV_FACTS_INCOMPLETE", error.code());
    } finally {
      admin.update("DELETE FROM easyv_saas.dt_ai_operation_log WHERE user_id = 1 AND app_id = 'app-1' AND execute_result = 2");
    }
  }

  @Test
  void orphanFeedbackIsRejectedInsteadOfEscapingCreatorCohort() {
    admin.update("INSERT INTO easyv_saas.dt_ai_operation_log(user_id, app_id, operate_time, execute_result, rating, is_save_as_edit) VALUES (1,'missing-app',TIMESTAMPTZ '2026-08-01 00:09:00+08',1,4,false)");
    try {
      BackendException error = assertThrows(BackendException.class, () -> readerAdapter.collect(query("1")));
      assertEquals("EASYV_FACTS_INCOMPLETE", error.code());
    } finally {
      admin.update("DELETE FROM easyv_saas.dt_ai_operation_log WHERE user_id = 1 AND app_id = 'missing-app'");
    }
  }

  @Test
  void pipelineSuccessFailureConflictIsExplicitlyRejected() {
    admin.update("INSERT INTO easyv_saas.ai_pipeline_node_record(task_id, step_name, branch, status, duration_ms, create_time) VALUES ('java-task-1','FailureAfterSuccess','MAIN','FAILED',50,TIMESTAMP '2026-08-01 00:03:00')");
    try {
      BackendException error = assertThrows(BackendException.class, () -> readerAdapter.collect(query("1")));
      assertEquals("EASYV_FACTS_TASK_CONFLICT", error.code());
    } finally {
      admin.update("DELETE FROM easyv_saas.ai_pipeline_node_record WHERE task_id = 'java-task-1' AND step_name = 'FailureAfterSuccess'");
    }
  }

  @Test
  void futureEventInSelectedCohortIsRejectedWithFutureDataCode() {
    admin.update("INSERT INTO easyv_saas.ai_screen_app VALUES ('future-app', 'future-java-task', 1, 'USER', TIMESTAMP '2999-01-01 00:01:00')");
    try {
      BackendException error = assertThrows(BackendException.class,
          () -> readerAdapter.collect(query("1", LocalDate.of(2999, 1, 1), LocalDate.of(2999, 1, 1))));
      assertEquals("EASYV_FACTS_FUTURE_DATA", error.code());
    } finally {
      admin.update("DELETE FROM easyv_saas.ai_screen_app WHERE app_id = 'future-app'");
    }
  }

  @Test
  void sourceConnectionFailureFailsRoleProbeAndDoesNotReturnZerosOrPseudoSuccess() {
    DataSource unavailable = new DriverManagerDataSource(
        "jdbc:postgresql://127.0.0.1:1/unavailable", "unavailable", "unavailable");
    EasyVPostgresProperties properties = new EasyVPostgresProperties(true,
        "jdbc:postgresql://127.0.0.1:1/unavailable", "unavailable", "unavailable", "easyv_saas", 1,
        Duration.ofMillis(200), Duration.ofMillis(100), Duration.ofMillis(200), Duration.ofMillis(100),
        Duration.ofMillis(200), true);
    EasyVPostgresFactAdapter unavailableAdapter = new EasyVPostgresFactAdapter(unavailable,
        new DataSourceTransactionManager(unavailable), new EasyVReadOnlyRoleGate(unavailable, properties), properties);
    BackendException error = assertThrows(BackendException.class, () -> unavailableAdapter.collect(query("1")));
    assertEquals("EASYV_READ_ONLY_ROLE_CHECK_FAILED", error.code());
    assertTrue(error.getCause() != null, "connection probe failure must retain a diagnostic cause");
  }

  private static EasyVPostgresFactAdapter adapter(DataSource dataSource, boolean requireRole) {
    EasyVPostgresProperties properties = new EasyVPostgresProperties(true, POSTGRES.getJdbcUrl(),
        dataSource == readerDataSource ? "easyv_reader" : POSTGRES.getUsername(),
        dataSource == readerDataSource ? "reader" : POSTGRES.getPassword(), "easyv_saas", 2,
        Duration.ofSeconds(2), Duration.ofSeconds(1), Duration.ofSeconds(3), Duration.ofSeconds(1),
        Duration.ofSeconds(5), requireRole);
    DataSourceTransactionManager manager = new DataSourceTransactionManager(dataSource);
    manager.setEnforceReadOnly(true);
    return new EasyVPostgresFactAdapter(dataSource, manager,
        new EasyVReadOnlyRoleGate(dataSource, properties), properties);
  }

  private static HikariDataSource readerDataSource() {
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(POSTGRES.getJdbcUrl());
    config.setUsername("easyv_reader");
    config.setPassword("reader");
    config.setMaximumPoolSize(2);
    config.setMinimumIdle(0);
    config.setReadOnly(true);
    config.setConnectionInitSql("SET TIME ZONE 'Asia/Shanghai'; SET default_transaction_read_only = on");
    return new HikariDataSource(config);
  }

  private static HikariDataSource adminDataSource() {
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(POSTGRES.getJdbcUrl());
    config.setUsername(POSTGRES.getUsername());
    config.setPassword(POSTGRES.getPassword());
    config.setMaximumPoolSize(2);
    config.setMinimumIdle(0);
    config.setConnectionInitSql("SET TIME ZONE 'Asia/Shanghai'; SET default_transaction_read_only = on");
    return new HikariDataSource(config);
  }

  private static EasyVGenerationFacts.Query query(String userId) {
    return query(userId, LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 1));
  }

  private static EasyVGenerationFacts.Query query(String userId, LocalDate from, LocalDate to) {
    return new EasyVGenerationFacts.Query("execution-1", userId, "creator-owned", "ontology-1",
        from, to, Instant.now().plusSeconds(30));
  }

  private static void insertFixture() {
    admin.update("INSERT INTO easyv_saas.ai_screen_app VALUES ('app-1', 'java-task-1', 1, 'USER', TIMESTAMP '2026-08-01 00:01:00'), ('app-2', 'java-task-2', 2, 'TEAM', TIMESTAMP '2026-08-01 00:01:00')");
    admin.update("INSERT INTO easyv_saas.ai_screen_prototype VALUES ('app-1'), ('app-2')");
    admin.update("INSERT INTO easyv_saas.ai_pipeline_node_record(task_id, step_name, branch, status, duration_ms, create_time) VALUES ('java-task-1','PipelineCompleted','MAIN','SUCCESS',100,TIMESTAMP '2026-08-01 00:02:00'), ('java-task-1','Step1','MAIN','SUCCESS',100,TIMESTAMP '2026-08-01 00:02:00'), ('java-task-2','PipelineCompleted','MAIN','SUCCESS',900,TIMESTAMP '2026-08-01 00:02:00')");
    admin.update("INSERT INTO easyv_saas.generation_tasks VALUES ('forge-task-1','app-1','completed','{\"reason\":\"none\"}',TIMESTAMP '2026-08-01 00:05:00',TIMESTAMP '2026-08-01 00:06:00',TIMESTAMP '2026-08-01 00:04:00'), ('forge-failed-1','app-1','failed','{\"reason\":\"broken\"}',TIMESTAMP '2026-08-01 00:05:00',TIMESTAMP '2026-08-01 00:06:00',TIMESTAMP '2026-08-01 00:04:00'), ('forge-task-2','app-2','completed','{\"reason\":\"other\"}',TIMESTAMP '2026-08-01 00:05:00',TIMESTAMP '2026-08-01 00:06:00',TIMESTAMP '2026-08-01 00:04:00')");
    admin.update("INSERT INTO easyv_saas.dt_ai_operation_log(user_id, app_id, operate_time, execute_result, rating, is_save_as_edit) VALUES (1,'app-1',TIMESTAMPTZ '2026-08-01 00:07:00+08',1,5,true), (1,'app-1',TIMESTAMPTZ '2026-08-01 00:08:00+08',0,3,false), (2,'app-2',TIMESTAMPTZ '2026-08-01 00:07:00+08',1,1,true)");
  }
}
