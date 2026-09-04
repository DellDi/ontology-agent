package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import com.dip3.ontologyagent.config.EasyVPostgresProperties;
import com.dip3.ontologyagent.easyv.internal.application.EasyVGenerationFacts;
import com.dip3.ontologyagent.support.BackendException;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Creator-scoped EasyV facts read directly from EasyV PostgreSQL.
 *
 * <p>The SQL is deliberately aggregate-only and keeps the source tables behind this adapter. No
 * input, output, metadata, failure text, or other PII crosses this boundary.
 */
public final class EasyVPostgresFactAdapter implements EasyVGenerationFacts {
  public static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
  public static final String ACCESS_MODE = "creator-owned";
  /** Stable source-time semantics for consumers that need to label aggregate evidence. */
  public static final Map<String, String> TIME_SEMANTICS = Map.of(
      "application", "cohort=ai_screen_app.create_time",
      "pipeline", "cohort=ai_screen_app.create_time;event=ai_pipeline_node_record.create_time",
      "forge", "cohort=ai_screen_app.create_time;event=generation_tasks.create_time",
      "feedback", "cohort=ai_screen_app.create_time;event=dt_ai_operation_log.operate_time");
  private static final String USER_ID_PATTERN = "[1-9][0-9]*";

  private final JdbcTemplate jdbc;
  private final TransactionTemplate readOnlyTransaction;
  private final EasyVReadOnlyRoleGate roleGate;
  private final EasyVPostgresProperties properties;
  private final String app;
  private final String prototype;
  private final String node;
  private final String forgeTask;
  private final String feedback;

  public EasyVPostgresFactAdapter(
      DataSource dataSource,
      PlatformTransactionManager transactionManager,
      EasyVReadOnlyRoleGate roleGate,
      EasyVPostgresProperties properties) {
    this.jdbc = new JdbcTemplate(dataSource);
    this.readOnlyTransaction = new TransactionTemplate(transactionManager);
    this.readOnlyTransaction.setReadOnly(true);
    this.readOnlyTransaction.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    this.roleGate = roleGate;
    this.properties = properties;
    this.app = table("ai_screen_app");
    this.prototype = table("ai_screen_prototype");
    this.node = table("ai_pipeline_node_record");
    this.forgeTask = table("generation_tasks");
    this.feedback = table("dt_ai_operation_log");
  }

  @Override
  public Snapshot collect(Query query) {
    validateQuery(query);
    roleGate.ensureChecked();
    try {
      Snapshot result = readOnlyTransaction.execute(status -> collectReadOnly(query));
      if (result == null) {
        throw new BackendException("EASYV_FACTS_EMPTY", "EasyV PostgreSQL 未返回分析事实。");
      }
      return result;
    } catch (BackendException error) {
      throw error;
    } catch (RuntimeException error) {
      throw new BackendException("EASYV_FACTS_READ_FAILED", "EasyV PostgreSQL 只读事实读取失败（"
          + error.getClass().getSimpleName() + "）。", error);
    }
  }

  private Snapshot collectReadOnly(Query query) {
    boolean readOnly = jdbc.queryForObject(
        "SELECT current_setting('transaction_read_only') = 'on'", Boolean.class);
    if (!Boolean.TRUE.equals(readOnly)) {
      throw new BackendException(
          "EASYV_READ_ONLY_TRANSACTION_REQUIRED", "EasyV 事实读取未处于 PostgreSQL READ ONLY 事务。");
    }
    Instant observedAt = observedAt();
    Bounds bounds = Bounds.of(query);
    assertNoFutureSourceRows(query, bounds, observedAt);
    assertNoOrphanFeedback(query, bounds);
    ApplicationFacts application = applicationFacts(query, bounds, observedAt);
    if (application.applicationCount() == 0) {
      throw new BackendException("EASYV_FACTS_EMPTY", "EasyV 授权范围内没有应用 cohort。");
    }
    PipelineFacts pipeline = pipelineFacts(query, bounds, observedAt);
    ForgeFacts forge = forgeFacts(query, bounds, observedAt);
    FeedbackFacts feedback = feedbackFacts(query, bounds, observedAt);
    if (application.applicationCount() == 0 || pipeline.taskCount() == 0
        || forge.taskCount() == 0 || feedback.operationCount() == 0) {
      throw new BackendException("EASYV_FACTS_EMPTY", "EasyV 授权范围内缺少可分析的四类聚合事实。");
    }
    return new Snapshot(application, pipeline, forge, feedback);
  }

  private ApplicationFacts applicationFacts(Query query, Bounds bounds, Instant observedAt) {
    Map<String, Object> row = jdbc.queryForMap(
        "SELECT COUNT(DISTINCT a.app_id) AS application_count, "
            + "COUNT(DISTINCT p.app_id) AS prototype_count "
            + "FROM " + app + " a LEFT JOIN " + prototype + " p ON p.app_id = a.app_id "
            + "WHERE a.user_id = ? AND a.create_time >= ? AND a.create_time < ?",
        dbUserId(query), bounds.fromLocal(), bounds.toLocal());
    return new ApplicationFacts(window(query, observedAt),
        number(row, "application_count"), number(row, "prototype_count"));
  }

  private PipelineFacts pipelineFacts(Query query, Bounds bounds, Instant observedAt) {
    Map<String, Object> counts = jdbc.queryForMap(
        "WITH task_ids AS (SELECT DISTINCT a.generation_task_id AS task_id FROM " + app + " a "
            + "WHERE a.user_id = ? AND a.create_time >= ? AND a.create_time < ? "
            + "AND a.generation_task_id IS NOT NULL), summary AS ("
            + "SELECT t.task_id, "
            + "BOOL_OR(UPPER(n.branch) = 'MAIN' AND UPPER(n.step_name) = 'PIPELINECOMPLETED' "
            + "AND UPPER(n.status) = 'SUCCESS') AS completed, "
            + "BOOL_OR(UPPER(n.branch) = 'MAIN' AND UPPER(n.status) = 'FAILED') AS failed "
            + "FROM task_ids t LEFT JOIN " + node + " n ON n.task_id = t.task_id "
            + "AND n.create_time >= ? AND n.create_time < ? GROUP BY t.task_id) "
            + "SELECT COUNT(*) AS task_count, COUNT(*) FILTER (WHERE completed AND NOT failed) AS completed_count, "
            + "COUNT(*) FILTER (WHERE failed AND NOT completed) AS failed_count, "
            + "COUNT(*) FILTER (WHERE NOT completed AND NOT failed) AS incomplete_count, "
            + "COUNT(*) FILTER (WHERE completed AND failed) AS conflict_count FROM summary",
        dbUserId(query), bounds.fromLocal(), bounds.toLocal(), bounds.fromLocal(), bounds.toLocal());
    if (number(counts, "conflict_count") > 0) {
      throw new BackendException("EASYV_FACTS_TASK_CONFLICT", "EasyV 原型任务同时出现成功和失败终态，无法确定归并结果。");
    }
    if (number(counts, "task_count") == 0) {
      throw new BackendException("EASYV_FACTS_EMPTY", "EasyV 授权范围内没有原型流水线任务事实。");
    }
    Map<String, Object> coverage = jdbc.queryForMap(
        "WITH scoped AS (SELECT DISTINCT a.generation_task_id FROM " + app + " a "
            + "WHERE a.user_id = ? AND a.create_time >= ? AND a.create_time < ? "
            + "AND a.generation_task_id IS NOT NULL) SELECT "
            + "COUNT(*) FILTER (WHERE UPPER(n.branch) = 'MAIN') AS main_node_count, "
            + "COUNT(*) FILTER (WHERE UPPER(n.branch) = 'MAIN' AND n.duration_ms IS NOT NULL) AS timed_node_count "
            + "FROM scoped s JOIN " + node + " n ON n.task_id = s.generation_task_id "
            + "WHERE n.create_time >= ? AND n.create_time < ?",
        dbUserId(query), bounds.fromLocal(), bounds.toLocal(), bounds.fromLocal(), bounds.toLocal());
    long mainNodeCount = number(coverage, "main_node_count");
    long timedNodeCount = number(coverage, "timed_node_count");
    if (timedNodeCount == 0) {
      throw new BackendException("EASYV_FACTS_DURATION_MISSING", "EasyV 原型阶段没有可计算耗时的主链节点记录。");
    }
    Map<String, Object> bottleneck = jdbc.queryForList(
        "SELECT n.step_name, CEIL(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY n.duration_ms))::BIGINT AS p95 "
            + "FROM " + app + " a JOIN " + node + " n ON n.task_id = a.generation_task_id "
            + "WHERE a.user_id = ? AND a.create_time >= ? AND a.create_time < ? "
            + "AND n.create_time >= ? AND n.create_time < ? AND UPPER(n.branch) = 'MAIN' "
            + "AND n.duration_ms IS NOT NULL GROUP BY n.step_name ORDER BY p95 DESC, n.step_name ASC LIMIT 1",
        dbUserId(query), bounds.fromLocal(), bounds.toLocal(), bounds.fromLocal(), bounds.toLocal())
        .stream().findFirst().orElseThrow(() ->
            new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV 原型阶段缺少可计算耗时的主链节点记录。"));
    String step = String.valueOf(bottleneck.get("step_name"));
    if (step.isBlank() || "null".equals(step)) {
      throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV 原型阶段未返回稳定阶段名称。");
    }
    return new PipelineFacts(window(query, observedAt), number(counts, "task_count"),
        number(counts, "completed_count"), number(counts, "failed_count"),
        number(counts, "incomplete_count"), mainNodeCount, timedNodeCount, step, number(bottleneck, "p95"));
  }

  private ForgeFacts forgeFacts(Query query, Bounds bounds, Instant observedAt) {
    Map<String, Object> counts = jdbc.queryForMap(
        "WITH scoped AS (SELECT DISTINCT a.app_id FROM " + app + " a "
            + "WHERE a.user_id = ? AND a.create_time >= ? AND a.create_time < ?) "
            + "SELECT COUNT(DISTINCT g.task_id) AS task_count, "
            + "COUNT(DISTINCT g.task_id) FILTER (WHERE LOWER(g.status::text) = 'completed') AS completed_count, "
            + "COUNT(DISTINCT g.task_id) FILTER (WHERE LOWER(g.status::text) = 'failed') AS failed_count, "
            + "COUNT(DISTINCT g.task_id) FILTER (WHERE LOWER(g.status::text) = 'cancelled') AS cancelled_count, "
            + "COUNT(DISTINCT g.task_id) FILTER (WHERE LOWER(g.status::text) IN ('completed','failed','cancelled')) AS terminal_task_count, "
            + "COUNT(DISTINCT g.task_id) FILTER (WHERE LOWER(g.status::text) NOT IN ('completed','failed','cancelled')) AS incomplete_count "
            + "FROM scoped s JOIN " + forgeTask + " g ON g.app_id = s.app_id "
            + "WHERE g.create_time >= ? AND g.create_time < ?",
        dbUserId(query), bounds.fromLocal(), bounds.toLocal(), bounds.fromLocal(), bounds.toLocal());
    if (number(counts, "incomplete_count") > 0) {
      throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV Forge 存在未终态或未知状态任务。");
    }
    if (number(counts, "task_count") == 0) {
      throw new BackendException("EASYV_FACTS_EMPTY", "EasyV 授权范围内没有 Forge 任务事实。");
    }
    Map<String, Object> durationCoverage = jdbc.queryForMap(
        "WITH scoped AS (SELECT DISTINCT a.app_id FROM " + app + " a WHERE a.user_id = ? "
            + "AND a.create_time >= ? AND a.create_time < ?) SELECT "
            + "COUNT(DISTINCT g.task_id) FILTER (WHERE LOWER(g.status::text) IN ('completed','failed','cancelled')) AS terminal_task_count, "
            + "COUNT(DISTINCT g.task_id) FILTER (WHERE LOWER(g.status::text) IN ('completed','failed','cancelled') "
            + "AND g.started_at IS NOT NULL AND g.finished_at IS NOT NULL) AS timed_terminal_task_count "
            + "FROM " + forgeTask + " g JOIN scoped s ON s.app_id = g.app_id "
            + "WHERE g.create_time >= ? AND g.create_time < ?",
        dbUserId(query), bounds.fromLocal(), bounds.toLocal(), bounds.fromLocal(), bounds.toLocal());
    long timedTerminalTaskCount = number(durationCoverage, "timed_terminal_task_count");
    if (timedTerminalTaskCount == 0) {
      throw new BackendException("EASYV_FACTS_DURATION_MISSING", "EasyV Forge 没有可计算耗时的终态任务记录。");
    }
    Map<String, Object> duration = jdbc.queryForMap(
        "WITH scoped AS (SELECT DISTINCT a.app_id FROM " + app + " a WHERE a.user_id = ? "
            + "AND a.create_time >= ? AND a.create_time < ?) SELECT "
            + "CEIL(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (g.finished_at - g.started_at)) * 1000))::BIGINT AS p50, "
            + "CEIL(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (g.finished_at - g.started_at)) * 1000))::BIGINT AS p95 "
            + "FROM " + forgeTask + " g JOIN scoped s ON s.app_id = g.app_id "
            + "WHERE g.create_time >= ? AND g.create_time < ? AND LOWER(g.status::text) IN ('completed','failed','cancelled') "
            + "AND g.started_at IS NOT NULL AND g.finished_at IS NOT NULL",
        dbUserId(query), bounds.fromLocal(), bounds.toLocal(), bounds.fromLocal(), bounds.toLocal());
    Map<String, Long> failureReasons = new LinkedHashMap<>();
    jdbc.query("WITH scoped AS (SELECT DISTINCT a.app_id FROM " + app + " a WHERE a.user_id = ? "
            + "AND a.create_time >= ? AND a.create_time < ?) SELECT md5(COALESCE(g.failure_reason::text, '')) AS bucket, COUNT(*) AS count "
            + "FROM " + forgeTask + " g JOIN scoped s ON s.app_id = g.app_id WHERE g.create_time >= ? AND g.create_time < ? "
            + "AND LOWER(g.status::text) = 'failed' GROUP BY bucket ORDER BY bucket", result -> {
      failureReasons.put("md5:" + result.getString("bucket"), result.getLong("count"));
    }, dbUserId(query), bounds.fromLocal(), bounds.toLocal(), bounds.fromLocal(), bounds.toLocal());
    return new ForgeFacts(window(query, observedAt), number(counts, "task_count"),
        number(counts, "completed_count"), number(counts, "failed_count"),
        number(counts, "cancelled_count"), number(counts, "terminal_task_count"), timedTerminalTaskCount,
        number(duration, "p50"), number(duration, "p95"), failureReasons);
  }

  private FeedbackFacts feedbackFacts(Query query, Bounds bounds, Instant observedAt) {
    Map<String, Object> values = jdbc.queryForMap(
        "SELECT COUNT(*) AS operation_count, COUNT(*) FILTER (WHERE l.rating BETWEEN 1 AND 5) AS rated_count, "
            + "AVG(l.rating) FILTER (WHERE l.rating BETWEEN 1 AND 5) AS average_rating, "
            + "COUNT(*) FILTER (WHERE l.is_save_as_edit IS TRUE) AS save_as_edit_count, "
            + "COUNT(*) FILTER (WHERE l.execute_result = 1) AS combined_success_count, "
            + "COUNT(*) FILTER (WHERE l.execute_result = 0) AS combined_failure_count, "
            + "COUNT(*) FILTER (WHERE l.execute_result NOT IN (0,1)) AS unknown_result_count "
            + "FROM " + feedback + " l JOIN " + app + " a ON a.app_id = l.app_id "
            + "WHERE a.user_id = ? AND l.user_id = ? AND a.create_time >= ? AND a.create_time < ? "
            + "AND l.operate_time >= ? AND l.operate_time < ?",
        dbUserId(query), dbUserId(query), bounds.fromLocal(), bounds.toLocal(),
        Timestamp.from(bounds.fromInstant()), Timestamp.from(bounds.toInstant()));
    if (number(values, "unknown_result_count") > 0) {
      throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV 操作日志存在未知 execute_result 值。");
    }
    if (number(values, "operation_count") == 0) {
      throw new BackendException("EASYV_FACTS_EMPTY", "EasyV 授权范围内没有操作与反馈事实。");
    }
    if (number(values, "rated_count") == 0) {
      throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV 操作日志没有有效评分，不能把平均评分默认为 0。");
    }
    Object average = values.get("average_rating");
    return new FeedbackFacts(window(query, observedAt), number(values, "operation_count"),
        number(values, "rated_count"), average instanceof Number n ? n.doubleValue() : Double.NaN,
        number(values, "save_as_edit_count"), number(values, "combined_success_count"),
        number(values, "combined_failure_count"));
  }

  private void assertNoFutureSourceRows(Query query, Bounds bounds, Instant observedAt) {
    LocalDateTime observedLocal = observedAt.atZone(BUSINESS_ZONE).toLocalDateTime();
    long futureApp = jdbc.queryForObject("SELECT COUNT(*) FROM " + app
        + " WHERE user_id = ? AND create_time >= ? AND create_time < ? AND create_time > ?",
        Long.class, dbUserId(query), bounds.fromLocal(), bounds.toLocal(), observedLocal);
    long futureNode = jdbc.queryForObject("SELECT COUNT(*) FROM " + app + " a JOIN " + node
        + " n ON n.task_id = a.generation_task_id WHERE a.user_id = ? AND a.create_time >= ? AND a.create_time < ?"
        + " AND n.create_time >= ? AND n.create_time < ? AND n.create_time > ?",
        Long.class, dbUserId(query), bounds.fromLocal(), bounds.toLocal(), bounds.fromLocal(),
        bounds.toLocal(), observedLocal);
    long futureForge = jdbc.queryForObject("SELECT COUNT(*) FROM " + app + " a JOIN " + forgeTask
        + " g ON g.app_id = a.app_id WHERE a.user_id = ? AND a.create_time >= ? AND a.create_time < ?"
        + " AND g.create_time >= ? AND g.create_time < ? AND (g.create_time > ? OR g.started_at > ? OR g.finished_at > ?)",
        Long.class, dbUserId(query), bounds.fromLocal(), bounds.toLocal(), bounds.fromLocal(),
        bounds.toLocal(), observedLocal, observedLocal, observedLocal);
    long futureFeedback = jdbc.queryForObject("SELECT COUNT(*) FROM " + feedback
        + " l JOIN " + app + " a ON a.app_id = l.app_id WHERE l.user_id = ? AND a.user_id = ?"
        + " AND a.create_time >= ? AND a.create_time < ? AND l.operate_time >= ? AND l.operate_time < ?"
        + " AND l.operate_time > ?", Long.class, dbUserId(query), dbUserId(query), bounds.fromLocal(),
        bounds.toLocal(), Timestamp.from(bounds.fromInstant()), Timestamp.from(bounds.toInstant()),
        Timestamp.from(observedAt));
    if (futureApp + futureNode + futureForge + futureFeedback > 0) {
      throw new BackendException("EASYV_FACTS_FUTURE_DATA", "EasyV 源数据包含晚于快照观测时间的事件。");
    }
  }

  private void assertNoOrphanFeedback(Query query, Bounds bounds) {
    long orphaned = jdbc.queryForObject("SELECT COUNT(*) FROM " + feedback + " l "
        + "LEFT JOIN " + app + " a ON a.app_id = l.app_id AND a.user_id = ? "
        + "AND a.create_time >= ? AND a.create_time < ? "
        + "WHERE l.user_id = ? AND l.operate_time >= ? AND l.operate_time < ? AND a.app_id IS NULL",
        Long.class, dbUserId(query), bounds.fromLocal(), bounds.toLocal(), dbUserId(query),
        Timestamp.from(bounds.fromInstant()), Timestamp.from(bounds.toInstant()));
    if (orphaned > 0) {
      throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV 操作日志存在无法按应用 cohort 归属的记录。");
    }
  }

  private Instant observedAt() {
    BigDecimal epochSeconds = jdbc.queryForObject(
        "SELECT EXTRACT(EPOCH FROM clock_timestamp())", BigDecimal.class);
    if (epochSeconds == null) {
      throw new BackendException("EASYV_FACTS_FRESHNESS_INVALID", "EasyV PostgreSQL 未返回只读快照观测时间。");
    }
    return Instant.ofEpochMilli(epochSeconds.movePointRight(3).longValue());
  }

  private FactWindow window(Query query, Instant observedAt) {
    return new FactWindow(userId(query), ACCESS_MODE, query.from(), query.to(), observedAt);
  }

  private static void validateQuery(Query query) {
    if (query == null || query.userId() == null || !query.userId().matches(USER_ID_PATTERN)
        || !ACCESS_MODE.equals(query.accessMode()) || query.from() == null || query.to() == null
        || query.from().isAfter(query.to()) || query.requestedAt() == null) {
      throw new BackendException("EASYV_FACTS_QUERY_INVALID", "EasyV 事实查询必须使用可信数字用户 ID 和有效时间窗口。");
    }
  }

  private static String userId(Query query) {
    return query.userId();
  }

  private static long dbUserId(Query query) {
    return Long.parseLong(query.userId());
  }

  private String table(String name) {
    return properties.schema() + "." + name;
  }

  private static long number(Map<String, Object> row, String key) {
    Object value = row.get(key);
    return value instanceof Number number ? number.longValue() : 0L;
  }

  private record Bounds(LocalDateTime fromLocal, LocalDateTime toLocal,
                        Instant fromInstant, Instant toInstant) {
    static Bounds of(Query query) {
      LocalDateTime from = query.from().atStartOfDay();
      LocalDateTime to = query.to().plusDays(1).atStartOfDay();
      return new Bounds(from, to, from.atZone(BUSINESS_ZONE).toInstant(), to.atZone(BUSINESS_ZONE).toInstant());
    }
  }
}
