package com.dip3.ontologyagent.easyv.internal.adapter.out.writeback;

import com.dip3.ontologyagent.easyv.internal.application.EasyVWritebackContractPort;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ChartMappingCheck;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ColumnCheck;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ContractStatus;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.Diagnostic;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ItemStatus;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.RedisCheck;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.Report;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.RequiredColumn;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.RequiredTable;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.SampleCheck;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.SampleResult;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.SchemaCheck;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.TableCheck;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.lettuce.core.api.sync.RedisCommands;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * EasyV 写回上游契约只读探针适配器。
 *
 * <p>严格复用独立写回连接，在 {@code READ ONLY REPEATABLE READ} 事务中执行元数据与
 * {@code LIMIT 3} 抽样检查，并对源 Redis 仅执行只读 {@code PING}；绝不执行任何写入或键删除。
 */
public final class EasyVWritebackContractProbe implements EasyVWritebackContractPort {
  private static final Logger log = LoggerFactory.getLogger(EasyVWritebackContractProbe.class);
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Pattern URI_CREDENTIALS = Pattern.compile("([a-zA-Z][a-zA-Z0-9+.-]*://)[^/@\\s]+@");
  private static final Pattern KEY_VALUE_SECRET = Pattern.compile("(?i)(password|passwd|pwd|secret|token)=([^\\s&,;]+)");

  private final boolean enabled;
  private final JdbcTemplate jdbc;
  private final Supplier<RedisCommands<String, String>> redisSupplier;
  private final String schema;
  private final String quotedSchema;
  private final String disabledReason;
  private final Clock clock;

  public EasyVWritebackContractProbe(
      JdbcTemplate jdbc,
      RedisCommands<String, String> redis,
      String schema) {
    this(jdbc, () -> Objects.requireNonNull(redis, "redis must not be null"), schema, Clock.systemUTC());
  }

  public EasyVWritebackContractProbe(
      JdbcTemplate jdbc,
      Supplier<RedisCommands<String, String>> redisSupplier,
      String schema) {
    this(jdbc, redisSupplier, schema, Clock.systemUTC());
  }

  EasyVWritebackContractProbe(
      JdbcTemplate jdbc,
      Supplier<RedisCommands<String, String>> redisSupplier,
      String schema,
      Clock clock) {
    this(true,
        Objects.requireNonNull(jdbc, "jdbc must not be null"),
        Objects.requireNonNull(redisSupplier, "redisSupplier must not be null"),
        validateSchema(schema),
        null,
        Objects.requireNonNull(clock, "clock must not be null"));
  }

  private EasyVWritebackContractProbe(
      boolean enabled,
      JdbcTemplate jdbc,
      Supplier<RedisCommands<String, String>> redisSupplier,
      String schema,
      String disabledReason,
      Clock clock) {
    this.enabled = enabled;
    this.jdbc = jdbc;
    this.redisSupplier = redisSupplier;
    this.schema = schema;
    this.quotedSchema = "\"" + schema + "\".";
    this.disabledReason = disabledReason;
    this.clock = clock;
  }

  public static EasyVWritebackContractProbe disabled(String schema, String reason) {
    return disabled(schema, reason, Clock.systemUTC());
  }

  static EasyVWritebackContractProbe disabled(String schema, String reason, Clock clock) {
    return new EasyVWritebackContractProbe(false, null, null, validateSchema(schema), reason,
        Objects.requireNonNull(clock, "clock must not be null"));
  }

  @Override
  public Report check() {
    Instant checkedAt = clock.instant();
    if (!enabled) {
      return EasyVWritebackContract.disabledReport(schema, disabledReason, checkedAt);
    }

    List<Diagnostic> diagnostics = new ArrayList<>();
    DatabaseProbeResult dbResult = probeDatabase(diagnostics);
    RedisCheck redisCheck = probeRedis(diagnostics);

    ContractStatus overall = resolveOverallStatus(
        dbResult.schemaCheck(), dbResult.sampleCheck(), dbResult.chartMappingCheck(), redisCheck);
    String summary = summarize(overall, dbResult.schemaCheck(), dbResult.sampleCheck(),
        dbResult.chartMappingCheck(), redisCheck);

    return new Report(
        overall,
        true,
        schema,
        checkedAt,
        summary,
        null,
        dbResult.schemaCheck(),
        dbResult.sampleCheck(),
        dbResult.chartMappingCheck(),
        redisCheck,
        EasyVWritebackContract.buildChecklist(
            dbResult.schemaCheck(), dbResult.sampleCheck(), dbResult.chartMappingCheck(), redisCheck),
        diagnostics);
  }

  private DatabaseProbeResult probeDatabase(List<Diagnostic> diagnostics) {
    try {
      return executeReadOnly(() -> {
        SchemaCheck schemaCheck = checkSchema(diagnostics);
        SampleCheck sampleCheck = checkSamples(schemaCheck, diagnostics);
        ChartMappingCheck chartCheck = checkChartMapping(schemaCheck, diagnostics);
        return new DatabaseProbeResult(schemaCheck, sampleCheck, chartCheck);
      });
    } catch (RuntimeException error) {
      String detail = sanitizeError(error);
      log.warn("easyv_writeback_contract_db_probe_failed schema={} detail={}", schema, detail);
      diagnostics.add(new Diagnostic("ERROR", "DATABASE_UNAVAILABLE", "easyv-action-db",
          "源库只读探查失败: " + detail));
      List<TableCheck> failedTables = EasyVWritebackContract.REQUIRED_TABLES.stream()
          .map(table -> new TableCheck(
              table.tableName(),
              null,
              ItemStatus.FAILED,
              table.columns().stream()
                  .map(col -> new ColumnCheck(col.name(), col.expectedType().label(), null,
                      ItemStatus.SKIPPED, "源库连接或事务失败，未完成列检查"))
                  .toList(),
              "源库不可达或只读查询失败"))
          .toList();
      return new DatabaseProbeResult(
          new SchemaCheck(ItemStatus.FAILED, failedTables, "源库不可达或只读查询失败: " + detail),
          new SampleCheck(ItemStatus.SKIPPED, EasyVWritebackContract.SAMPLE_APP_LIMIT, 0,
              EasyVWritebackContract.REQUIRED_JSON_PATHS, List.of(), "源库不可达，跳过抽样检查"),
          new ChartMappingCheck(ItemStatus.SKIPPED, null, null, "源库不可达，跳过图表规则检查"));
    }
  }

  private SchemaCheck checkSchema(List<Diagnostic> diagnostics) {
    List<String> tableNames = EasyVWritebackContract.REQUIRED_TABLES.stream()
        .map(RequiredTable::tableName)
        .toList();
    Object[] args = new Object[tableNames.size() + 1];
    args[0] = schema;
    for (int i = 0; i < tableNames.size(); i++) {
      args[i + 1] = tableNames.get(i);
    }

    Map<String, String> existingTables = new LinkedHashMap<>();
    jdbc.query(
        "SELECT table_name, table_type FROM information_schema.tables "
            + "WHERE table_schema = ? AND table_name IN (?, ?, ?, ?, ?, ?)",
        rs -> {
          existingTables.put(rs.getString("table_name"), rs.getString("table_type"));
        },
        args);

    Map<String, Map<String, ColumnMetadata>> actualColumns = new LinkedHashMap<>();
    jdbc.query(
        "SELECT table_name, column_name, data_type, udt_name FROM information_schema.columns "
            + "WHERE table_schema = ? AND table_name IN (?, ?, ?, ?, ?, ?)",
        rs -> {
          actualColumns
              .computeIfAbsent(rs.getString("table_name"), ignored -> new LinkedHashMap<>())
              .put(rs.getString("column_name"),
                  new ColumnMetadata(rs.getString("data_type"), rs.getString("udt_name")));
        },
        args);

    List<TableCheck> tableChecks = new ArrayList<>();
    boolean allPassed = true;
    int missingTableCount = 0;
    int badColumnCount = 0;

    for (RequiredTable required : EasyVWritebackContract.REQUIRED_TABLES) {
      String tableName = required.tableName();
      boolean exists = existingTables.containsKey(tableName);
      if (!exists) {
        allPassed = false;
        missingTableCount++;
        String msg = "源 schema [" + schema + "] 缺少必需表或缺少可见权限: " + tableName;
        diagnostics.add(new Diagnostic("ERROR", "TABLE_MISSING", schema + "." + tableName, msg));
        List<ColumnCheck> missingCols = required.columns().stream()
            .map(col -> new ColumnCheck(col.name(), col.expectedType().label(), null,
                ItemStatus.FAILED, "所属源表缺失: " + tableName))
            .toList();
        tableChecks.add(new TableCheck(tableName, false, ItemStatus.FAILED, missingCols, msg));
        continue;
      }

      Map<String, ColumnMetadata> cols = actualColumns.getOrDefault(tableName, Map.of());
      List<ColumnCheck> columnChecks = new ArrayList<>();
      boolean tablePassed = true;
      for (RequiredColumn expected : required.columns()) {
        ColumnMetadata meta = cols.get(expected.name());
        if (meta == null) {
          tablePassed = false;
          badColumnCount++;
          String msg = "源表 " + tableName + " 缺少必需列 " + expected.name();
          diagnostics.add(new Diagnostic("ERROR", "COLUMN_MISSING", tableName + "." + expected.name(), msg));
          columnChecks.add(new ColumnCheck(expected.name(), expected.expectedType().label(), null,
              ItemStatus.FAILED, msg));
        } else if (!expected.expectedType().isCompatible(meta.dataType(), meta.udtName())) {
          tablePassed = false;
          badColumnCount++;
          String msg = "源表 " + tableName + " 列 " + expected.name() + " 类型不兼容: 期望 "
              + expected.expectedType().label() + "，实际 " + meta.displayType();
          diagnostics.add(new Diagnostic("ERROR", "COLUMN_TYPE_INCOMPATIBLE",
              tableName + "." + expected.name(), msg));
          columnChecks.add(new ColumnCheck(expected.name(), expected.expectedType().label(),
              meta.displayType(), ItemStatus.FAILED, msg));
        } else {
          columnChecks.add(new ColumnCheck(expected.name(), expected.expectedType().label(),
              meta.displayType(), ItemStatus.PASSED, null));
        }
      }
      if (!tablePassed) {
        allPassed = false;
      }
      tableChecks.add(new TableCheck(
          tableName,
          true,
          tablePassed ? ItemStatus.PASSED : ItemStatus.FAILED,
          columnChecks,
          tablePassed ? "表与必需列全部匹配" : "存在缺失或不兼容列"));
    }

    String schemaMessage = allPassed
        ? "6 张写回源表及全部必需列存在且类型兼容。"
        : "源表结构校验失败（缺表 " + missingTableCount + "，异常列 " + badColumnCount + "）。";
    return new SchemaCheck(allPassed ? ItemStatus.PASSED : ItemStatus.FAILED, tableChecks, schemaMessage);
  }

  private SampleCheck checkSamples(SchemaCheck schemaCheck, List<Diagnostic> diagnostics) {
    if (!tablePassed(schemaCheck, "ai_screen_app")
        || !tablePassed(schemaCheck, "ai_screen_prototype")
        || !tablePassed(schemaCheck, "ai_pipeline_node_record")) {
      String msg = "ai_screen_app / ai_screen_prototype / ai_pipeline_node_record 表结构未通过校验，跳过 JSON 抽样检查。";
      diagnostics.add(new Diagnostic("WARN", "SAMPLE_SKIPPED", "sample-json", msg));
      return new SampleCheck(ItemStatus.SKIPPED, EasyVWritebackContract.SAMPLE_APP_LIMIT, 0,
          EasyVWritebackContract.REQUIRED_JSON_PATHS, List.of(), msg);
    }

    String sql = "SELECT a.app_id, a.generation_task_id, p.id AS prototype_id, "
        + "p.screen_prototype_json::text AS screen_prototype_json, "
        + "(SELECT nr.output::text FROM " + quotedSchema + "ai_pipeline_node_record nr "
        + " WHERE nr.task_id = a.generation_task_id AND nr.step_name = ? "
        + " ORDER BY nr.id DESC LIMIT 1) AS pipeline_output "
        + "FROM " + quotedSchema + "ai_screen_app a "
        + "JOIN " + quotedSchema + "ai_screen_prototype p ON p.app_id = a.app_id "
        + "WHERE a.is_delete = ? AND a.generation_task_id IS NOT NULL AND btrim(a.generation_task_id) <> '' "
        + "ORDER BY p.update_time DESC NULLS LAST, p.id DESC "
        + "LIMIT ?";

    List<SampleRow> rows = jdbc.query(
        sql,
        (rs, rowNum) -> new SampleRow(
            rs.getString("app_id"),
            rs.getString("generation_task_id"),
            rs.getLong("prototype_id"),
            rs.getString("screen_prototype_json"),
            rs.getString("pipeline_output")),
        EasyVWritebackContract.PIPELINE_COMPLETED_STEP,
        EasyVWritebackContract.APP_ACTIVE_DELETE_FLAG,
        EasyVWritebackContract.SAMPLE_APP_LIMIT);

    if (rows.isEmpty()) {
      Long activeApps = jdbc.queryForObject(
          "SELECT COUNT(*) FROM " + quotedSchema + "ai_screen_app WHERE is_delete = ?",
          Long.class,
          EasyVWritebackContract.APP_ACTIVE_DELETE_FLAG);
      Long prototypeCount = jdbc.queryForObject(
          "SELECT COUNT(*) FROM " + quotedSchema + "ai_screen_prototype",
          Long.class);
      String msg = "源库暂无可用于写回核验的未删除应用原型样本（activeApps="
          + (activeApps == null ? 0 : activeApps) + ", prototypes="
          + (prototypeCount == null ? 0 : prototypeCount) + "），无法证明 JSON 路径兼容。";
      diagnostics.add(new Diagnostic("WARN", "SAMPLE_EMPTY", "ai_screen_app/ai_screen_prototype", msg));
      return new SampleCheck(ItemStatus.SAMPLE_EMPTY, EasyVWritebackContract.SAMPLE_APP_LIMIT, 0,
          EasyVWritebackContract.REQUIRED_JSON_PATHS, List.of(), msg);
    }

    List<SampleResult> results = new ArrayList<>();
    boolean anyFailed = false;
    for (SampleRow row : rows) {
      List<String> issues = new ArrayList<>();
      if (row.prototypeJson() == null || row.prototypeJson().isBlank()) {
        issues.add("screen_prototype_json(empty)");
      } else {
        try {
          JsonNode prototypeNode = JSON.readTree(row.prototypeJson());
          issues.addAll(EasyVWritebackContract.validatePrototypeJson(prototypeNode));
        } catch (Exception error) {
          issues.add("screen_prototype_json(invalid_json)");
        }
      }

      if (row.pipelineOutput() == null || row.pipelineOutput().isBlank()) {
        issues.add("ai_pipeline_node_record(step_name='PipelineCompleted').output(missing)");
      } else {
        try {
          JsonNode outputNode = JSON.readTree(row.pipelineOutput());
          issues.addAll(EasyVWritebackContract.validateEditingOutputJson(outputNode));
        } catch (Exception error) {
          issues.add("ai_pipeline_node_record.output(invalid_json)");
        }
      }

      if (issues.isEmpty()) {
        results.add(new SampleResult(row.appId(), row.generationTaskId(), row.prototypeId(),
            ItemStatus.PASSED, List.of(), "原型与编辑快照 JSON 关键路径完整"));
      } else {
        anyFailed = true;
        String msg = "应用 " + row.appId() + " 写回依赖 JSON 路径断裂或缺失: " + String.join(", ", issues);
        diagnostics.add(new Diagnostic("ERROR", "JSON_PATH_BROKEN", "app:" + row.appId(), msg));
        results.add(new SampleResult(row.appId(), row.generationTaskId(), row.prototypeId(),
            ItemStatus.FAILED, issues, msg));
      }
    }

    String summary = anyFailed
        ? "已抽样 " + rows.size() + " 个最新未删除应用，发现写回依赖 JSON 路径断裂。"
        : "已只读抽样 " + rows.size() + " 个最新未删除应用，原型与 PipelineCompleted 编辑快照路径全部匹配。";
    return new SampleCheck(
        anyFailed ? ItemStatus.FAILED : ItemStatus.PASSED,
        EasyVWritebackContract.SAMPLE_APP_LIMIT,
        rows.size(),
        EasyVWritebackContract.REQUIRED_JSON_PATHS,
        results,
        summary);
  }

  private ChartMappingCheck checkChartMapping(SchemaCheck schemaCheck, List<Diagnostic> diagnostics) {
    if (!tablePassed(schemaCheck, "ai_chart_type_mapping")) {
      String msg = "ai_chart_type_mapping 表结构未通过校验，跳过启用图形规则检查。";
      diagnostics.add(new Diagnostic("WARN", "CHART_MAPPING_SKIPPED", "ai_chart_type_mapping", msg));
      return new ChartMappingCheck(ItemStatus.SKIPPED, null, null, msg);
    }

    ChartCounts counts = jdbc.queryForObject(
        "SELECT COUNT(*) AS total_count, "
            + "COUNT(*) FILTER (WHERE status = ?) AS enabled_count, "
            + "COUNT(*) FILTER (WHERE status = ? AND ("
            + "  chart_type IS NULL OR btrim(chart_type) = '' "
            + "  OR chart_family IS NULL OR btrim(chart_family) = '' "
            + "  OR scene_tag IS NULL OR btrim(scene_tag) = ''"
            + ")) AS invalid_enabled_count "
            + "FROM " + quotedSchema + "ai_chart_type_mapping",
        (rs, rowNum) -> new ChartCounts(
            rs.getLong("total_count"),
            rs.getLong("enabled_count"),
            rs.getLong("invalid_enabled_count")),
        EasyVWritebackContract.CHART_MAPPING_ENABLED_STATUS,
        EasyVWritebackContract.CHART_MAPPING_ENABLED_STATUS);

    if (counts == null || counts.totalCount() == 0) {
      String msg = "ai_chart_type_mapping 暂无数据，无法验证图形翻译启用规则。";
      diagnostics.add(new Diagnostic("WARN", "CHART_MAPPING_EMPTY", schema + ".ai_chart_type_mapping", msg));
      return new ChartMappingCheck(ItemStatus.SAMPLE_EMPTY, 0L, 0L, msg);
    }
    if (counts.enabledCount() == 0) {
      String msg = "ai_chart_type_mapping 共 " + counts.totalCount()
          + " 条记录，但启用规则（status='0'）为 0 条，图形写回将全部被拒。";
      diagnostics.add(new Diagnostic("ERROR", "CHART_MAPPING_NONE_ENABLED",
          schema + ".ai_chart_type_mapping", msg));
      return new ChartMappingCheck(ItemStatus.FAILED, counts.totalCount(), 0L, msg);
    }
    if (counts.invalidEnabledCount() > 0) {
      String msg = "ai_chart_type_mapping 存在 " + counts.invalidEnabledCount()
          + " 条启用规则缺少 chart_type / chart_family / scene_tag。";
      diagnostics.add(new Diagnostic("ERROR", "CHART_MAPPING_INVALID_ROW",
          schema + ".ai_chart_type_mapping", msg));
      return new ChartMappingCheck(ItemStatus.FAILED, counts.totalCount(), counts.enabledCount(), msg);
    }
    String msg = "已核验 " + counts.enabledCount() + " 条启用图形映射规则（总计 " + counts.totalCount() + " 条）。";
    return new ChartMappingCheck(ItemStatus.PASSED, counts.totalCount(), counts.enabledCount(), msg);
  }

  private RedisCheck probeRedis(List<Diagnostic> diagnostics) {
    long startNanos = System.nanoTime();
    try {
      RedisCommands<String, String> redis = redisSupplier.get();
      String pong = redis.ping();
      long latencyMs = Math.max(0L, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos));
      if ("PONG".equalsIgnoreCase(pong)) {
        return new RedisCheck(
            ItemStatus.PASSED,
            EasyVWritebackContract.REDIS_INVALIDATION_KEY_PATTERN,
            pong,
            latencyMs,
            "源 Redis 只读 PING 成功（" + latencyMs + " ms），约定失效键模式 "
                + EasyVWritebackContract.REDIS_INVALIDATION_KEY_PATTERN);
      }
      String msg = "源 Redis PING 返回异常响应: " + sanitizeText(pong);
      diagnostics.add(new Diagnostic("ERROR", "REDIS_UNEXPECTED_PING", "easyv-action-redis", msg));
      return new RedisCheck(ItemStatus.FAILED, EasyVWritebackContract.REDIS_INVALIDATION_KEY_PATTERN,
          sanitizeText(pong), latencyMs, msg);
    } catch (RuntimeException error) {
      long latencyMs = Math.max(0L, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos));
      String detail = sanitizeError(error);
      log.warn("easyv_writeback_contract_redis_probe_failed detail={}", detail);
      String msg = "源 Redis 不可达或 PING 失败: " + detail;
      diagnostics.add(new Diagnostic("ERROR", "REDIS_UNREACHABLE", "easyv-action-redis", msg));
      return new RedisCheck(ItemStatus.FAILED, EasyVWritebackContract.REDIS_INVALIDATION_KEY_PATTERN,
          null, latencyMs, msg);
    }
  }

  private <T> T executeReadOnly(Supplier<T> operation) {
    DataSource dataSource = Objects.requireNonNull(jdbc.getDataSource(), "EasyV 源库 DataSource 未配置");
    var txManager = new DataSourceTransactionManager(dataSource);
    txManager.setEnforceReadOnly(true);
    var tx = new TransactionTemplate(txManager);
    tx.setReadOnly(true);
    tx.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    return tx.execute(status -> {
      jdbc.execute("SET LOCAL statement_timeout='15s'");
      jdbc.execute("SET LOCAL lock_timeout='3s'");
      String readOnly = jdbc.queryForObject("SELECT current_setting('transaction_read_only')", String.class);
      if (!"on".equalsIgnoreCase(readOnly)) {
        throw new IllegalStateException("源库契约探针必须在 PostgreSQL READ ONLY 事务中执行");
      }
      return operation.get();
    });
  }

  private static boolean tablePassed(SchemaCheck schemaCheck, String tableName) {
    return schemaCheck.tables().stream()
        .anyMatch(t -> t.tableName().equals(tableName) && t.status() == ItemStatus.PASSED);
  }

  private static ContractStatus resolveOverallStatus(
      SchemaCheck schemaCheck,
      SampleCheck sampleCheck,
      ChartMappingCheck chartCheck,
      RedisCheck redisCheck) {
    if (schemaCheck.status() == ItemStatus.FAILED
        || sampleCheck.status() == ItemStatus.FAILED
        || chartCheck.status() == ItemStatus.FAILED
        || redisCheck.status() == ItemStatus.FAILED) {
      return ContractStatus.FAILED;
    }
    if (sampleCheck.status() == ItemStatus.SAMPLE_EMPTY
        || chartCheck.status() == ItemStatus.SAMPLE_EMPTY) {
      return ContractStatus.SAMPLE_EMPTY;
    }
    return ContractStatus.PASSED;
  }

  private static String summarize(
      ContractStatus status,
      SchemaCheck schemaCheck,
      SampleCheck sampleCheck,
      ChartMappingCheck chartCheck,
      RedisCheck redisCheck) {
    return switch (status) {
      case PASSED -> "EasyV 写回上游契约检查通过：6 张源表结构、" + sampleCheck.sampledAppCount()
          + " 个抽样应用 JSON 路径、启用图形规则与源 Redis PING 均正常。";
      case SAMPLE_EMPTY -> "EasyV 写回源表结构与源 Redis 正常，但源库存在空样本（应用抽样="
          + sampleCheck.status() + "，图形规则=" + chartCheck.status() + "），未能完成全路径实证，请人工核对后再启用写回。";
      case FAILED -> {
        List<String> failedParts = new ArrayList<>();
        if (schemaCheck.status() == ItemStatus.FAILED) failedParts.add("源表结构");
        if (sampleCheck.status() == ItemStatus.FAILED) failedParts.add("JSON投影路径");
        if (chartCheck.status() == ItemStatus.FAILED) failedParts.add("启用图形规则");
        if (redisCheck.status() == ItemStatus.FAILED) failedParts.add("源Redis连通性");
        yield "EasyV 写回上游契约检查失败：" + String.join("、", failedParts) + " 存在异常，详见 diagnostics。";
      }
      case DISABLED -> "EasyV 写回未启用。";
    };
  }

  private static String validateSchema(String schema) {
    if (schema == null || !schema.matches("[A-Za-z_][A-Za-z0-9_]*")) {
      throw new IllegalArgumentException("Invalid EasyV schema");
    }
    return schema;
  }

  private static String sanitizeError(Throwable error) {
    Throwable root = error;
    String sqlState = null;
    while (root != null) {
      if (root instanceof SQLException sqlEx && sqlEx.getSQLState() != null) {
        sqlState = sqlEx.getSQLState();
      }
      if (root.getCause() == null || root.getCause() == root) {
        break;
      }
      root = root.getCause();
    }
    String type = root == null ? error.getClass().getSimpleName() : root.getClass().getSimpleName();
    String message = root == null ? error.getMessage() : root.getMessage();
    String cleaned = sanitizeText(message);
    String suffix = sqlState == null ? "" : "[SQLState=" + sqlState + "]";
    return cleaned.isEmpty() ? type + suffix : type + suffix + ": " + cleaned;
  }

  private static String sanitizeText(String text) {
    if (text == null || text.isBlank()) {
      return "";
    }
    String scrubbed = URI_CREDENTIALS.matcher(text).replaceAll("$1***@");
    scrubbed = KEY_VALUE_SECRET.matcher(scrubbed).replaceAll("$1=***");
    return scrubbed.length() > 300 ? scrubbed.substring(0, 300) + "..." : scrubbed;
  }

  private record ColumnMetadata(String dataType, String udtName) {
    String displayType() {
      if (dataType == null || dataType.isBlank()) {
        return udtName == null ? "unknown" : udtName;
      }
      return dataType;
    }
  }

  private record SampleRow(
      String appId,
      String generationTaskId,
      long prototypeId,
      String prototypeJson,
      String pipelineOutput) {}

  private record ChartCounts(long totalCount, long enabledCount, long invalidEnabledCount) {}

  private record DatabaseProbeResult(
      SchemaCheck schemaCheck,
      SampleCheck sampleCheck,
      ChartMappingCheck chartMappingCheck) {}
}
