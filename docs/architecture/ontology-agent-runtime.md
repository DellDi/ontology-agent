# Ontology Agent Runtime：本体契约 + 受治理工具 + 多步智能体

> **文档定位（Living Spec）**：本文档维护运行时语义层、时间语义、受治理工具边界、A/B/C/D 当前分阶段基线与架构约束的**当前系统真相**。
> - 历史实施与验收流水账（2026-09-24 至 2026-10-19，原第 9–14.34 节）已无损归档至 [历史实施与验收流水账](../acceptance/archive/ontology-agent-runtime-2026-09-10-log.md)。
> - 文档总导航见 [docs/README.md](../README.md)；环境隔离与数据真相见 [环境与数据说明](../environments.md) 与 [easyv-dev 部署说明](../easyv-dev-deployment.md)。
> - 与现有基线关系：沿用 [Multi-domain Runtime Architecture](./multi-domain-runtime-architecture.md) 的 Capability、binding、Job pin、证据与审计主链，并按本文 §7 调整原“Main Agent 只调用一次 workflow tool”约束；Java 分层继续遵循 [Java Architecture Baseline](./java-architecture-baseline.md)。
>
> **当前基线总览（基于源码与最新验收回执）**：
> - **A 语义问数**：已完成并部署上线（归档日志 [§9](../acceptance/archive/ontology-agent-runtime-2026-09-10-log.md#9-a0-验证结果2026-09-24已通过)、[§10](../acceptance/archive/ontology-agent-runtime-2026-09-10-log.md#10-a-阶段实施与评测结果2026-09-29)）。
> - **B 对象与智能体**：已完成工程收尾并发布，详见 [B 工程收尾验收](../acceptance/b-closeout.md)；「30 份样本业务评分校准」与「159 条历史可变快照输入认证 / 上游新增不可变输入留证」继续保留独立门禁。
> - **C 动作闭环（普通原型块）**：原执行实现（含源端分支）已完成用户流程验收；2026-10-19 按“业务源项目原则上不改造”调整为本项目内数据库写回适配器（`EasyVBlockActionDatabaseAdapter`，复用 V32 动作与确认/审计链，`EASYV_ACTION_ENABLED` 默认关闭）。本地与授权测试业务源文案写回及缓存同步已验证，**公司环境写回未启用，新适配器公司发布与全流程重验尚未执行**，详见 [C 块内改造](../acceptance/easyv-block-improvement-plan.md) 与 [写回适配器](../acceptance/easyv-writeback-adapter.md)。
> - **D 一批大屏的检查与改进**：首批推进中（2026-10-25 目标修订、2026-10-31 确认）。D1 数据健康与 D2 生成失败巡检已发布公司；目录发起检查（`/api/easyv/workspace/prototypes/review`）、整批续接、批量全部区域/指标依据读取与单指标块文案候选约束已补齐本地实现，**完整 D 业务验收未通过且尚未发布公司**，详见 [D 专项计划](../acceptance/d-operations-plan.md)。
> - **V33–V35 近期领域扩展**：V33 核心指标区域与全量刷新（2026-10-27）已发布公司并同步本地快照（[核心指标刷新](../acceptance/easyv-core-metrics-refresh.md)）；V34 原型动态面板（2026-10-31）已完成代码与本地契约测试、未发布公司且待真源快照验收（[原型动态面板接入](../acceptance/easyv-dynamic-panels.md)）；**V35 图表配置规则与后台配置审计（2026-11-05）已发布公司 test（`easyv-dev`，版本 `chart-config-20261105-e2e15d1c92`、集合 `ingest-650b7225-0f93-4404-bbd6-3edf665dfc84`，含 13 类产品），Cube 统计与权限隔离通过；常驻发布 Worker 原只读账号尚缺四张新表 SELECT，且本地业务快照（2026-10-27）未同步**（[图表规则与后台配置审计接入](../acceptance/easyv-chart-configuration.md)）。
> - **Property 域**：代码维持 `PROPERTY_DOMAIN_ENABLED` 开关控制，本地与 `easyv-dev` 均显式关闭（封存），恢复仍依赖真实 ERP 数据接入与 Neo4j 投影验收。

---

## 1. 为什么调整

2026-09-24 真实部署端到端验收暴露的问题不是单点缺陷，而是结构性不灵活：

| 原状 | 位置 | 后果 |
|---|---|---|
| 时间由服务端正则识别（本周/上周/近7天/本月/ISO） | `EasyVDateRange`、`EasyVFollowUpPolicy`、追问建议改写 | “最近30天”等常见说法失败；未识别时静默放大为全量（fail hidden） |
| 20 条无参数固定 SQL | `EasyVQueryCatalog` + `EasyVCanonicalFactAdapter.boundRows` | 无法按周/月、过滤、Top N、对比；每个新问法都要写 Java |
| 每个问题先过“生成质量快照”全部不变量 | `EasyVGenerationWorkflow.requireFacts` | 与问题无关的口径校验（反馈 cohort）导致整体失败 |
| 规划失败回退默认查询集；主 Agent 仅复读服务端参数 | `planKeys` / `EasyVSpringAiMainAgent` | fail hidden；多一次模型调用约 9 秒 |
| 语义只以指标为中心 | 全链路 | 只能回答“多少/趋势”，无法看业务对象、穿透关系、执行动作 |

## 2. 业界做法调研（2026-09 查证）

| 系统 | 模型生成什么 | 时间如何处理 | 可借鉴 |
|---|---|---|---|
| Palantir AIP Agent Studio Object Query Tool | 受约束本体查询 DSL（`OBJECT_TYPE / FILTER / TRAVERSE_TO / AGGREGATE`），解析失败回传错误重试 | 注入当前日期，模型自行换算为 ISO 日期；官方建议“求和/最近 N 天”等计算交给确定性 Function 工具 | 本体为中心；对象穿透；工具失败重试；计算不交给模型 |
| Cube（REST/AI API） | Cube 查询 JSON（measures/dimensions/filters/timeDimensions），不生成原始 SQL | `dateRange` 接受相对表达（`last 2 weeks`），按查询时区确定性换算 | 语义层约束模型；时间粒度/对比原生支持；`/meta` 自动导出目录 |
| Snowflake Cortex Analyst | 在 YAML 语义模型约束下生成 SQL | `CURRENT_DATE` + 日期函数由数据库计算 | 已验证查询库（verified queries）作为质量门禁 |

参考：Palantir 社区 [Object Query 规则](https://community.palantir.com/t/important-improvements-needed-to-automated-prompt-instructions/4858)、[AIP Logic 时间计算建议](https://community.palantir.com/t/can-aip-logic-query-timeseries/906)；[Cube 查询格式](https://docs.cube.dev/reference/core-data-apis/rest-api/query-format)。

共识：语义契约 → 模型生成受约束查询 → 确定性计算 → 校验失败回传重试 → 向用户展示理解 → 评测集门禁。
本项目采用结构化时间表达与确定性解析，不以不断追加关键词规则扩展时间能力。2026-09-29 补充的 Palantir 官方依据与本项目取舍见归档日志 [§11.8](../acceptance/archive/ontology-agent-runtime-2026-09-10-log.md#118-官方实践依据与项目取舍)。

## 3. 目标架构

以下为运行架构与受治理执行链路；历史落地细节见归档日志 [§9–§14](../acceptance/archive/ontology-agent-runtime-2026-09-10-log.md)，专题进展见各验收文档。通用动作平台与在线配置管理当前未实施。

```text
                   Ontology（唯一契约；Java 声明、版本冻结、审计）
     Object Type / Property（含时间属性与时区）/ Link / Metric / Function
                              │ 派生（Cube 生成物入库，漂移测试守护）
      ┌───────────────────────┼────────────────────────┐
  指标查询工具              对象读取与评估工具             确认写回适配器（C，默认关闭）
 （Cube：聚合/粒度/对比，    （PostgreSQL canonical facts    （EasyVBlockActionDatabaseAdapter：
   JWT + queryRewrite        + 领域评估/改造诊断提案）        应用所有者实时校验/事务保存/
   强制注入冻结版本）                                         源 Redis 失效/审计，人工确认后执行）
      └───────────────────────┼────────────────────────┘
   EasyVSemanticAgent（限定最多 8 次工具调用 / 4 次指标查询 / 180 秒预算；每步校验、审计、可重放）
   领域函数：SchemeAdaptation（结构与可读尺寸启发式评估）、BlockImprovement（块内改造与文案候选校验）
   呈现：工具证据 / 对象引用 → 视图描述 + 应用状态 → 图表 / 原型结构画布 / 比较与提案视图
   时间：结构化 TimeExpression → Java 确定性解析（Asia/Shanghai）→ 绝对日期进入工具调用
```

### 3.1 职责边界

| 内容 | Ontology | Java（确定性） | Cube | 模型 |
|---|---|---|---|---|
| 对象/属性/关系/指标口径 | 声明（唯一来源） | 校验、生成 Cube 模型 | 执行聚合 | 只读理解 |
| 时间语义 | 声明时间属性、时区、默认口径 | 解析 `TimeExpression`、校验覆盖范围 | 按绝对 `dateRange` 执行 | 输出 `TimeExpression` |
| 冻结版本绑定 | — | 签发含 `productVersions` 的 JWT | `queryRewrite` 强制注入，缺失即拒绝 | 不可见 |
| 查询选择 | 声明可组合性 | 校验意图、结构化错误回传 | — | 生成 `QueryIntent` |
| 领域函数 | 声明输入输出、对象约束与版本 | 执行领域算法，保留规则依据与结果证据 | 聚合已物化的评估结果 | 选择工具与参数，不编造评分 |
| 视图与应用状态 | 引用对象类型和成员；视图配置独立于业务语义 | 校验对象权限、版本、证据引用；前端按组件契约渲染 | 提供统计结果 | 选择与组合已有视图、解释结果 |
| 写回动作（C） | 复用对象身份与约束校验 | 实时身份/应用所有者校验、不可变准备、事务写回、缓存失效与审计 | — | 仅产出未应用提案，不可直接触发写入 |

原则不变：元数据驱动“选择与解释”，Java 保证“权限、计算、执行、写回与失败”，模型负责“理解与受约束表达”。

## 4. 时间语义规范

模型只描述时间语义，不做日期运算；Java 以执行锚点（`anchoredAt`，业务时区 `EasyVOntologyModel.BUSINESS_ZONE = Asia/Shanghai`）确定性解析。

```text
TimeExpression
  sourceText   原话（审计与展示，必填）
  kind         relative | calendar | to-date | absolute | all | ambiguous
  unit         day | week | month | quarter | year     （relative/calendar/to-date）
  n            正整数                                   （relative：最近 n 个单位，含当天）
  offset       ≤ 0 的整数                               （calendar：0=本期，-1=上期）
  from, to     ISO 日期                                 （absolute：节假日、“9月上旬”等兜底）
  candidates   [TimeExpression]                         （ambiguous：交给用户澄清）
```

解析规则（全部由表驱动测试固定）：

- `relative day n`：`[anchor-(n-1), anchor]`；`relative week/month n`：`[anchor-n 个单位+1 天, anchor]`。
- `calendar week` 以周一为起点；`calendar month/quarter/year` 取自然区间；`offset=0` 截止到 anchor。
- `to-date`：本期起点至 anchor。
- `absolute`：校验合法与先后顺序；保留 `sourceText` 说明依据。
- `all`：显式“全部数据”，必须在回答与界面展示“未指定时间，按截至 X 的全部数据”。
- `ambiguous`：不执行查询，返回澄清候选。
- 覆盖校验：与冻结版本内对应时间属性的 `[min, max]` 求交；部分越界照常回答并注明覆盖区间，完全越界明确告知，不报技术错误。
- 追问：模型输出相对上一轮 `QueryIntent` 的增量（如仅改粒度），不再用正则重锚。

## 5. 查询意图与工具边界

`QueryIntent` 是 Cube 查询的受限子集，由模型经结构化输出生成：

```text
measures[]      本体指标 key
dimensions[]    本体属性 key
filters[]       {member, operator ∈ equals|notEquals|contains|gt|gte|lt|lte|set|notSet, values}
time            {dimension（时间属性 key）, expression: TimeExpression, granularity?: day|week|month|quarter|year}
compare?        {expression: TimeExpression}            （环比/同比）
order[], limit  limit ≤ 5000；达到上限视为截断失败
```

校验失败返回结构化错误（不存在的成员、不可组合、越界）供模型一次纠正；仍失败则 fail loud 或进入澄清，禁止回退默认查询集。

**EasyV 受治理工具集（`EasyVAgentTools` + `EasyVSemanticAgent`）**：

- 预算与上限（源码常量）：单轮最多 `MAX_TOOL_CALLS = 8` 次工具调用，其中指标查询最多 `MAX_QUERIES = 4` 次，总执行预算 `EXECUTION_TIMEOUT_MILLIS = 180_000`（180 秒），返回模型的结果证据行上限 `EVIDENCE_ROW_CAP = 50` 行。
- 开放工具目录：
  - `query_metrics`：编译执行 `QueryIntent`（Cube 聚合与冻结版本过滤）。
  - `query_objects` / `read_object` / `traverse_objects`：基于服务端注册对象句柄与 `EasyVObjectReadService` 读取/穿透授权范围内的对象（如 `easyv-prototype-layout`、`easyv-prototype-block`、`easyv-prototype-component` 等；完整可读目录由 `EasyVOntologyModel.READABLE_OBJECT_KEYS` 与共享契约一致性测试守护）。
  - `assess_scheme`：调用领域函数 `SchemeAdaptation` 对授权区域进行方案库适配评估与候选比较（规则 `easyv-adaptation-v1`，状态 `heuristic_pending_real_data_calibration`）。
  - `inspect_block_improvement` / `preview_block_improvement`：读取区域/组件改造依据（单块含同数量方案，批量读取最多 50 个不重复区域句柄），生成经领域校验的未应用提案；D 阶段多屏批量检查中，仅改文案强制走 `{handle, textFields}` 原文对齐协议（仅限单指标块），不接受自拟文案或自由诊断推断。
- 引文与句柄隔离：模型规划层使用服务端注册句柄；综合回答输入剥离内部句柄，要求引用真实业务 ID/字段，Java 严格校验引用来源、行号、字段与连续原文后才组装 `GroundedConclusion`。

## 6. 分阶段目标与退出门禁

| 阶段 | 目标 | 当前状态与依据 |
|---|---|---|
| **A0 验证** | 本体声明 EasyV 对象/属性/关系/指标 → 生成 Cube 模型；`queryRewrite` 强制版本；`TimeExpression` 解析器 | **已完成**（2026-09-24 验收通过，见归档 [§9](../acceptance/archive/ontology-agent-runtime-2026-09-10-log.md#9-a0-验证结果2026-09-24已通过)） |
| **A 语义问数** | 生产过程对象入本体与 Cube；`QueryIntent` 规划/纠错/澄清；移除正则与默认回退；评测集与 `easyv-dev` 验收 | **已完成并上线**（2026-09-29 验收通过，见归档 [§10](../acceptance/archive/ontology-agent-runtime-2026-09-10-log.md#10-a-阶段实施与评测结果2026-09-29)） |
| **B 对象与智能体（含 A 扩展）** | 原型/区域/组件/应用/质量节点接入；对象查询/穿透、有限多步 Agent Loop、结构画布、精确统计下钻、关联统计、时间线与自然业务解释 | **工程收尾并已发布**（见 [B 工程收尾验收](../acceptance/b-closeout.md)、[业务问题清单](../acceptance/easyv-business-questions.md)、[质量 P0 实施](../acceptance/easyv-quality-p0-implementation.md) 与归档 [§11–§14.26](../acceptance/archive/ontology-agent-runtime-2026-09-10-log.md#11-原型设计分析与可复用呈现路线2026-09-29-经用户确认结构统计已发布b1-待实施)）。**独立未关闭门禁**：30 份样本业务评分校准、159 条历史可变快照输入认证 / 上游新增不可变留证 |
| **C 动作闭环（普通原型块）** | EasyV 普通原型块主题/指标/图形契合度诊断 → 重组/文案提案 → 人工确认 → 精确写回 → 读回与源页复验 | **原执行链路验收通过；已切换为数据库写回适配器（默认关闭），公司尚未启用/发布**（见 [C 块内改造](../acceptance/easyv-block-improvement-plan.md)、[写回适配器](../acceptance/easyv-writeback-adapter.md) 及归档 [§14.28–§14.34](../acceptance/archive/ontology-agent-runtime-2026-09-10-log.md#1428-c-开始实施块内诊断与具体重组提案2026-10-16本地)） |
| **D 一批大屏的检查与改进** | 目录选屏与用途 → 完整区域/指标依据检查 → 有依据的改法 → 逐项确认应用 → 实际结果与人工基线复核 | **首批推进中（未通过完整业务验收、未发布公司）**；D1 数据健康、D2 失败巡检与 V31 每日清理已上线公司，目录检查/整批续接/批量文案约束已本地实现（见 [D 专项计划](../acceptance/d-operations-plan.md)） |
| **V33–V35 近期领域扩展** | V33 核心指标区域与全量刷新；V34 原型动态面板（`tabV2`/`panelSwitch`）；V35 图表规则与后台配置审计 | **V33 已发布公司并同步本地**；**V34 仅本地代码与契约验证（未发布公司、待真源验收）**；**V35 已发布公司 test（2026-11-05，`chart-config-20261105-e2e15d1c92`，13 类产品），本地快照未同步且常驻采集账号缺四表 SELECT**（见 [核心指标](../acceptance/easyv-core-metrics-refresh.md)、[动态面板](../acceptance/easyv-dynamic-panels.md)、[图表规则与审计](../acceptance/easyv-chart-configuration.md)） |

路线保持 **A 语义问数 → B 对象与智能体 → C 动作闭环 → D 一批大屏的检查与改进**。D 目标以 2026-10-25 修订及 2026-10-31 确认为准：复用 C 的对象准备、确认、权限、审计和完整读回，先交付一批大屏的检查与实际改进；目录、核心指标及动态面板沿已有对象契约接入，不因可读、可展示就默认可写。近期不建设独立任务调度/审批/指派平台、未校准通用总分或自动批改。

### 6.1 当前分阶段基线

每项完成标准：完成与影响范围匹配的测试、构建和契约验证；发布前完成约定的 Java/Web 门禁并记录真实环境边界，不把本地快照或健康检查冒充真实源业务验收。

**A 语义问数（已完成并部署）**

- [x] 本体声明应用、原型任务、流水线节点、Forge 任务、反馈对象与关系，支持派生指标与反馈双时间口径（操作时间 / 应用创建时间）。
- [x] Java Cube 适配器签发含冻结 `productVersions` 的 JWT，识别 `SEMANTIC_VERSION_*` fail loud；Cube 独立于 Property profile 运行，使用 `JAVA_DATABASE_URL` 派生的 facts 只读角色。
- [x] `QueryIntent` JSON Schema + 校验器 + 结构化错误纠错与澄清分支；移除 `EasyVDateRange` 正则、`requireFacts` 全局门禁、`DEFAULT_KEYS` 回退与主 Agent 复读调用；界面交付“我的理解”条与结构化追问调整。
- [x] 评测集 `EasyVPlanningEvalIT`（80 题，含 55 题时间语义）与 `easyv-dev` 真实账号端到端验收通过（详见归档 [§9–§10](../acceptance/archive/ontology-agent-runtime-2026-09-10-log.md#9-a0-验证结果2026-09-24已通过)）。

**B 对象与智能体（工程收尾并发布；独立业务校准与历史输入认证未关闭）**

- [x] 原型/区域/组件/应用/质量节点与方案库结构接入（V21–V28，含结构树、槽位绑定、评分观测、组件百分比几何、质量 P0 原文与业务语义文案）。
- [x] 对象读取/关系穿透、有限多步 Agent Loop、结构画布、区域组件联动、图表/表格视图切换、排序筛选、精确统计下钻（含时间桶/比较期/派生指标依据/一跳关联）、关联全量统计与操作记录时间线交付并发布（[B 工程收尾验收](../acceptance/b-closeout.md)）。
- [ ] **业务评分校准**：用完整真实渲染与业务可读性标注校准并版本化 `easyv-adaptation-v1`（已准备 30 份样本，业务标签与真实渲染证据尚空）。
- [ ] **历史与新增生成输入认证**：明确历史 159 条可变 `PipelineCompleted` 快照可认证范围，并由上游保留新增生成的不可变输入、规则、候选与结果证据；已被覆盖的历史输入不承诺恢复。

**C 动作闭环（原流程验收通过；已切数据库写回适配器，公司未启用/未发布）**

- [x] 普通原型块主题/指标/图形与文案诊断提案、不可变准备、人工确认保存、事务读回、源 Redis 失效与重复确认幂等语义实现；原新增 EasyV 接口路线（含三列重组用户流程）与新数据库写回适配器（`EasyVBlockActionDatabaseAdapter`）授权测试源文案写回及编辑投影/缓存重建分别通过本地/测试源验收（[C 块内改造](../acceptance/easyv-block-improvement-plan.md)、[写回适配器](../acceptance/easyv-writeback-adapter.md)）。
- [x] 公司平台 V32 动作表迁移与对应代码包随工作台更新已部署至 `easyv-dev`，但 `EASYV_ACTION_ENABLED` 保持关闭。
- [ ] **新适配器公司发布与真实源重验**：在公司目标环境按明确权限与安全边界验证新写回适配器全流程并记录发布回执；不以旧接口浏览器验收替代新适配器实测。

**D 一批大屏的检查与改进（首批推进中，完整 D 业务验收未通过）**

- [x] 运维基础：V29 定时发布入队机制（默认关闭）、V30 无变化产品/集合复用、V31 版本保留清理（每日 03:00 已上线公司）、D 输入采集/发布时点溯源、D1 数据健康与 D2 按需生成失败巡检已发布公司（[D 专项计划](../acceptance/d-operations-plan.md)）。
- [x] 首批闭环本地实现：目录选择 1–3 张大屏发起检查（`/api/easyv/workspace/prototypes/review` + `InitialObjectSelection`）、整批范围续接、批量补齐全部区域与指标语义依据，以及单指标块批量文案候选原文对齐约束（已通过 local-dev 快照与 Java/Web 测试）。
- [ ] **D 业务验收与发布**：解决建议质量与必要性评审问题，在恢复真实写回源连接后完成用户逐项确认修改、源端完整读回与目标外内容保护、同范围人工步骤与耗时基线对比及公司发布（[D 专项计划](../acceptance/d-operations-plan.md)）。

**近期领域扩展（V33–V35）**

- [x] **V33 核心指标区域与 saas-test 全量刷新（2026-10-27）**：识别 `metric_role=core/module`、主视觉 `fillLayout` 并集叠放与小数跨度，已完成公司发布与本地快照同步（[核心指标刷新](../acceptance/easyv-core-metrics-refresh.md)）。
- [x] **V34 原型动态面板接入（2026-10-31，仅代码与本地契约）**：完成 `render="dynamic-panel"` + `tabV2`/`panelSwitch` 解析、物化与页签画布切换；未发布公司，待新源快照真实验收（[原型动态面板接入](../acceptance/easyv-dynamic-panels.md)）。
- [x] **V35 图表配置规则与后台配置审计（2026-11-05，公司 test 已发布）**：接入 `easyv-chart-type`、`easyv-chart-category`、`easyv-chart-priority`（面向 EasyV 账号的全局参考）与 `easyv-config-audit`（仅 `PLATFORM_ADMIN`），已完成公司 test V35 迁移、RECONCILE 采集（`ingest-650b7225-0f93-4404-bbd6-3edf665dfc84`）及服务更新（[图表规则与审计](../acceptance/easyv-chart-configuration.md)）。
- [ ] **V35 后续运维与本地同步**：为公司源只读采集角色 `ontology_agent_ingest` 补齐四张新表的 `SELECT` 权限以恢复常驻发布 Worker 刷新；按需导出同步公司新冻结集合至本地快照。

### 6.2 遗留边界与跨领域状态

- **EasyV 用户映射与权限边界**：平台账号经 `identity.subject_bindings`（V20）绑定源系统 `userId`，由 `EasyVScopeResolver` 解析：`PLATFORM_ADMIN` 访问全部数据（且独占 `easyv-config-audit`），其余账号限定为绑定 `userId`，未绑定即拒绝；`queryRewrite` 与 `ObjectQueryPort` 强制执行范围约束。C 写回进一步校验实时 `ai_screen_app` 所有者/空间/团队/删除状态，平台管理员身份不授予代理编辑权。
- **反馈 cohort 口径**：默认按操作时间 `operated_at`；支持按 `application.createdAt` 关联时间切换。
- **管理员改密入口**：管理员 Web 改密入口为 `/admin/accounts`，复用管理员 API；普通用户自助改密尚未提供。
- **Property 域维持封存**：代码中通过 `PROPERTY_DOMAIN_ENABLED` 控制（`application.yml` 默认 `true`，`compose.easyv-dev.yaml` 及本地开发配置均设为 `false` 保持封存）；因仍缺乏真实 ERP 业务数据接入与 Neo4j 投影验证，不在本轮启用。恢复须具备真实 ERP 数据契约、物化、图投影与端到端收缴率验收。

## 7. 对现有基线的调整

- **Main Agent 工具约束分层演进**：
  - **EasyV 域**：原 Multi-domain 基线“Main Agent 必须且只能调用一次 workflow tool”在 EasyV 域已调整为：A 阶段单次结构化规划 → B/C/D 阶段由 `EasyVSemanticAgent` 在限定步数与预算内执行有限多步工具调用（`MAX_TOOL_CALLS = 8`、`MAX_QUERIES = 4`、`EXECUTION_TIMEOUT_MILLIS = 180_000`）。Job pin、binding、Worker revalidate、审计与终态原子写入保持不变。
  - **Property 域**：`SpringAiMainAgent` 仍保留单次 `analysis_workflow` tool call 契约（当前在本地与 `easyv-dev` 封存）。
- **EasyV 运行链替换**：旧 `EasyVDateRange` 正则、`EasyVQueryCatalog` 固定 SQL、`requireFacts` 全局门禁已在 A 阶段移除，统一由 `EasyVSemanticAgent`（规划 → `SemanticQueryCompiler` 校验编译 → `SemanticQueryPort` / `EasyVAgentTools` 执行 → 引用校验）替代；计划模式为 `semantic-query-read-only`，范围快照为 schema v2。历史 `deterministic-read-only` / `question-driven-read-only` 执行保留只读展示，不支持追问（`FOLLOW_UP_LEGACY_EXECUTION`）。
- **Cube 共享语义引擎**：Cube 从 Property 专属 profile 拆出为平台语义查询引擎；Cube 模型（`cube/conf/model/easyv/*.yml`）与访问策略（`cube/conf/semantic-access-policy.json`）由 `CubeModelGenerator` 根据本体声明生成并入库，由漂移测试守护，不手写。
- **领域包不横向裂变**：原型分析（B）、块内改造（C）、批量大屏检查（D）及 V33–V35 均在 EasyV Domain Pack 内复用扩展，不因新增表或视图拆分新 Domain Pack。

## 8. 风险与约束

- **Cube 模型一致性**：以“本体声明生成 + 入库 + 漂移测试 + 发布时 `/meta` 校验”保证与本体版本一致；指标或对象口径发生兼容变更时新增成员，不篡改旧成员语义。
- **版本绑定强制性**：不能依赖调用方自觉；`cube/conf/cube.js` `queryRewrite` 对每个版本化 Cube 强制注入 `productVersionId` 过滤，上下文缺失即拒绝（映射为 `SEMANTIC_*` fail loud）。
- **运行时健康依赖**：Cube / Cube Store 是 EasyV 指标问数的运行时强依赖，已纳入 `easyv` 健康检查组与容器 `depends_on`。
- **模型不确定性约束**：通过 JSON Schema 结构化输出、编译器一次纠错、澄清分支、严格引文核对与评测集门禁约束输出；禁止空结果补零、模型自拟批改分数或失败回退默认查询集。
- **写回与采集权限隔离**：C 写回适配器（`EASYV_ACTION_ENABLED`）默认关闭，使用与平台主库和只读采集隔离的独立数据源与源 Redis；V35 新增四张源表后续需补齐 `ontology_agent_ingest` 只读 `SELECT` 权限，不用高权限业务账号替代常驻采集角色。
