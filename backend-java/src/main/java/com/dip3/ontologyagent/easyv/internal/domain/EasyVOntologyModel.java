package com.dip3.ontologyagent.easyv.internal.domain;

import com.dip3.ontologyagent.semantic.api.OntologyLink;
import com.dip3.ontologyagent.semantic.api.OntologyLink.Cardinality;
import com.dip3.ontologyagent.semantic.api.OntologyMetric;
import com.dip3.ontologyagent.semantic.api.OntologyMetric.Aggregation;
import com.dip3.ontologyagent.semantic.api.OntologyModelContribution;
import com.dip3.ontologyagent.semantic.api.OntologyObjectType;
import com.dip3.ontologyagent.semantic.api.OntologyProperty;
import com.dip3.ontologyagent.semantic.api.OntologyProperty.Type;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

/**
 * EasyV 本体对象声明：Cube 模型与对象/动作工具的唯一来源。
 * 口径与 canonical facts 冻结语义一致：应用只含未删除记录（tombstone 保留在 facts 中供复核）；
 * 原型、流水线、生成任务与反馈没有独立删除字段，通过成员资格关系跟随未删除应用。
 * 授权范围按 EasyV 创建用户（{@code userId}）限定。
 */
public final class EasyVOntologyModel implements OntologyModelContribution {
  public static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
  public static final String SCOPE_USER = "userId";

  private static final String TERMINAL = "lower({CUBE}.status) in ('completed','failed','cancelled')";
  private static final String TIMED_TERMINAL =
      TERMINAL + " and {CUBE}.started_at is not null and {CUBE}.finished_at is not null";
  private static final String DURATION_MS =
      "extract(epoch from ({CUBE}.finished_at - {CUBE}.started_at)) * 1000";
  private static final String MAIN_TIMED = "upper({CUBE}.branch) = 'MAIN' and {CUBE}.duration_ms is not null";
  private static final String RATED = "{CUBE}.rating between 1 and 5";

  public static final OntologyObjectType APPLICATION = new OntologyObjectType(
      "easyv-ai-application", "AI 应用", "用户创建的 AI 大屏应用（仅未删除）",
      "EasyvApplication", "easyv-ai-application", "facts.easyv_ai_application", "not is_deleted",
      List.of(
          OntologyProperty.key("appId", "应用 ID", "app_id"),
          OntologyProperty.column("generationTaskId", "原型生成任务 ID", "应用关联的原型流水线任务",
              Type.STRING, "generation_task_id"),
          new OntologyProperty("userId", "创建用户 ID", "创建应用的 EasyV 用户", Type.STRING, "{CUBE}.user_id::text", false),
          new OntologyProperty("spaceId", "空间 ID", "应用所属空间", Type.STRING, "{CUBE}.space_id::text", false),
          new OntologyProperty("teamId", "团队 ID", "应用所属团队", Type.STRING, "{CUBE}.team_id::text", false),
          OntologyProperty.column("scopeType", "归属类型", "应用归属范围（USER 等）", Type.STRING, "scope_type"),
          OntologyProperty.column("createdAt", "应用创建时间", "应用创建时间", Type.TIME, "created_at")),
      List.of(),
      List.of(
          new OntologyMetric("count", "AI 应用数", "去重应用数", Aggregation.COUNT_DISTINCT, "{CUBE}.app_id", null),
          new OntologyMetric("userCount", "创建用户数", "创建过应用的去重用户数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.user_id", null)),
      "createdAt", List.of(), Map.of(SCOPE_USER, "userId"));

  public static final OntologyObjectType PROTOTYPE = new OntologyObjectType(
      "easyv-prototype", "原型", "进入原型流水线的应用（每个应用至多一条）",
      "EasyvPrototype", "easyv-prototype-task", "facts.easyv_prototype_task", null,
      List.of(
          OntologyProperty.key("appId", "应用 ID", "app_id"),
          OntologyProperty.column("createdAt", "原型创建时间", "原型创建时间", Type.TIME, "created_at"),
          OntologyProperty.column("updatedAt", "原型更新时间", "原型最近更新时间", Type.TIME, "updated_at")),
      List.of(new OntologyLink("application", APPLICATION.key(), "appId", "appId", Cardinality.ONE_TO_ONE)),
      List.of(new OntologyMetric("count", "原型数", "去重原型数", Aggregation.COUNT_DISTINCT, "{CUBE}.app_id", null)),
      "createdAt", List.of("application"), Map.of(SCOPE_USER, "application.userId"));

  private static final String PARSED = "{CUBE}.parse_status = 'ok'";

  public static final OntologyObjectType PROTOTYPE_LAYOUT = new OntologyObjectType(
      "easyv-prototype-layout", "原型版式", "原型的版式与结构签名（每个原型一条；无法解析的原型保留并标注原因）",
      "EasyvPrototypeLayout", "easyv-prototype-layout", "facts.easyv_prototype_layout", null,
      List.of(
          OntologyProperty.key("appId", "应用 ID", "app_id"),
          OntologyProperty.column("parseStatus", "解析状态",
              "ok / invalid_xml / invalid_json / inconsistent；非 ok 的原型没有区域、组件与签名",
              Type.STRING, "parse_status"),
          OntologyProperty.column("parseErrorCode", "解析错误码", "解析失败时的可定位错误码", Type.STRING, "parse_error_code"),
          OntologyProperty.column("layoutType", "布局类型", "凹形 / 左中右 / dashboard_02 等模板版式", Type.STRING, "layout_type"),
          OntologyProperty.column("blockCount", "区域数", "原型包含的区域（Block）数量", Type.NUMBER, "block_count"),
          OntologyProperty.column("componentCount", "图表组件数", "原型包含的图表组件数量", Type.NUMBER, "component_count"),
          OntologyProperty.column("layoutSignature", "版式签名（L1）",
              "布局类型 + 各区域位置/区域类型/尺寸/跨度相同则签名相同", Type.STRING, "layout_signature"),
          OntologyProperty.column("schemeSignature", "方案签名（L2）",
              "在版式签名基础上加上各区域所用图表方案", Type.STRING, "scheme_signature"),
          OntologyProperty.column("countSignature", "图表数签名（L3）",
              "在方案签名基础上加上各区域图表数量", Type.STRING, "count_signature"),
          OntologyProperty.column("chartSignature", "图表族签名（L4）",
              "在图表数签名基础上加上各区域图表族组合，最严格", Type.STRING, "chart_signature"),
          OntologyProperty.column("createdAt", "原型创建时间", "原型创建时间", Type.TIME, "created_at"),
          OntologyProperty.column("updatedAt", "原型更新时间", "原型最近更新时间", Type.TIME, "updated_at")),
      List.of(new OntologyLink("application", APPLICATION.key(), "appId", "appId", Cardinality.ONE_TO_ONE),
          new OntologyLink("blocks", "easyv-prototype-block", "appId", "appId", Cardinality.ONE_TO_MANY),
          new OntologyLink("components", "easyv-prototype-component", "appId", "appId", Cardinality.ONE_TO_MANY)),
      List.of(
          new OntologyMetric("count", "原型数", "含无法解析在内的去重原型数", Aggregation.COUNT_DISTINCT, "{CUBE}.app_id", null),
          new OntologyMetric("parsedCount", "已解析原型数", "结构可解析的去重原型数（重复分析的分母）",
              Aggregation.COUNT_DISTINCT, "{CUBE}.app_id", PARSED),
          new OntologyMetric("unparsedCount", "无法解析原型数", "结构无法解析的去重原型数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.app_id", "{CUBE}.parse_status <> 'ok'"),
          new OntologyMetric("blockTotal", "区域总数", "已解析原型的区域实例总数", Aggregation.SUM, "{CUBE}.block_count", PARSED),
          new OntologyMetric("componentTotal", "图表组件总数", "已解析原型的图表组件实例总数",
              Aggregation.SUM, "{CUBE}.component_count", PARSED),
          new OntologyMetric("layoutSignatureCount", "不同版式数（L1）", "去重版式签名数；已解析原型数减去它为每组保留一个后的额外原型数，不等于参与重复组的原型数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.layout_signature", PARSED),
          new OntologyMetric("schemeSignatureCount", "不同方案组合数（L2）", "去重方案签名数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.scheme_signature", PARSED),
          new OntologyMetric("countSignatureCount", "不同图表数组合数（L3）", "去重图表数签名数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.count_signature", PARSED),
          new OntologyMetric("chartSignatureCount", "不同图表族组合数（L4）", "去重图表族签名数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.chart_signature", PARSED)),
      "createdAt", List.of("application"), Map.of(SCOPE_USER, "application.userId"));

  public static final OntologyObjectType PROTOTYPE_BLOCK = new OntologyObjectType(
      "easyv-prototype-block", "原型区域", "原型版式中的区域（Block），含所用图表方案与尺寸类别",
      "EasyvPrototypeBlock", "easyv-prototype-block", "facts.easyv_prototype_block", null,
      List.of(
          new OntologyProperty("blockKey", "区域记录 ID", null, Type.STRING,
              "{CUBE}.source_id::text || ':' || {CUBE}.block_id", true),
          OntologyProperty.column("appId", "应用 ID", "区域所属应用", Type.STRING, "app_id"),
          OntologyProperty.column("blockId", "区域 ID", "布局树中的区域标识", Type.STRING, "block_id"),
          new OntologyProperty("position", "区域位置", "区域在版式中的位置标识（如 left_1）", Type.STRING,
              "regexp_replace({CUBE}.block_id, '^.*?__', '')", false),
          OntologyProperty.column("containerTag", "所在容器", "Sider / Header / Footer 等容器类型", Type.STRING, "container_tag"),
          OntologyProperty.column("gridDirection", "容器排布方向", "horizontal / vertical", Type.STRING, "grid_direction"),
          OntologyProperty.column("blockTypeId", "区域类型", "区域规格类型（决定可用图表方案集合）", Type.STRING, "block_type_id"),
          new OntologyProperty("blockSize", "区域尺寸", "small / medium / large；页眉页脚等区域源端未标注时为“未标注”",
              Type.STRING, "coalesce({CUBE}.block_size, '未标注')", false),
          OntologyProperty.column("span", "跨度", "区域在父容器排布方向上的占比", Type.STRING, "span"),
          OntologyProperty.column("schemeId", "图表方案", "区域采用的图表方案 ID", Type.STRING, "scheme_id"),
          OntologyProperty.column("componentCount", "图表数", "区域内的图表组件数量", Type.NUMBER, "component_count"),
          OntologyProperty.column("createdAt", "原型创建时间", "所属原型创建时间", Type.TIME, "created_at")),
      List.of(new OntologyLink("application", APPLICATION.key(), "appId", "appId", Cardinality.MANY_TO_ONE),
          new OntologyLink("layout", "easyv-prototype-layout", "appId", "appId", Cardinality.MANY_TO_ONE),
          new OntologyLink("components", "easyv-prototype-component", "blockKey", "blockKey", Cardinality.ONE_TO_MANY)),
      List.of(
          new OntologyMetric("count", "区域数", "区域实例数", Aggregation.COUNT, null, null),
          new OntologyMetric("appCount", "涉及原型数", "含这些区域的去重原型数", Aggregation.COUNT_DISTINCT, "{CUBE}.app_id", null),
          new OntologyMetric("componentTotal", "图表组件总数", "这些区域内的图表组件实例总数",
              Aggregation.SUM, "{CUBE}.component_count", null)),
      "createdAt", List.of("application"), Map.of(SCOPE_USER, "application.userId"));

  public static final OntologyObjectType PROTOTYPE_COMPONENT = new OntologyObjectType(
      "easyv-prototype-component", "原型图表组件", "原型区域内的图表组件实例（结构信息，不含标题与指标名称）",
      "EasyvPrototypeComponent", "easyv-prototype-component", "facts.easyv_prototype_component", null,
      List.of(
          new OntologyProperty("componentKey", "组件记录 ID", null, Type.STRING,
              "{CUBE}.source_id::text || ':' || {CUBE}.component_id", true),
          OntologyProperty.column("appId", "应用 ID", "组件所属应用", Type.STRING, "app_id"),
          OntologyProperty.column("blockId", "区域 ID", "组件所在区域", Type.STRING, "block_id"),
          new OntologyProperty("blockKey", "区域记录 ID", "组件所属源原型中的区域", Type.STRING,
              "{CUBE}.source_id::text || ':' || {CUBE}.block_id", false),
          OntologyProperty.column("componentId", "组件 ID", "布局中的组件标识", Type.STRING, "component_id"),
          OntologyProperty.column("gridCol", "网格列", "组件在区域网格中的起始列", Type.NUMBER, "grid_col"),
          OntologyProperty.column("gridRow", "网格行", "组件在区域网格中的起始行", Type.NUMBER, "grid_row"),
          OntologyProperty.column("chartFamily", "图表族", "line / donut / horizontal-bar / single-value-metric 等",
              Type.STRING, "chart_family"),
          OntologyProperty.column("libraryComponentId", "组件库 ID", "EasyV 组件库中的组件标识", Type.STRING, "library_component_id"),
          OntologyProperty.column("sceneType", "分析场景", "总览指标 / 趋势分析 / 对比排行 / 占比结构 等", Type.STRING, "scene_type"),
          OntologyProperty.column("sourceType", "数据来源类型", "AI 生成 / CSV 文件", Type.STRING, "source_type"),
          OntologyProperty.column("gridColSpan", "网格列跨度", "组件在区域网格中的列跨度", Type.NUMBER, "grid_col_span"),
          OntologyProperty.column("gridRowSpan", "网格行跨度", "组件在区域网格中的行跨度", Type.NUMBER, "grid_row_span"),
          OntologyProperty.column("createdAt", "原型创建时间", "所属原型创建时间", Type.TIME, "created_at")),
      List.of(new OntologyLink("application", APPLICATION.key(), "appId", "appId", Cardinality.MANY_TO_ONE),
          new OntologyLink("block", "easyv-prototype-block", "blockKey", "blockKey", Cardinality.MANY_TO_ONE)),
      List.of(
          new OntologyMetric("count", "图表组件数", "图表组件实例数", Aggregation.COUNT, null, null),
          new OntologyMetric("appCount", "涉及原型数", "含这些组件的去重原型数", Aggregation.COUNT_DISTINCT, "{CUBE}.app_id", null),
          new OntologyMetric("blockCount", "涉及区域数", "含这些组件的去重区域数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.source_id::text || ':' || {CUBE}.block_id", null)),
      "createdAt", List.of("application"), Map.of(SCOPE_USER, "application.userId"));

  public static final OntologyObjectType PIPELINE_NODE = new OntologyObjectType(
      "easyv-pipeline-node", "流水线节点", "原型流水线各阶段的节点执行记录",
      "EasyvPipelineNode", "easyv-pipeline-node", "facts.easyv_pipeline_node", null,
      List.of(
          new OntologyProperty("nodeId", "节点记录 ID", null, Type.STRING, "{CUBE}.source_id::text", true),
          OntologyProperty.column("taskId", "原型任务 ID", "节点所属原型流水线任务", Type.STRING, "task_id"),
          OntologyProperty.column("stepName", "阶段", "流水线阶段名称", Type.STRING, "step_name"),
          new OntologyProperty("branch", "分支", "MAIN 为主链", Type.STRING, "upper({CUBE}.branch)", false),
          new OntologyProperty("status", "节点状态", "节点执行状态", Type.STRING, "upper({CUBE}.status)", false),
          OntologyProperty.column("durationMs", "节点耗时（毫秒）", "节点执行耗时", Type.NUMBER, "duration_ms"),
          OntologyProperty.column("createdAt", "节点时间", "节点记录时间", Type.TIME, "created_at")),
      List.of(new OntologyLink("application", APPLICATION.key(), "taskId", "generationTaskId",
          Cardinality.MANY_TO_ONE)),
      List.of(
          new OntologyMetric("count", "节点记录数", "节点记录数", Aggregation.COUNT, null, null),
          new OntologyMetric("taskCount", "原型任务数", "有节点记录的去重原型任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", null),
          new OntologyMetric("mainTimedCount", "可计时主链节点数", "有耗时的 MAIN 主链节点数",
              Aggregation.COUNT, null, MAIN_TIMED),
          new OntologyMetric("durationP50Ms", "主链节点耗时 P50（毫秒）", "MAIN 主链节点耗时中位数",
              Aggregation.PERCENTILE_50, "{CUBE}.duration_ms", MAIN_TIMED),
          new OntologyMetric("durationP95Ms", "主链节点耗时 P95（毫秒）", "MAIN 主链节点耗时 P95",
              Aggregation.PERCENTILE_95, "{CUBE}.duration_ms", MAIN_TIMED)),
      "createdAt", List.of("application"), Map.of(SCOPE_USER, "application.userId"));

  public static final OntologyObjectType PIPELINE_TASK = new OntologyObjectType(
      "easyv-pipeline-task", "原型流水线任务", "按原型任务归并的流水线结果（由节点记录归并）",
      "EasyvPipelineTask", "easyv-pipeline-node", "facts.easyv_pipeline_task", null,
      List.of(
          OntologyProperty.key("taskId", "原型任务 ID", "task_id"),
          OntologyProperty.column("outcome", "流水线结果", "completed / failed / incomplete / conflict",
              Type.STRING, "outcome"),
          OntologyProperty.column("nodeCount", "节点记录数", "任务的节点记录数", Type.NUMBER, "node_count"),
          OntologyProperty.column("startedAt", "任务开始时间", "首个节点记录时间", Type.TIME, "started_at"),
          OntologyProperty.column("lastNodeAt", "最近节点时间", "最后一个节点记录时间", Type.TIME, "last_node_at")),
      List.of(new OntologyLink("application", APPLICATION.key(), "taskId", "generationTaskId",
          Cardinality.ONE_TO_ONE)),
      List.of(
          new OntologyMetric("count", "原型任务数", "去重原型任务数", Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", null),
          new OntologyMetric("completedCount", "完成任务数", "主链完成且无失败的任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", "{CUBE}.outcome = 'completed'"),
          new OntologyMetric("failedCount", "失败任务数", "主链出现失败的任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", "{CUBE}.outcome = 'failed'"),
          new OntologyMetric("incompleteCount", "未完成任务数", "既未完成也未失败的任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", "{CUBE}.outcome = 'incomplete'"),
          OntologyMetric.ratio("completionRate", "原型完成率（%）", "完成任务数 / 原型任务数",
              "completedCount", "count")),
      "startedAt", List.of("application"), Map.of(SCOPE_USER, "application.userId"));

  public static final OntologyObjectType FORGE_TASK = new OntologyObjectType(
      "easyv-forge-task", "应用生成任务", "Forge 生成任务（每次生成一条）",
      "EasyvForgeTask", "easyv-forge-task", "facts.easyv_forge_generation_task", null,
      List.of(
          OntologyProperty.key("taskId", "生成任务 ID", "task_id"),
          OntologyProperty.column("appId", "应用 ID", "任务所属应用", Type.STRING, "app_id"),
          new OntologyProperty("status", "任务状态", "completed / failed / cancelled / 进行中",
              Type.STRING, "lower({CUBE}.status)", false),
          new OntologyProperty("failureReason", "失败原因", "失败原因原文；无记录时为“（无失败原因记录）”",
              Type.STRING, "coalesce(nullif({CUBE}.failure_reason, ''), '（无失败原因记录）')", false),
          OntologyProperty.column("createdAt", "任务创建时间", "任务创建时间", Type.TIME, "created_at"),
          OntologyProperty.column("startedAt", "开始时间", "任务开始执行时间", Type.TIME, "started_at"),
          OntologyProperty.column("finishedAt", "结束时间", "任务结束时间", Type.TIME, "finished_at")),
      List.of(new OntologyLink("application", APPLICATION.key(), "appId", "appId", Cardinality.MANY_TO_ONE)),
      List.of(
          new OntologyMetric("count", "生成任务数", "去重生成任务数", Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", null),
          new OntologyMetric("completedCount", "成功任务数", "状态为 completed 的任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", "lower({CUBE}.status) = 'completed'"),
          new OntologyMetric("failedCount", "失败任务数", "状态为 failed 的任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", "lower({CUBE}.status) = 'failed'"),
          new OntologyMetric("cancelledCount", "取消任务数", "状态为 cancelled 的任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", "lower({CUBE}.status) = 'cancelled'"),
          new OntologyMetric("terminalCount", "终态任务数", "completed/failed/cancelled 任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", TERMINAL),
          new OntologyMetric("timedTerminalCount", "可计时终态任务数", "有开始与结束时间的终态任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", TIMED_TERMINAL),
          new OntologyMetric("durationP50Ms", "耗时 P50（毫秒）", "终态任务耗时中位数",
              Aggregation.PERCENTILE_50, DURATION_MS, TIMED_TERMINAL),
          new OntologyMetric("durationP95Ms", "耗时 P95（毫秒）", "终态任务耗时 P95",
              Aggregation.PERCENTILE_95, DURATION_MS, TIMED_TERMINAL),
          OntologyMetric.ratio("successRate", "生成成功率（%）", "成功任务数 / 终态任务数",
              "completedCount", "terminalCount"),
          OntologyMetric.ratio("failureRate", "生成失败率（%）", "失败任务数 / 终态任务数",
              "failedCount", "terminalCount")),
      "createdAt", List.of("application"), Map.of(SCOPE_USER, "application.userId"));

  public static final OntologyObjectType FEEDBACK = new OntologyObjectType(
      "easyv-generation-feedback", "操作反馈", "用户对 AI 生成结果的操作记录（评分、另存、组合执行）",
      "EasyvFeedback", "easyv-generation-feedback", "facts.easyv_generation_feedback", null,
      List.of(
          new OntologyProperty("operationId", "操作记录 ID", null, Type.STRING, "{CUBE}.source_id::text", true),
          new OntologyProperty("userId", "操作用户 ID", "执行操作的 EasyV 用户", Type.STRING, "{CUBE}.user_id::text", false),
          new OntologyProperty("spaceId", "空间 ID", "操作所在空间", Type.STRING, "{CUBE}.space_id::text", false),
          OntologyProperty.column("appId", "应用 ID", "操作关联的应用", Type.STRING, "app_id"),
          OntologyProperty.column("actionType", "操作类型", "AI 操作类型", Type.STRING, "ai_action_type"),
          new OntologyProperty("executeResult", "执行结果", "组合成功 / 组合失败", Type.STRING,
              "case {CUBE}.execute_result when 1 then '组合成功' when 0 then '组合失败' end", false),
          OntologyProperty.column("rating", "评分", "1-5 分，未评分为空", Type.NUMBER, "rating"),
          OntologyProperty.column("saveAsEdit", "是否另存编辑", "是否另存为编辑", Type.BOOLEAN, "is_save_as_edit"),
          OntologyProperty.column("operatedAt", "操作时间", "用户操作时间", Type.TIME, "operated_at")),
      List.of(new OntologyLink("application", APPLICATION.key(), "appId", "appId", Cardinality.MANY_TO_ONE)),
      List.of(
          new OntologyMetric("count", "操作记录数", "操作记录数", Aggregation.COUNT, null, null),
          new OntologyMetric("userCount", "操作用户数", "去重操作用户数", Aggregation.COUNT_DISTINCT, "{CUBE}.user_id", null),
          new OntologyMetric("ratedCount", "有效评分数", "1-5 分的评分记录数", Aggregation.COUNT, null, RATED),
          new OntologyMetric("averageRating", "平均评分", "有效评分的平均值", Aggregation.AVG, "{CUBE}.rating", RATED),
          new OntologyMetric("saveAsEditCount", "另存编辑数", "另存为编辑的记录数",
              Aggregation.COUNT, null, "{CUBE}.is_save_as_edit is true"),
          new OntologyMetric("successCount", "组合成功数", "execute_result=1 的记录数",
              Aggregation.COUNT, null, "{CUBE}.execute_result = 1"),
          new OntologyMetric("failureCount", "组合失败数", "execute_result=0 的记录数",
              Aggregation.COUNT, null, "{CUBE}.execute_result = 0"),
          OntologyMetric.ratio("successRate", "组合成功率（%）", "组合成功数 / 操作记录数", "successCount", "count")),
      "operatedAt", List.of("application"), Map.of(SCOPE_USER, "userId"));

  public static final List<OntologyObjectType> OBJECTS =
      List.of(APPLICATION, PROTOTYPE, PROTOTYPE_LAYOUT, PROTOTYPE_BLOCK, PROTOTYPE_COMPONENT,
          PIPELINE_NODE, PIPELINE_TASK, FORGE_TASK, FEEDBACK);

  @Override
  public String domainKey() {
    return EasyVGenerationOntology.DOMAIN_KEY;
  }

  @Override
  public ZoneId businessZone() {
    return BUSINESS_ZONE;
  }

  @Override
  public List<OntologyObjectType> objects() {
    return OBJECTS;
  }
}
