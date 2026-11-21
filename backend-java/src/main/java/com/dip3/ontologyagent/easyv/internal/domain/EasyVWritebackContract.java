package com.dip3.ontologyagent.easyv.internal.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * EasyV C/D 阶段直写适配器的只读上游契约定义与检查报告值对象。
 *
 * <p>集中声明 {@code EasyVBlockActionDatabaseAdapter} 与 {@link PrototypeBlockWriteback}
 * 所依赖的 6 张源表、必需列与类型兼容规则、编辑快照 JSON 路径以及源 Redis 失效键约定。
 */
public final class EasyVWritebackContract {
  public static final String REDIS_INVALIDATION_KEY_PATTERN = "ai:screen:regen:<generationTaskId>";
  public static final int SAMPLE_APP_LIMIT = 3;
  public static final String APP_ACTIVE_DELETE_FLAG = "0";
  public static final String PIPELINE_COMPLETED_STEP = "PipelineCompleted";
  public static final String CHART_MAPPING_ENABLED_STATUS = "0";

  private EasyVWritebackContract() {}

  public enum ContractStatus {
    PASSED,
    SAMPLE_EMPTY,
    FAILED,
    DISABLED
  }

  public enum ItemStatus {
    PASSED,
    SAMPLE_EMPTY,
    FAILED,
    SKIPPED,
    DISABLED,
    PENDING
  }

  public enum ColumnType {
    TEXT("text / varchar", Set.of("text", "character varying", "character"), Set.of("text", "varchar", "bpchar")),
    INTEGER("smallint / integer / bigint", Set.of("smallint", "integer", "bigint"), Set.of("int2", "int4", "int8")),
    JSON("json / jsonb", Set.of("json", "jsonb"), Set.of("json", "jsonb")),
    JSONB("jsonb", Set.of("jsonb"), Set.of("jsonb")),
    TIMESTAMP("timestamp / timestamptz",
        Set.of("timestamp without time zone", "timestamp with time zone"),
        Set.of("timestamp", "timestamptz"));

    private final String label;
    private final Set<String> dataTypes;
    private final Set<String> udtNames;

    ColumnType(String label, Set<String> dataTypes, Set<String> udtNames) {
      this.label = label;
      this.dataTypes = dataTypes;
      this.udtNames = udtNames;
    }

    public String label() {
      return label;
    }

    public boolean isCompatible(String dataType, String udtName) {
      String normalizedType = dataType == null ? "" : dataType.trim().toLowerCase(Locale.ROOT);
      String normalizedUdt = udtName == null ? "" : udtName.trim().toLowerCase(Locale.ROOT);
      return dataTypes.contains(normalizedType) || udtNames.contains(normalizedUdt);
    }
  }

  public record RequiredColumn(String name, ColumnType expectedType) {
    public RequiredColumn {
      Objects.requireNonNull(name, "column name must not be null");
      Objects.requireNonNull(expectedType, "expectedType must not be null");
    }
  }

  public record RequiredTable(String tableName, List<RequiredColumn> columns) {
    public RequiredTable {
      Objects.requireNonNull(tableName, "tableName must not be null");
      columns = List.copyOf(columns);
    }
  }

  public static final List<RequiredTable> REQUIRED_TABLES = List.of(
      new RequiredTable("ai_screen_app", List.of(
          new RequiredColumn("app_id", ColumnType.TEXT),
          new RequiredColumn("app_name", ColumnType.TEXT),
          new RequiredColumn("generation_task_id", ColumnType.TEXT),
          new RequiredColumn("scope_type", ColumnType.TEXT),
          new RequiredColumn("user_id", ColumnType.INTEGER),
          new RequiredColumn("space_id", ColumnType.INTEGER),
          new RequiredColumn("team_id", ColumnType.INTEGER),
          new RequiredColumn("is_delete", ColumnType.TEXT))),
      new RequiredTable("ai_screen_prototype", List.of(
          new RequiredColumn("id", ColumnType.INTEGER),
          new RequiredColumn("app_id", ColumnType.TEXT),
          new RequiredColumn("screen_structure_xml", ColumnType.TEXT),
          new RequiredColumn("screen_template_json", ColumnType.JSON),
          new RequiredColumn("screen_prototype_json", ColumnType.JSON),
          new RequiredColumn("update_time", ColumnType.TIMESTAMP))),
      new RequiredTable("ai_pipeline_node_record", List.of(
          new RequiredColumn("id", ColumnType.INTEGER),
          new RequiredColumn("task_id", ColumnType.TEXT),
          new RequiredColumn("step_name", ColumnType.TEXT),
          new RequiredColumn("output", ColumnType.JSONB))),
      new RequiredTable("ai_block_data", List.of(
          new RequiredColumn("id", ColumnType.INTEGER),
          new RequiredColumn("block_type_id", ColumnType.TEXT),
          new RequiredColumn("chat_count", ColumnType.INTEGER),
          new RequiredColumn("block_slots_data", ColumnType.TEXT))),
      new RequiredTable("ai_block_internal_data", List.of(
          new RequiredColumn("id", ColumnType.INTEGER),
          new RequiredColumn("allowed_chart_categories", ColumnType.TEXT),
          new RequiredColumn("recommend_type", ColumnType.TEXT))),
      new RequiredTable("ai_chart_type_mapping", List.of(
          new RequiredColumn("id", ColumnType.INTEGER),
          new RequiredColumn("chart_type", ColumnType.TEXT),
          new RequiredColumn("chart_family", ColumnType.TEXT),
          new RequiredColumn("scene_tag", ColumnType.TEXT),
          new RequiredColumn("status", ColumnType.TEXT),
          new RequiredColumn("sort_order", ColumnType.INTEGER))));

  public static final List<String> REQUIRED_JSON_PATHS = List.of(
      "screen_prototype_json:page/blocks",
      "screen_prototype_json:page/blocks/*/components",
      "screen_prototype_json:page/blocks/*/boundMetricIds",
      "screen_prototype_json:page/blocks/*/boundMetrics",
      "screen_prototype_json:page/blocks/*/themeId",
      "ai_pipeline_node_record.output:" + PrototypeBlockWriteback.CURRENT_FILLED_BLOCKS_PATH,
      "ai_pipeline_node_record.output:" + PrototypeBlockWriteback.CURRENT_BLOCK_THEMES_PATH,
      "ai_pipeline_node_record.output:" + PrototypeBlockWriteback.BLOCK_ASSIGNMENTS_PATH,
      "ai_pipeline_node_record.output:" + PrototypeBlockWriteback.BLOCK_CANDIDATES_PATH);

  public record ColumnCheck(
      String columnName,
      String expectedType,
      String actualType,
      ItemStatus status,
      String message) {}

  public record TableCheck(
      String tableName,
      Boolean exists,
      ItemStatus status,
      List<ColumnCheck> columns,
      String message) {
    public TableCheck {
      columns = List.copyOf(columns);
    }
  }

  public record SchemaCheck(ItemStatus status, List<TableCheck> tables, String message) {
    public SchemaCheck {
      tables = List.copyOf(tables);
    }
  }

  public record SampleResult(
      String appId,
      String generationTaskId,
      Long prototypeId,
      ItemStatus status,
      List<String> missingOrInvalidPaths,
      String message) {
    public SampleResult {
      missingOrInvalidPaths = List.copyOf(missingOrInvalidPaths);
    }
  }

  public record SampleCheck(
      ItemStatus status,
      int sampleLimit,
      int sampledAppCount,
      List<String> requiredJsonPaths,
      List<SampleResult> samples,
      String message) {
    public SampleCheck {
      requiredJsonPaths = List.copyOf(requiredJsonPaths);
      samples = List.copyOf(samples);
    }
  }

  public record ChartMappingCheck(
      ItemStatus status,
      Long totalCount,
      Long enabledCount,
      String message) {}

  public record RedisCheck(
      ItemStatus status,
      String expectedInvalidationKeyPattern,
      String pingResponse,
      Long latencyMs,
      String message) {}

  public record ContractChecklistItem(
      String category,
      String target,
      ItemStatus status,
      String description) {}

  public record Diagnostic(
      String severity,
      String code,
      String target,
      String message) {}

  public record Report(
      ContractStatus status,
      boolean actionEnabled,
      String schema,
      Instant checkedAt,
      String summary,
      String disabledReason,
      SchemaCheck schemaCheck,
      SampleCheck sampleCheck,
      ChartMappingCheck chartMappingCheck,
      RedisCheck redisCheck,
      List<ContractChecklistItem> contractChecklist,
      List<Diagnostic> diagnostics) {
    public Report {
      contractChecklist = List.copyOf(contractChecklist);
      diagnostics = List.copyOf(diagnostics);
    }
  }

  /** 验证 {@code ai_screen_prototype.screen_prototype_json} 是否包含写回所需的页块与组件/指标路径。 */
  public static List<String> validatePrototypeJson(JsonNode prototype) {
    if (prototype == null || prototype.isNull() || !prototype.isObject()) {
      return List.of("screen_prototype_json(not_object)");
    }
    Set<String> issues = new LinkedHashSet<>();
    boolean foundBlocksMap = false;
    boolean foundCompleteBlock = false;
    boolean sawComponents = false;
    boolean sawBoundMetricIds = false;
    boolean sawBoundMetrics = false;
    boolean sawThemeId = false;

    for (var pageEntry : prototype.properties()) {
      if (!(pageEntry.getValue() instanceof ObjectNode pageObj)) {
        continue;
      }
      JsonNode blocksNode = pageObj.get(PrototypeBlockWriteback.PROTOTYPE_BLOCKS_FIELD);
      if (blocksNode == null) {
        if (pageEntry.getKey().startsWith("page-")) {
          issues.add("page/blocks");
        }
        continue;
      }
      if (!(blocksNode instanceof ObjectNode blocksObj)) {
        issues.add("page/blocks(not_object)");
        continue;
      }
      if (!blocksObj.isEmpty()) {
        foundBlocksMap = true;
      }
      for (var blockEntry : blocksObj.properties()) {
        String blockId = blockEntry.getKey();
        if (!(blockEntry.getValue() instanceof ObjectNode blockNode)) {
          issues.add("page/blocks/" + blockId + "(not_object)");
          continue;
        }
        JsonNode components = blockNode.get(PrototypeBlockWriteback.BLOCK_COMPONENTS_FIELD);
        if (components != null && !components.isArray()) {
          issues.add("page/blocks/" + blockId + "/components(not_array)");
        }
        JsonNode boundIds = blockNode.get(PrototypeBlockWriteback.BLOCK_BOUND_METRIC_IDS_FIELD);
        if (boundIds != null && !boundIds.isArray()) {
          issues.add("page/blocks/" + blockId + "/boundMetricIds(not_array)");
        }
        JsonNode boundMetrics = blockNode.get(PrototypeBlockWriteback.BLOCK_BOUND_METRICS_FIELD);
        if (boundMetrics != null && !boundMetrics.isArray()) {
          issues.add("page/blocks/" + blockId + "/boundMetrics(not_array)");
        }
        boolean componentsOk = false;
        if (components instanceof ArrayNode componentArray) {
          if (hasValidComponents(componentArray)) {
            componentsOk = true;
          } else {
            issues.add("page/blocks/" + blockId + "/components(invalid_item)");
          }
        }
        boolean idsOk = boundIds instanceof ArrayNode;
        boolean metricsOk = boundMetrics instanceof ArrayNode;
        boolean themeOk = !blockNode.path(PrototypeBlockWriteback.BLOCK_THEME_ID_FIELD).asText("").isBlank();
        sawComponents |= componentsOk;
        sawBoundMetricIds |= idsOk;
        sawBoundMetrics |= metricsOk;
        sawThemeId |= themeOk;
        if (componentsOk && idsOk && metricsOk && themeOk) {
          foundCompleteBlock = true;
        }
      }
    }

    if (!foundBlocksMap) {
      issues.add("page/blocks");
    } else if (!foundCompleteBlock) {
      if (!sawComponents) issues.add("page/blocks/*/components");
      if (!sawBoundMetricIds) issues.add("page/blocks/*/boundMetricIds");
      if (!sawBoundMetrics) issues.add("page/blocks/*/boundMetrics");
      if (!sawThemeId) issues.add("page/blocks/*/themeId");
      if (sawComponents && sawBoundMetricIds && sawBoundMetrics && sawThemeId) {
        issues.add("page/blocks/*(incomplete_writeback_block)");
      }
    }
    return List.copyOf(issues);
  }

  private static boolean hasValidComponents(ArrayNode components) {
    for (JsonNode component : components) {
      if (!(component instanceof ObjectNode node)) {
        return false;
      }
      if (node.path(PrototypeBlockWriteback.COMPONENT_ID_FIELD).asText("").isBlank()
          || node.path(PrototypeBlockWriteback.COMPONENT_CHART_FAMILY_FIELD).asText("").isBlank()) {
        return false;
      }
    }
    return true;
  }

  /** 验证 {@code ai_pipeline_node_record (step_name='PipelineCompleted')} 的 {@code output} JSON 路径。 */
  public static List<String> validateEditingOutputJson(JsonNode output) {
    if (output == null || output.isNull() || !output.isObject()) {
      return List.of("ai_pipeline_node_record.output(not_object)");
    }
    JsonNode snapshot = output.at(PrototypeBlockWriteback.REGEN_CONTEXT_SNAPSHOT_PATH);
    if (!snapshot.isObject()) {
      return List.of(PrototypeBlockWriteback.REGEN_CONTEXT_SNAPSHOT_PATH);
    }
    Set<String> issues = new LinkedHashSet<>();

    JsonNode filled = output.at(PrototypeBlockWriteback.CURRENT_FILLED_BLOCKS_PATH);
    if (!(filled instanceof ArrayNode filledArray) || filledArray.isEmpty()) {
      issues.add(PrototypeBlockWriteback.CURRENT_FILLED_BLOCKS_PATH);
    } else {
      validateFilledBlocks(filledArray, issues);
    }

    JsonNode themes = output.at(PrototypeBlockWriteback.CURRENT_BLOCK_THEMES_PATH);
    if (!(themes instanceof ArrayNode themesArray) || themesArray.isEmpty()) {
      issues.add(PrototypeBlockWriteback.CURRENT_BLOCK_THEMES_PATH);
    } else {
      validateObjectIds(themesArray, PrototypeBlockWriteback.BLOCK_THEME_ID_FIELD,
          PrototypeBlockWriteback.CURRENT_BLOCK_THEMES_PATH, issues);
    }

    JsonNode assignments = output.at(PrototypeBlockWriteback.BLOCK_ASSIGNMENTS_PATH);
    if (!(assignments instanceof ArrayNode assignmentsArray) || assignmentsArray.isEmpty()) {
      issues.add(PrototypeBlockWriteback.BLOCK_ASSIGNMENTS_PATH);
    } else {
      validateAssignments(assignmentsArray, issues);
    }

    JsonNode candidates = output.at(PrototypeBlockWriteback.BLOCK_CANDIDATES_PATH);
    if (!(candidates instanceof ArrayNode candidatesArray) || candidatesArray.isEmpty()) {
      issues.add(PrototypeBlockWriteback.BLOCK_CANDIDATES_PATH);
    } else {
      validateObjectIds(candidatesArray, PrototypeBlockWriteback.BLOCK_ID_FIELD,
          PrototypeBlockWriteback.BLOCK_CANDIDATES_PATH, issues);
    }
    return List.copyOf(issues);
  }

  private static void validateFilledBlocks(ArrayNode filledArray, Set<String> issues) {
    boolean hasSlotBindings = false;
    for (JsonNode entry : filledArray) {
      if (!(entry instanceof ObjectNode blockNode)) {
        issues.add(PrototypeBlockWriteback.CURRENT_FILLED_BLOCKS_PATH + "(item_not_object)");
        continue;
      }
      if (blockNode.path(PrototypeBlockWriteback.BLOCK_ID_FIELD).asText("").isBlank()) {
        issues.add(PrototypeBlockWriteback.CURRENT_FILLED_BLOCKS_PATH + "/" + PrototypeBlockWriteback.BLOCK_ID_FIELD);
      }
      JsonNode bindings = blockNode.get(PrototypeBlockWriteback.SLOT_BINDINGS_FIELD);
      if (bindings != null && !bindings.isArray()) {
        issues.add(PrototypeBlockWriteback.CURRENT_FILLED_BLOCKS_PATH + "/" + PrototypeBlockWriteback.SLOT_BINDINGS_FIELD);
      } else if (bindings instanceof ArrayNode bindingArray) {
        hasSlotBindings = true;
        for (JsonNode binding : bindingArray) {
          if (!(binding instanceof ObjectNode bindingNode)
              || bindingNode.at("/boundMetric/" + PrototypeBlockWriteback.METRIC_ID_FIELD).asText("").isBlank()) {
            issues.add(PrototypeBlockWriteback.CURRENT_FILLED_BLOCKS_PATH + "/"
                + PrototypeBlockWriteback.SLOT_BINDINGS_FIELD + "/boundMetric/" + PrototypeBlockWriteback.METRIC_ID_FIELD);
            break;
          }
        }
      }
    }
    if (!hasSlotBindings) {
      issues.add(PrototypeBlockWriteback.CURRENT_FILLED_BLOCKS_PATH + "/" + PrototypeBlockWriteback.SLOT_BINDINGS_FIELD);
    }
  }

  private static void validateAssignments(ArrayNode assignmentsArray, Set<String> issues) {
    boolean hasAssignedTheme = false;
    for (JsonNode entry : assignmentsArray) {
      if (!(entry instanceof ObjectNode node)) {
        issues.add(PrototypeBlockWriteback.BLOCK_ASSIGNMENTS_PATH + "(item_not_object)");
        continue;
      }
      if (node.path(PrototypeBlockWriteback.BLOCK_ID_FIELD).asText("").isBlank()) {
        issues.add(PrototypeBlockWriteback.BLOCK_ASSIGNMENTS_PATH + "/" + PrototypeBlockWriteback.BLOCK_ID_FIELD);
      }
      if (node.path(PrototypeBlockWriteback.BLOCK_THEME_ID_FIELD).asText("").isBlank()) {
        issues.add(PrototypeBlockWriteback.BLOCK_ASSIGNMENTS_PATH + "/" + PrototypeBlockWriteback.BLOCK_THEME_ID_FIELD);
      }
      JsonNode assigned = node.get(PrototypeBlockWriteback.ASSIGNED_THEME_FIELD);
      if (assigned != null && !(assigned instanceof ObjectNode)) {
        issues.add(PrototypeBlockWriteback.BLOCK_ASSIGNMENTS_PATH + "/" + PrototypeBlockWriteback.ASSIGNED_THEME_FIELD);
      } else if (assigned instanceof ObjectNode assignedObj
          && !assignedObj.path(PrototypeBlockWriteback.BLOCK_THEME_ID_FIELD).asText("").isBlank()) {
        hasAssignedTheme = true;
      }
    }
    if (!hasAssignedTheme) {
      issues.add(PrototypeBlockWriteback.BLOCK_ASSIGNMENTS_PATH + "/"
          + PrototypeBlockWriteback.ASSIGNED_THEME_FIELD + "/" + PrototypeBlockWriteback.BLOCK_THEME_ID_FIELD);
    }
  }

  private static void validateObjectIds(ArrayNode array, String idField, String path, Set<String> issues) {
    for (JsonNode entry : array) {
      if (!(entry instanceof ObjectNode node) || node.path(idField).asText("").isBlank()) {
        issues.add(path + "/" + idField);
        return;
      }
    }
  }

  /** 构建当 {@code dip3.easyv.action.enabled=false} 时的明确禁用态报告与待查契约清单。 */
  public static Report disabledReport(String schema, String reason, Instant checkedAt) {
    String effectiveReason = reason == null || reason.isBlank()
        ? "EasyV 写回未启用（dip3.easyv.action.enabled=false），探针未执行上游库与 Redis 连接。"
        : reason;
    List<TableCheck> tables = REQUIRED_TABLES.stream()
        .map(table -> new TableCheck(
            table.tableName(),
            null,
            ItemStatus.DISABLED,
            table.columns().stream()
                .map(col -> new ColumnCheck(col.name(), col.expectedType().label(), null,
                    ItemStatus.DISABLED, "未检查（写回未启用）"))
                .toList(),
            "未检查（写回未启用）"))
        .toList();
    return new Report(
        ContractStatus.DISABLED,
        false,
        schema,
        checkedAt,
        effectiveReason,
        effectiveReason,
        new SchemaCheck(ItemStatus.DISABLED, tables, "未检查源库表结构（dip3.easyv.action.enabled=false）"),
        new SampleCheck(ItemStatus.DISABLED, SAMPLE_APP_LIMIT, 0, REQUIRED_JSON_PATHS, List.of(),
            "未抽样检查原型与编辑快照 JSON 路径（dip3.easyv.action.enabled=false）"),
        new ChartMappingCheck(ItemStatus.DISABLED, null, null,
            "未检查 ai_chart_type_mapping 启用规则（dip3.easyv.action.enabled=false）"),
        new RedisCheck(ItemStatus.DISABLED, REDIS_INVALIDATION_KEY_PATTERN, null, null,
            "未探测源 Redis 连通性（dip3.easyv.action.enabled=false）"),
        buildChecklist(ItemStatus.PENDING, ItemStatus.PENDING, ItemStatus.PENDING, ItemStatus.PENDING),
        List.of(new Diagnostic("INFO", "ACTION_DISABLED", "dip3.easyv.action.enabled", effectiveReason)));
  }

  public static List<ContractChecklistItem> buildChecklist(
      SchemaCheck schemaCheck,
      SampleCheck sampleCheck,
      ChartMappingCheck chartMappingCheck,
      RedisCheck redisCheck) {
    List<ContractChecklistItem> items = new ArrayList<>();
    var tableStatuses = schemaCheck.tables().stream()
        .collect(Collectors.toMap(TableCheck::tableName, TableCheck::status));
    for (RequiredTable table : REQUIRED_TABLES) {
      String cols = table.columns().stream().map(RequiredColumn::name).collect(Collectors.joining(", "));
      items.add(new ContractChecklistItem(
          "SCHEMA",
          table.tableName(),
          tableStatuses.getOrDefault(table.tableName(), schemaCheck.status()),
          "核验源表及必需列存在性与类型兼容: " + cols));
    }
    for (String path : REQUIRED_JSON_PATHS) {
      ItemStatus pathStatus = resolvePathChecklistStatus(path, sampleCheck);
      items.add(new ContractChecklistItem(
          "JSON_PATH",
          path,
          pathStatus,
          "只读抽样（LIMIT " + SAMPLE_APP_LIMIT + "）核验写回依赖 JSON 路径"));
    }
    items.add(new ContractChecklistItem(
        "CHART_MAPPING",
        "ai_chart_type_mapping(status='0')",
        chartMappingCheck.status(),
        "核验存在至少一条启用状态的图形映射规则"));
    items.add(new ContractChecklistItem(
        "REDIS",
        REDIS_INVALIDATION_KEY_PATTERN,
        redisCheck.status(),
        "只读 PING 核验源 Redis 连通性与延迟（严禁写入/删除）"));
    return List.copyOf(items);
  }

  private static ItemStatus resolvePathChecklistStatus(String requiredPath, SampleCheck sampleCheck) {
    if (sampleCheck.status() != ItemStatus.FAILED) {
      return sampleCheck.status();
    }
    int colon = requiredPath.indexOf(':');
    String sourceKind = colon >= 0 ? requiredPath.substring(0, colon) : "";
    String barePath = colon >= 0 ? requiredPath.substring(colon + 1) : requiredPath;
    for (SampleResult sample : sampleCheck.samples()) {
      if (sample.status() != ItemStatus.FAILED) continue;
      for (String issue : sample.missingOrInvalidPaths()) {
        if (matchesPathIssue(sourceKind, barePath, issue)) {
          return ItemStatus.FAILED;
        }
      }
    }
    return ItemStatus.PASSED;
  }

  private static boolean matchesPathIssue(String sourceKind, String barePath, String issue) {
    if (sourceKind.equals("screen_prototype_json")) {
      if (issue.startsWith("screen_prototype_json(")) return true;
      if (barePath.equals("page/blocks")) return issue.startsWith("page/blocks");
      String suffix = barePath.substring("page/blocks/*".length());
      return issue.equals(barePath) || issue.contains(suffix);
    }
    if (sourceKind.equals("ai_pipeline_node_record.output")) {
      if (issue.startsWith("ai_pipeline_node_record")
          || issue.startsWith("ai_screen_app.generation_task_id")
          || issue.equals(PrototypeBlockWriteback.REGEN_CONTEXT_SNAPSHOT_PATH)) {
        return true;
      }
      return issue.equals(barePath) || issue.startsWith(barePath + "/");
    }
    return issue.contains(barePath);
  }

  public static List<ContractChecklistItem> buildChecklist(
      ItemStatus schemaStatus,
      ItemStatus sampleStatus,
      ItemStatus chartMappingStatus,
      ItemStatus redisStatus) {
    List<ContractChecklistItem> items = new ArrayList<>();
    for (RequiredTable table : REQUIRED_TABLES) {
      String cols = table.columns().stream().map(RequiredColumn::name).collect(Collectors.joining(", "));
      items.add(new ContractChecklistItem(
          "SCHEMA",
          table.tableName(),
          schemaStatus,
          "核验源表及必需列存在性与类型兼容: " + cols));
    }
    for (String path : REQUIRED_JSON_PATHS) {
      items.add(new ContractChecklistItem(
          "JSON_PATH",
          path,
          sampleStatus,
          "只读抽样（LIMIT " + SAMPLE_APP_LIMIT + "）核验写回依赖 JSON 路径"));
    }
    items.add(new ContractChecklistItem(
        "CHART_MAPPING",
        "ai_chart_type_mapping(status='0')",
        chartMappingStatus,
        "核验存在至少一条启用状态的图形映射规则"));
    items.add(new ContractChecklistItem(
        "REDIS",
        REDIS_INVALIDATION_KEY_PATTERN,
        redisStatus,
        "只读 PING 核验源 Redis 连通性与延迟（严禁写入/删除）"));
    return List.copyOf(items);
  }
}
