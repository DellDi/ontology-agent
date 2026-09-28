package com.dip3.ontologyagent.semantic.internal.adapter.out.cube;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery;
import com.dip3.ontologyagent.semantic.api.QueryIntent;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Direction;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Filter;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Granularity;
import com.dip3.ontologyagent.semantic.api.QueryIntent.Operator;
import com.dip3.ontologyagent.semantic.api.QueryIntent.TimeSpec;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.AccessContext;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.DataCoverage;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.Scope;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.SemanticQueryResult;
import com.dip3.ontologyagent.semantic.api.TimeExpression;
import com.dip3.ontologyagent.semantic.api.TimeExpression.Kind;
import com.dip3.ontologyagent.semantic.api.TimeExpression.Unit;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.BindMode;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.Network;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * 真实 Cube + PostgreSQL：入库生成的 Cube 模型与 cube.js 访问策略对冻结 facts 执行本体查询意图，
 * 验证成员资格（已删除应用及其子对象排除）、授权范围、版本强制与覆盖区间。
 */
@Testcontainers(disabledWithoutDocker = true)
class CubeSemanticQueryAdapterTest {
  private static final String SECRET = "cube-semantic-test-secret";
  private static final Instant ANCHOR = Instant.parse("2026-08-05T02:00:00Z");
  private static final Timestamp APP_TIME = Timestamp.from(Instant.parse("2026-08-01T01:00:00Z"));
  private static final Timestamp NODE_TIME = Timestamp.from(Instant.parse("2026-08-01T01:30:00Z"));
  private static final Timestamp FORGE_START = Timestamp.from(Instant.parse("2026-08-01T01:30:00Z"));
  private static final Timestamp FORGE_END = Timestamp.from(Instant.parse("2026-08-01T01:31:00Z"));
  private static final Timestamp FORGE_CREATED = Timestamp.from(Instant.parse("2026-08-01T01:40:00Z"));
  private static final Timestamp FEEDBACK_TIME = Timestamp.from(Instant.parse("2026-08-03T02:00:00Z"));
  private static final Map<String, String> VERSIONS = Map.of(
      "easyv-ai-application", "pv-app",
      "easyv-prototype-task", "pv-prototype",
      "easyv-pipeline-node", "pv-pipeline",
      "easyv-forge-task", "pv-forge",
      "easyv-generation-feedback", "pv-feedback");
  private static final Network NETWORK = Network.newNetwork();

  @Container
  static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine")
      .withNetwork(NETWORK).withNetworkAliases("postgres");

  @Container
  static final GenericContainer<?> CUBE = new GenericContainer<>("cubejs/cube:v1.6.31")
      .withNetwork(NETWORK)
      .dependsOn(POSTGRES)
      .withEnv("CUBEJS_DB_TYPE", "postgres")
      .withEnv("CUBEJS_DB_HOST", "postgres")
      .withEnv("CUBEJS_DB_PORT", "5432")
      .withEnv("CUBEJS_DB_NAME", "test")
      .withEnv("CUBEJS_DB_USER", "test")
      .withEnv("CUBEJS_DB_PASS", "test")
      .withEnv("CUBEJS_API_SECRET", SECRET)
      .withEnv("CUBEJS_DEV_MODE", "false")
      .withEnv("CUBEJS_TELEMETRY", "false")
      .withEnv("CUBEJS_CACHE_AND_QUEUE_DRIVER", "memory")
      .withFileSystemBind(Path.of("..", "cube", "conf").toAbsolutePath().normalize().toString(),
          "/cube/conf", BindMode.READ_ONLY)
      .withExposedPorts(4000)
      .waitingFor(Wait.forHttp("/readyz").forPort(4000).forStatusCode(200))
      .withStartupTimeout(Duration.ofMinutes(3));

  private static CubeSemanticQueryAdapter adapter;
  private static SemanticQueryCompiler compiler;
  private static JdbcTemplate jdbc;

  @BeforeAll
  static void seed() {
    MigrationTestSupport.migrate(POSTGRES);
    jdbc = new JdbcTemplate(new DriverManagerDataSource(
        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    seedFacts();
    compiler = new SemanticQueryCompiler(SemanticModel.discover());
    adapter = new CubeSemanticQueryAdapter(new JsonCodec(), properties(
        "http://" + CUBE.getHost() + ":" + CUBE.getMappedPort(4000) + "/cubejs-api/v1"));
  }

  @Test
  void forgeStatusMatchesFrozenFactsAndExcludesDeletedApplications() {
    SemanticQueryResult result = run(intent("easyv-forge-task", List.of("count"), List.of("status"),
        List.of(), time(allData(), null), null, List.of(new QueryIntent.Order("count", Direction.DESC)), null), all());

    assertEquals(List.of(Map.of("status", "completed", "count", 2L), Map.of("status", "failed", "count", 1L)),
        result.rows());
    assertTrue(result.sql().contains("product_version_id"), result.sql());
  }

  @Test
  void derivedRatesPercentilesAndFailureReasonsAreGoverned() {
    SemanticQueryResult rates = run(intent("easyv-forge-task",
        List.of("successRate", "failureRate", "durationP95Ms", "terminalCount"), List.of(), List.of(),
        time(allData(), null), null, List.of(), null), all());
    assertEquals(List.of(Map.of("successRate", 66.67, "failureRate", 33.33, "durationP95Ms", 60000L,
        "terminalCount", 3L)), rates.rows());

    SemanticQueryResult reasons = run(intent("easyv-forge-task", List.of("count"), List.of("failureReason"),
        List.of(new Filter("status", Operator.EQUALS, List.of("failed"))), time(allData(), null), null, List.of(), null),
        all());
    assertEquals(1, reasons.rows().size());
    assertTrue(reasons.rows().getFirst().get("failureReason").toString().contains("Recursion limit"));
  }

  @Test
  void pipelineTaskOutcomePrototypeAndApplicationCountsFollowActiveApplications() {
    assertEquals(List.of(Map.of("count", 2L, "completedCount", 2L, "completionRate", 100L)),
        run(intent("easyv-pipeline-task", List.of("count", "completedCount", "completionRate"), List.of(), List.of(),
            time(allData(), null), null, List.of(), null), all()).rows());
    assertEquals(List.of(Map.of("count", 2L)), run(intent("easyv-prototype", List.of("count"), List.of(), List.of(),
        time(allData(), null), null, List.of(), null), all()).rows());
    assertEquals(List.of(Map.of("count", 2L, "userCount", 2L)), run(intent("easyv-ai-application",
        List.of("count", "userCount"), List.of(), List.of(), time(allData(), null), null, List.of(), null), all()).rows());
  }

  @Test
  void scopedAccessRestrictsEveryObjectToTheBoundUser() {
    Scope user1 = Scope.restricted(Map.of("userId", List.of("1")));
    assertEquals(List.of(Map.of("count", 2L)), run(intent("easyv-forge-task", List.of("count"), List.of(), List.of(),
        time(allData(), null), null, List.of(), null), user1).rows());
    assertEquals(List.of(Map.of("count", 2L)), run(intent("easyv-generation-feedback", List.of("count"), List.of(),
        List.of(), time(allData(), null), null, List.of(), null), user1).rows());
    assertEquals(List.of(Map.of("count", 1L)), run(intent("easyv-ai-application", List.of("count"), List.of(),
        List.of(), time(allData(), null), null, List.of(), null), user1).rows());
  }

  @Test
  void relativeTimeGranularityLinkedTimeAndCompareRangesExecute() {
    SemanticQueryResult daily = run(intent("easyv-generation-feedback", List.of("count"), List.of(), List.of(),
        time(lastDays(7), Granularity.DAY), null, List.of(new QueryIntent.Order("time", Direction.ASC)), null), all());
    assertEquals(List.of(Map.of("time", "2026-08-03", "count", 3L)), daily.rows());

    SemanticQueryResult byCreation = run(intent("easyv-generation-feedback", List.of("count"), List.of(), List.of(),
        new TimeSpec("application.createdAt", lastDays(7), Granularity.WEEK), null, List.of(), null), all());
    assertEquals(List.of(Map.of("time", "2026-07-27", "count", 3L)), byCreation.rows());

    TimeExpression thisWeek = new TimeExpression("本周", Kind.CALENDAR, Unit.WEEK, null, 0, null, null, null);
    TimeExpression lastWeek = new TimeExpression("上周", Kind.CALENDAR, Unit.WEEK, null, -1, null, null, null);
    SemanticQueryResult compare = run(intent("easyv-generation-feedback", List.of("count"), List.of(), List.of(),
        time(thisWeek, null), lastWeek, List.of(), null), all());
    assertEquals(List.of(Map.of("count", 3L)), compare.rows());
    assertEquals(List.of(Map.of("count", 0L)), compare.compareRows());
  }

  @Test
  void coverageReportsFrozenDataBounds() {
    CompiledSemanticQuery query = compile(intent("easyv-generation-feedback", List.of("count"), List.of(), List.of(),
        time(lastDays(30), null), null, List.of(), null));
    assertEquals(new DataCoverage(LocalDate.parse("2026-08-03"), LocalDate.parse("2026-08-03")),
        adapter.coverage(query, new AccessContext(VERSIONS, Scope.everything())));
  }

  @Test
  void missingVersionsAndUnsupportedScopesFailLoudly() {
    CompiledSemanticQuery query = compile(intent("easyv-forge-task", List.of("count"), List.of(), List.of(),
        time(allData(), null), null, List.of(), null));
    BackendException missing = assertThrows(BackendException.class, () -> adapter.execute(query,
        new AccessContext(Map.of("easyv-forge-task", "pv-forge"), Scope.everything())));
    assertEquals("SEMANTIC_VERSION_REQUIRED", missing.code());

    BackendException unsupported = assertThrows(BackendException.class, () -> adapter.execute(query,
        new AccessContext(VERSIONS, Scope.restricted(Map.of("spaceId", List.of("11"))))));
    assertEquals("SEMANTIC_SCOPE_UNSUPPORTED", unsupported.code());
  }

  private static SemanticQueryResult run(QueryIntent intent, Scope scope) {
    return adapter.execute(compile(intent), new AccessContext(VERSIONS, scope));
  }

  private static CompiledSemanticQuery compile(QueryIntent intent) {
    return compiler.compile(intent, ANCHOR).require();
  }

  private static Scope all() {
    return Scope.everything();
  }

  private static QueryIntent intent(String object, List<String> measures, List<String> dimensions, List<Filter> filters,
                                    TimeSpec time, TimeExpression compare, List<QueryIntent.Order> order, Integer limit) {
    return new QueryIntent(object, measures, dimensions, filters, time, compare, order, limit);
  }

  private static TimeSpec time(TimeExpression expression, Granularity granularity) {
    return new TimeSpec(null, expression, granularity);
  }

  private static TimeExpression allData() {
    return new TimeExpression("全部数据", Kind.ALL, null, null, null, null, null, null);
  }

  private static TimeExpression lastDays(int n) {
    return new TimeExpression("最近" + n + "天", Kind.RELATIVE, Unit.DAY, n, null, null, null, null);
  }

  private static BackendProperties properties(String apiUrl) {
    return new BackendProperties("session-secret", "dip3",
        new BackendProperties.Cube(apiUrl, SECRET, Duration.ofSeconds(30)),
        new BackendProperties.Neo4j("bolt://127.0.0.1:1", "neo4j", "password", "neo4j"),
        new BackendProperties.Worker(false, Duration.ofSeconds(1)),
        new BackendProperties.Stream(Duration.ofMillis(10), Duration.ofSeconds(1)),
        new BackendProperties.Auth(new BackendProperties.Auth.Providers(
            new BackendProperties.Auth.Providers.Local(true),
            new BackendProperties.Auth.Providers.Bridge(false))),
        false);
  }

  private static void seedFacts() {
    Timestamp sourceAt = Timestamp.from(Instant.parse("2026-08-01T00:00:00Z"));
    jdbc.update("""
        insert into ingestion.source_ingestion_runs
          (id,source_key,mode,status,trigger_type,triggered_by,correlation_id,
           snapshot_context,row_counts,started_at,finished_at,created_at,updated_at)
        values ('source-run','easyv','full','completed','bootstrap','test','cube-test',
                '{}'::jsonb,'{}'::jsonb,?,?,?,?)
        """, sourceAt, sourceAt, sourceAt, sourceAt);
    VERSIONS.forEach((product, version) -> {
      jdbc.update("""
          insert into ingestion.source_dataset_versions
            (id,source_key,dataset_key,source_ingestion_run_id,version_number,storage_ref,source_watermark,
             committed_cursor,row_count,content_hash,schema_version,status,published_at,created_at)
          values (?,'easyv',?,'source-run',1,?,'{"snapshot":"one"}'::jsonb,'{}'::jsonb,1,?,1,'published',?,?)
          """, "source-" + product, product, "ingestion://source-dataset-version/source-" + product + "/row-pack-v1", "hash-" + product, sourceAt, sourceAt);
      jdbc.update("""
          insert into ingestion.product_materialization_runs
            (id,product_key,mode,status,trigger_type,triggered_by,correlation_id,
             input_summary,row_counts,started_at,finished_at,created_at,updated_at)
          values (?,?,'full','completed','bootstrap','test','cube-test','{}'::jsonb,'{}'::jsonb,?,?,?,?)
          """, "run-" + product, product, sourceAt, sourceAt, sourceAt, sourceAt);
      jdbc.update("""
          insert into ingestion.data_product_versions
            (id,product_key,materialization_run_id,version_number,storage_ref,row_count,content_hash,
             schema_version,status,published_at,created_at)
          values (?,?,?,1,null,1,null,1,'building',null,?)
          """, version, product, "run-" + product, sourceAt);
    });
    application(1, "app-1", "java-task-1", 1, false);
    application(2, "app-2", "java-task-2", 2, false);
    application(3, "app-deleted", "java-task-deleted", 1, true);
    for (String app : List.of("app-1", "app-2", "app-deleted")) {
      jdbc.update("""
          insert into facts.easyv_prototype_task
            (product_version_id,source_dataset_key,source_dataset_version_id,source_id,app_id,created_at,updated_at)
          values ('pv-prototype','easyv-prototype-task','source-easyv-prototype-task',?,?,?,?)
          """, (long) app.hashCode(), app, APP_TIME, APP_TIME);
    }
    node(1, "java-task-1", "PipelineCompleted", "SUCCESS", 100L);
    node(2, "java-task-1", "Step1", "SUCCESS", 100L);
    node(3, "java-task-2", "PipelineCompleted", "SUCCESS", 900L);
    node(4, "java-task-deleted", "PipelineCompleted", "SUCCESS", 900L);
    forge(1, "forge-task-1", "app-1", "completed", null);
    forge(2, "forge-task-2", "app-1", "failed", "page-1__chart_1: config agent invoke threw: Recursion limit of 25 reached");
    forge(3, "forge-task-3", "app-2", "completed", null);
    forge(4, "forge-task-deleted", "app-deleted", "completed", null);
    feedback(1, 1, "app-1", 1, 5);
    feedback(2, 1, "app-1", 0, 3);
    feedback(3, 2, "app-2", 1, 1);
    feedback(4, 1, "app-deleted", 1, 5);
    feedback(5, 1, null, 1, null);
    VERSIONS.values().forEach(version -> jdbc.update("""
        update ingestion.data_product_versions set status='published',storage_ref=?,content_hash=?,published_at=?
        where id=?
        """, "db://" + version, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", sourceAt, version));
  }

  private static void application(long id, String appId, String taskId, long userId, boolean deleted) {
    jdbc.update("""
        insert into facts.easyv_ai_application
          (product_version_id,source_dataset_key,source_dataset_version_id,source_id,app_id,generation_task_id,
           user_id,space_id,team_id,scope_type,created_at,updated_at,is_deleted)
        values ('pv-app','easyv-ai-application','source-easyv-ai-application',?,?,?,?,?,?,?,?,?,?)
        """, id, appId, taskId, userId, userId * 11, userId * 111, userId == 1 ? "USER" : "TEAM",
        APP_TIME, APP_TIME, deleted);
  }

  private static void node(long id, String taskId, String step, String status, Long duration) {
    jdbc.update("""
        insert into facts.easyv_pipeline_node
          (product_version_id,source_dataset_key,source_dataset_version_id,source_id,task_id,step_name,branch,
           status,duration_ms,created_at)
        values ('pv-pipeline','easyv-pipeline-node','source-easyv-pipeline-node',?,?,?,'MAIN',?,?,?)
        """, id, taskId, step, status, duration, NODE_TIME);
  }

  private static void forge(long id, String taskId, String appId, String status, String reason) {
    jdbc.update("""
        insert into facts.easyv_forge_generation_task
          (product_version_id,source_dataset_key,source_dataset_version_id,source_id,task_id,app_id,status,
           failure_reason_hash,failure_reason,started_at,finished_at,created_at,updated_at)
        values ('pv-forge','easyv-forge-task','source-easyv-forge-task',?,?,?,?,?,?,?,?,?,?)
        """, UUID.nameUUIDFromBytes(taskId.getBytes()), taskId, appId, status,
        "0123456789abcdef0123456789abcdef", reason, FORGE_START, FORGE_END, FORGE_CREATED, FORGE_CREATED);
  }

  private static void feedback(long id, long userId, String appId, int result, Integer rating) {
    jdbc.update("""
        insert into facts.easyv_generation_feedback
          (product_version_id,source_dataset_key,source_dataset_version_id,source_id,space_id,user_id,operated_at,
           ai_action_type,execute_result,rating,app_id,task_id,is_save_as_edit)
        values ('pv-feedback','easyv-generation-feedback','source-easyv-generation-feedback',?,?,?,?,?,?,?,?,null,false)
        """, id, userId * 11, userId, FEEDBACK_TIME, appId == null ? "promptCompletion" : "generate", result,
        rating, appId);
  }
}
