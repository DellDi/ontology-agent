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
import java.util.Set;

/**
 * EasyV 本体对象声明：Cube 模型与对象/动作工具的唯一来源。
 * 口径与 canonical facts 冻结语义一致：应用只含未删除记录（tombstone 保留在 facts 中供复核）；
 * 原型、流水线、生成任务与反馈没有独立删除字段，通过成员资格关系跟随未删除应用。
 * 授权范围按 EasyV 创建用户（{@code userId}）限定。
 */
public final class EasyVOntologyModel implements OntologyModelContribution {
  public static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
  public static final String SCOPE_USER = "userId";

  // 原始业务码及其含义归领域声明所有；展示客户端与模型共享这些元数据。
  private static final Map<String, String> QUALITY_INTENTS = Map.ofEntries(
      Map.entry("ACK", "感谢与闲聊"),
      Map.entry("CLARIFY", "需要补充说明"),
      Map.entry("OUT_OF_SCOPE", "当次被判为不支持"),
      Map.entry("BLOCK_REPLACE_CHART", "更换图表类型"),
      Map.entry("BLOCK_REPLACE_FROM_POOL", "选用已有主题或指标"),
      Map.entry("BLOCK_REPLACE_FROM_POOL_METRIC", "选用已有指标"),
      Map.entry("BLOCK_REPLACE_BY_DIALOG", "按描述修改内容"),
      Map.entry("BLOCK_REPLACE_BY_CSV_DERIVE", "根据数据文件修改内容"),
      Map.entry("BLOCK_DELETE_METRIC", "删除指标"),
      Map.entry("BLOCK_ADD_METRIC", "新增指标"),
      Map.entry("BLOCK_REPLACE_THEME", "更换主题"),
      Map.entry("BLOCK_REPLACE_METRIC", "更换指标"),
      Map.entry("BLOCK_MODIFY_CALIBER", "修改指标口径"),
      Map.entry("BLOCK_REPLACE_TITLE", "修改模块标题"),
      Map.entry("BLOCK_DELETE", "删除模块"),
      Map.entry("BLOCK_ADD", "新增模块"),
      Map.entry("GENERATE_TO_POOL", "扩充候选指标"),
      Map.entry("MAIN_CONTENT_REGENERATE", "重做主视觉"),
      Map.entry("MAIN_CONTENT_ADD", "新增主视觉内容"),
      Map.entry("MAIN_CONTENT_DELETE", "删除主视觉内容"),
      Map.entry("MAIN_CONTENT_REPLACE", "替换主视觉内容"),
      Map.entry("GLOBAL_REGENERATE", "重新生成整屏"),
      Map.entry("GLOBAL_LAYOUT_SWITCH", "更换整屏布局"),
      Map.entry("GLOBAL_REPLACE_TITLE", "修改大屏标题"),
      Map.entry("INTERACTION_CONFIGURE", "配置组件交互"));
  private static final Map<String, String> QUALITY_STAGES = Map.ofEntries(
      Map.entry("Step1", "生成前的需求理解"),
      Map.entry("ChatExecution", "对话处理"));
  private static final Map<String, String> QUALITY_STATUS = Map.ofEntries(
      Map.entry("SUCCESS", "处理完成"),
      Map.entry("FAILED", "处理失败"),
      Map.entry("FALLBACK", "使用降级方案"));
  private static final Map<String, String> OPERATION_TYPES = Map.ofEntries(
      Map.entry("prototypeGeneration", "生成或重做大屏"),
      Map.entry("promptCompletion", "完善生成需求"),
      Map.entry("chatRefactor", "对话修改"),
      Map.entry("metricGeneration", "扩充指标"),
      Map.entry("appGeneration", "生成与另存反馈"));


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
          OntologyProperty.identifier("generationTaskId", "原型生成任务 ID", "应用关联的原型流水线任务",
              "generation_task_id"),
          new OntologyProperty("userId", "创建用户 ID", "创建应用的 EasyV 用户", Type.STRING, "{CUBE}.user_id::text", false, true),
          new OntologyProperty("spaceId", "空间 ID", "应用所属空间", Type.STRING, "{CUBE}.space_id::text", false, true),
          new OntologyProperty("teamId", "团队 ID", "应用所属团队", Type.STRING, "{CUBE}.team_id::text", false, true),
          OntologyProperty.column("scopeType", "归属类型", "应用归属范围（USER 等）", Type.STRING, "scope_type").display(false, false, Map.of("USER", "个人", "TEAM", "团队", "SPACE", "空间")),
          OntologyProperty.column("createdAt", "应用创建时间", "应用创建时间", Type.TIME, "created_at")),
      List.of(new OntologyLink("operations", "easyv-generation-feedback", "appId", "appId", Cardinality.ONE_TO_MANY),
          new OntologyLink("layout", "easyv-prototype-layout", "appId", "appId", Cardinality.ONE_TO_ONE),
          new OntologyLink("qualityNodes", "easyv-quality-node", "appId", "appId", Cardinality.ONE_TO_MANY)),
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
          new OntologyProperty("pageTitle", "大屏标题", "源原型只有一页时的页面标题；多页需读取页面与主视觉详情", Type.STRING,
              "CASE WHEN jsonb_array_length({CUBE}.page_semantics)=1 THEN {CUBE}.page_semantics->0->>'title' END", false).display(true, true, Map.of()),
          OntologyProperty.detailText("pageSemantics", "页面与主视觉", "源原型的页面标题和主视觉业务文案；不代表最终渲染或实际数据", "{CUBE}.page_semantics::text").display(false, true, Map.of()),
          OntologyProperty.column("parseStatus", "解析状态",
              "ok / invalid_xml / invalid_json / inconsistent；非 ok 的原型没有区域、组件与签名",
              Type.STRING, "parse_status"),
          OntologyProperty.column("parseErrorCode", "解析错误码", "解析失败时的可定位错误码", Type.STRING, "parse_error_code"),
          OntologyProperty.column("layoutType", "布局类型", "凹形 / 左中右 / dashboard_02 等模板版式", Type.STRING, "layout_type"),
          OntologyProperty.column("blockCount", "区域数", "原型包含的区域（Block）数量", Type.NUMBER, "block_count"),
          OntologyProperty.column("componentCount", "图表组件数", "原型包含的图表组件数量", Type.NUMBER, "component_count"),
          OntologyProperty.identifier("layoutSignature", "版式签名（L1）",
              "布局类型 + 各区域位置/区域类型/尺寸/跨度相同则签名相同", "layout_signature"),
          OntologyProperty.identifier("schemeSignature", "方案签名（L2）",
              "在版式签名基础上加上各区域所用图表方案", "scheme_signature"),
          OntologyProperty.identifier("countSignature", "图表数签名（L3）",
              "在方案签名基础上加上各区域图表数量", "count_signature"),
          OntologyProperty.identifier("chartSignature", "图表族签名（L4）",
              "在图表数签名基础上加上各区域图表族组合，最严格", "chart_signature"),
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
          OntologyProperty.identifier("pageId", "页面 ID", "源导出页面标识", "page_id"),
          OntologyProperty.column("pageTitle", "所属大屏", "该区域所在源页面的标题", Type.STRING, "page_title").display(false, true, Map.of()),
          OntologyProperty.column("blockTitle", "模块标题", "源原型中的区域标题，标识兜底不当作业务名称", Type.STRING, "block_title").display(true, true, Map.of()),
          OntologyProperty.column("businessModule", "业务模块", "源原型明确保存的业务模块，不按结构推断", Type.STRING, "business_module").display(false, true, Map.of()),
          OntologyProperty.detailText("moduleDescription", "模块目的", "源原型中的模块说明", "{CUBE}.module_description").display(false, true, Map.of()),
          OntologyProperty.detailText("interactionDescription", "交互说明", "源原型中的交互说明，不证明交互已生效", "{CUBE}.interaction_description").display(false, true, Map.of()),
          OntologyProperty.identifier("appId", "应用 ID", "区域所属应用", "app_id"),
          OntologyProperty.identifier("blockId", "区域 ID", "布局树中的区域标识", "block_id"),
          new OntologyProperty("position", "区域位置", "区域在版式中的位置标识（如 left_1）", Type.STRING,
              "regexp_replace({CUBE}.block_id, '^.*?__', '')", false),
          OntologyProperty.column("containerTag", "所在容器", "Sider / Header / Footer 等容器类型", Type.STRING, "container_tag"),
          OntologyProperty.column("gridDirection", "容器排布方向", "horizontal / vertical", Type.STRING, "grid_direction"),
          OntologyProperty.column("blockTypeId", "区域类型", "区域规格类型（决定可用图表方案集合）", Type.STRING, "block_type_id"),
          new OntologyProperty("blockSize", "区域尺寸", "small / medium / large；页眉页脚等区域源端未标注时为“未标注”",
              Type.STRING, "coalesce({CUBE}.block_size, '未标注')", false),
          OntologyProperty.column("span", "跨度", "区域在父容器排布方向上的占比", Type.STRING, "span"),
          OntologyProperty.identifier("schemeId", "图表方案", "区域采用的图表方案 ID", "scheme_id"),
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
          OntologyProperty.column("metricName", "指标名称", "源组件中的指标名称，不代表指标已核实", Type.STRING, "metric_name").display(true, true, Map.of()),
          OntologyProperty.detailText("metricDescription", "指标含义", "源组件中的指标明细说明", "{CUBE}.metric_description").display(false, true, Map.of()),
          OntologyProperty.detailText("metricInsight", "业务看点", "源组件中的业务看点", "{CUBE}.metric_insight").display(false, true, Map.of()),
          OntologyProperty.column("metricUnit", "指标单位", "通过明确且唯一的指标绑定读取；未保存或绑定不明确时为空", Type.STRING, "metric_unit").display(false, true, Map.of()),
          OntologyProperty.detailText("aggregationRule", "指标口径", "源绑定指标的聚合规则；未核验业务数据正确性", "{CUBE}.aggregation_rule").display(false, true, Map.of()),
          OntologyProperty.identifier("appId", "应用 ID", "组件所属应用", "app_id"),
          OntologyProperty.identifier("blockId", "区域 ID", "组件所在区域", "block_id"),
          new OntologyProperty("blockKey", "区域记录 ID", "组件所属源原型中的区域", Type.STRING,
              "{CUBE}.source_id::text || ':' || {CUBE}.block_id", false, true),
          OntologyProperty.identifier("componentId", "组件 ID", "布局中的组件标识", "component_id"),
          OntologyProperty.column("gridCol", "网格列", "组件在区域网格中的起始列", Type.NUMBER, "grid_col"),
          OntologyProperty.column("gridRow", "网格行", "组件在区域网格中的起始行", Type.NUMBER, "grid_row"),
          OntologyProperty.column("chartFamily", "图表族", "line / donut / horizontal-bar / single-value-metric 等",
              Type.STRING, "chart_family"),
          OntologyProperty.identifier("libraryComponentId", "组件库 ID", "EasyV 组件库中的组件标识", "library_component_id"),
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
          OntologyProperty.identifier("taskId", "原型任务 ID", "节点所属原型流水线任务", "task_id"),
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
          OntologyProperty.identifier("appId", "应用 ID", "任务所属应用", "app_id"),
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
      "easyv-generation-feedback", "操作反馈", "生成需求、对话轮次、另存与评分的操作记录；一行是操作，不保证是有效修改",
      "EasyvFeedback", "easyv-generation-feedback", "facts.easyv_generation_feedback", null,
      List.of(
          new OntologyProperty("operationId", "操作记录 ID", null, Type.STRING, "{CUBE}.source_id::text", true),
          new OntologyProperty("userId", "操作用户 ID", "执行操作的 EasyV 用户", Type.STRING, "{CUBE}.user_id::text", false, true),
          new OntologyProperty("spaceId", "空间 ID", "操作所在空间", Type.STRING, "{CUBE}.space_id::text", false, true),
          OntologyProperty.identifier("appId", "应用 ID", "操作关联的应用", "app_id"),
          OntologyProperty.column("actionType", "操作类型",
              "prototypeGeneration=生成或整屏重做；promptCompletion=需求润色；chatRefactor=对话轮次（含闲聊、澄清、不支持，非有效修改）；metricGeneration=指标池扩充；appGeneration=组合生成/另存反馈", Type.STRING, "ai_action_type").display(true, false, OPERATION_TYPES),
          OntologyProperty.identifier("taskId", "操作任务 ID", "关联节点的任务；一个任务可有多个执行节点，不把节点数当轮次", "task_id"),
          new OntologyProperty("executeResult", "执行结果", "源端操作结果，混合业务执行与积分结算；成功不证明诉求满足", Type.STRING,
              "case {CUBE}.execute_result when 1 then '记录成功' when 0 then '记录失败' end", false)
              .display(false, false, Map.of("记录成功", "日志记为成功", "记录失败", "日志记为失败")),
          OntologyProperty.column("rating", "评分", "整屏评分 1-5；单轮赞/踩为 4/2，两类不可混作满意度，未评分为空", Type.NUMBER, "rating"),
          OntologyProperty.column("saveAsEdit", "是否另存编辑", "该条生成反馈的另存标记；只更新当时最近 appGeneration 行。有过另存不代表最终版本已另存，也不等于满意", Type.BOOLEAN, "is_save_as_edit"),
          OntologyProperty.column("userInputTruncated", "用户原话已截断", "null 为旧冻结版本未采；true 表示只保留前 4000 字符", Type.BOOLEAN, "user_input_truncated"),
          OntologyProperty.column("failureReasonTruncated", "失败原因已截断", "null 为旧冻结版本未采", Type.BOOLEAN, "failure_reason_truncated"),
          OntologyProperty.identifier("userInputHash", "原话分组键", "完整原话的 SHA-256；不能据此判断诉求相似", "user_input_hash"),
          OntologyProperty.identifier("failureReasonHash", "失败原因分组键", "完整失败原因的 SHA-256，不证明根因相同", "failure_reason_hash"),
          OntologyProperty.detailText("userInput", "用户原话", "操作日志中的用户输入，唯一来源 operation_log.user_input；按同任务对照理解。不是包含提示词补全、附件和模板的完整模型输入；仅单对象详情可读", "{CUBE}.user_input").display(false, true, Map.of()),
          OntologyProperty.detailText("failureReason", "操作失败原因", "源端失败自述，不直接证明根因", "{CUBE}.failure_reason").display(false, true, Map.of()),
          OntologyProperty.column("operatedAt", "操作记录时间", "操作日志落库时间，不等于用户提交或生成开始时间；生成结束结算时可晚于同任务的理解节点", Type.TIME, "operated_at")),
      List.of(new OntologyLink("application", APPLICATION.key(), "appId", "appId", Cardinality.MANY_TO_ONE),
          new OntologyLink("layout", PROTOTYPE_LAYOUT.key(), "appId", "appId", Cardinality.MANY_TO_ONE),
          new OntologyLink("qualityNodes", "easyv-quality-node", "taskId", "taskId", Cardinality.ONE_TO_MANY)),
      List.of(
          new OntologyMetric("count", "操作记录数", "操作记录数", Aggregation.COUNT, null, null),
          new OntologyMetric("appCount", "涉及应用数", "有操作反馈的去重应用数", Aggregation.COUNT_DISTINCT, "{CUBE}.app_id", null),
          new OntologyMetric("chatRoundCount", "对话轮次数", "chatRefactor 操作数，包含非修改对话", Aggregation.COUNT, null, "{CUBE}.ai_action_type = 'chatRefactor'"),
          new OntologyMetric("adoptedAppCount", "另存采纳应用数", "至少另存一次的去重应用数，不等于满意", Aggregation.COUNT_DISTINCT, "{CUBE}.app_id", "{CUBE}.is_save_as_edit is true"),
          new OntologyMetric("userCount", "操作用户数", "去重操作用户数", Aggregation.COUNT_DISTINCT, "{CUBE}.user_id", null),
          new OntologyMetric("ratedCount", "有效评分数", "1-5 分的评分记录数", Aggregation.COUNT, null, RATED),
          new OntologyMetric("averageRating", "平均评分", "有效评分的平均值", Aggregation.AVG, "{CUBE}.rating", RATED),
          new OntologyMetric("saveAsEditCount", "另存编辑数", "另存为编辑的记录数",
              Aggregation.COUNT, null, "{CUBE}.is_save_as_edit is true"),
          new OntologyMetric("successCount", "记录成功数", "execute_result=1 的记录数",
              Aggregation.COUNT, null, "{CUBE}.execute_result = 1"),
          new OntologyMetric("failureCount", "记录失败数", "execute_result=0 的记录数",
              Aggregation.COUNT, null, "{CUBE}.execute_result = 0"),
          OntologyMetric.ratio("successRate", "记录成功率（%）", "execute_result=1 / 操作记录数，不代表需求满足率", "successCount", "count")),
      "operatedAt", List.of("application"), Map.of(SCOPE_USER, "userId"));

  /** 同一流水线产品的质量投影；保留多指令、多执行节点，不擅自选最后一条意图。 */
  public static final OntologyObjectType QUALITY_NODE = new OntologyObjectType(
      "easyv-quality-node", "需求与处理记录", "Step1 系统理解与 ChatExecution 记录；需关联真实操作记录。意图标签需原话抽样校准，节点数不等于轮次",
      "EasyvQualityNode", "easyv-pipeline-node", "facts.easyv_pipeline_node",
      "(branch = 'MAIN' and step_name = 'Step1') or (branch = 'CHAT' and step_name = 'ChatExecution')",
      List.of(
          new OntologyProperty("nodeId", "节点记录 ID", null, Type.STRING, "{CUBE}.source_id::text", true),
          OntologyProperty.identifier("taskId", "操作任务 ID", "关联操作记录的任务；可对应多个执行节点", "task_id"),
          OntologyProperty.identifier("appId", "应用 ID", "由同次采集的操作 task_id 精确关联", "app_id"),
          OntologyProperty.identifier("sessionId", "源端会话 ID", "源端会话关联，不是本平台分析会话", "session_id"),
          OntologyProperty.detailText("pageTitle", "生成页面标题", "生成规划标题，非用户原话", "{CUBE}.quality_evidence ->> 'pageTitle'").display(true, true, Map.of()),
          OntologyProperty.column("intent", "系统识别的诉求", "ACK/CLARIFY/OUT_OF_SCOPE 为非修改；其余标签也须原话抽样，不保证准确", Type.STRING, "intent").display(true, false, QUALITY_INTENTS),
          OntologyProperty.column("stepName", "处理环节", "Step1=生成理解；ChatExecution=修改执行", Type.STRING, "step_name").display(true, false, QUALITY_STAGES),
          OntologyProperty.column("status", "处理状态", "源端 SUCCESS/FAILED/FALLBACK，不证明诉求满足或最终渲染质量", Type.STRING, "status").display(false, true, QUALITY_STATUS),
          OntologyProperty.identifier("targetBlockId", "目标区域 ID", "仅部分意图记录；缺失不能推断为整屏操作", "target_block_id"),
          OntologyProperty.column("industryCategory", "系统理解的行业", "Step1 分类，非独立业务事实", Type.STRING, "industry_category"),
          OntologyProperty.column("audienceType", "系统理解的受众", "Step1 分类，非独立业务事实", Type.STRING, "audience_type"),
          OntologyProperty.column("evidenceStatus", "理解证据状态", "available/missing/invalid/not_applicable；旧冻结版本为空", Type.STRING, "quality_evidence_status").display(false, false, Map.of("available", "已采集", "missing", "未采集到", "invalid", "格式有误", "not_applicable", "此环节不适用")),
          OntologyProperty.column("evidenceErrorCode", "理解证据错误码", "缺失或格式错误的可定位原因", Type.STRING, "quality_evidence_error_code"),
          OntologyProperty.detailText("coreIntent", "系统理解的核心意图", "须与用户原话对照，不认证理解正确", "{CUBE}.quality_evidence ->> 'coreIntent'").display(false, true, Map.of()),
          OntologyProperty.detailText("screenObjective", "系统理解的页面目标", "限定字段的 JSON 文本，非完整原始输出", "{CUBE}.quality_evidence ->> 'screenObjective'"),
          OntologyProperty.detailText("themes", "生成模块与需求约束", "系统规划；USER 约束保留 origin/text/evidence，不能混同规划补充", "{CUBE}.quality_evidence ->> 'themes'"),
          OntologyProperty.detailText("interactionRequests", "交互诉求与支持边界", "保留原指令、支持标记及原因，是否真正实现仍需独立证据", "{CUBE}.quality_evidence ->> 'interactionRequests'"),
          OntologyProperty.detailText("truncatedFields", "已截断的理解字段", "明确列出截断路径；不能把截断文本当完整原文", "{CUBE}.quality_evidence ->> 'truncatedFields'"),
          OntologyProperty.column("createdAt", "发生时间", "源端节点时间", Type.TIME, "created_at")),
      List.of(new OntologyLink("operations", FEEDBACK.key(), "taskId", "taskId", Cardinality.ONE_TO_MANY, true),
          new OntologyLink("application", APPLICATION.key(), "appId", "appId", Cardinality.MANY_TO_ONE),
          new OntologyLink("layout", PROTOTYPE_LAYOUT.key(), "appId", "appId", Cardinality.MANY_TO_ONE)),
      List.of(new OntologyMetric("count", "处理记录数", "节点记录数，不等于修改轮次", Aggregation.COUNT, null, null),
          new OntologyMetric("taskCount", "涉及请求数", "去重 task_id；按意图分组时一个多指令任务可出现在多组，不能相加为轮次总量", Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", null)),
      "createdAt", List.of("application"), Map.of(SCOPE_USER, "application.userId"));


  public static final List<OntologyObjectType> OBJECTS =
      List.of(APPLICATION, PROTOTYPE, PROTOTYPE_LAYOUT, PROTOTYPE_BLOCK, PROTOTYPE_COMPONENT,
          PIPELINE_NODE, PIPELINE_TASK, FORGE_TASK, FEEDBACK, QUALITY_NODE);

  /** 对象读取、选择与统计下钻开放的对象；新增对象须同步共享契约枚举（契约测试校验）。 */
  public static final Set<String> READABLE_OBJECT_KEYS =
      Set.of(APPLICATION.key(), PROTOTYPE_LAYOUT.key(), PROTOTYPE_BLOCK.key(), PROTOTYPE_COMPONENT.key(),
          FEEDBACK.key(), QUALITY_NODE.key(), FORGE_TASK.key());

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
