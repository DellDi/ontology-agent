# Ontology Agent Runtime：本体契约 + 受治理工具 + 多步智能体

> 状态：Baseline（2026-09-24），用户已批准目标与分阶段顺序
> 适用范围：分析运行时的语义层、时间语义、Agent 工具与执行模型；产品对标 Palantir Ontology / AIP / Actions
> 与现有基线关系：沿用 [Multi-domain Runtime Architecture](./multi-domain-runtime-architecture.md) 的 Capability、binding、Job pin、证据与审计主链，
> 并按本文 §7 调整其中“Main Agent 只调用一次 workflow tool”等约束；Java 分层继续遵循 [Java Architecture Baseline](./java-architecture-baseline.md)。

## 1. 为什么调整

2026-09-24 真实部署端到端验收暴露的问题不是单点缺陷，而是结构性不灵活：

| 现状 | 位置 | 后果 |
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
没有主流系统用服务端关键词识别时间。

## 3. 目标架构

```
                   Ontology（唯一契约；版本冻结、审计）
     Object Type / Property（含时间属性与时区）/ Link / Metric / Action Type
                              │ 派生（生成物入库，漂移测试守护）
      ┌───────────────────────┼────────────────────────┐
  指标查询工具              对象查询工具                 动作工具
 （Cube：聚合/粒度/对比，    （过滤/穿透/明细，            （参数/权限/人工确认/
   JWT + queryRewrite        PostgreSQL facts + Neo4j）     幂等/审计）
   强制冻结版本）
      └───────────────────────┼────────────────────────┘
   Agent Loop：模型在限定步数内多步调用工具；每步校验、审计、可重放
   时间：结构化 TimeExpression → Java 确定性解析 → 绝对日期进入每个工具调用
```

### 3.1 职责边界

| 内容 | Ontology | Java（确定性） | Cube | 模型 |
|---|---|---|---|---|
| 对象/属性/关系/指标口径 | 声明（唯一来源） | 校验、生成 Cube 模型 | 执行聚合 | 只读理解 |
| 时间语义 | 声明时间属性、时区、默认口径 | 解析 TimeExpression、校验覆盖范围 | 按绝对 `dateRange` 执行 | 输出 TimeExpression |
| 冻结版本绑定 | — | 签发含 productVersionIds 的 JWT | `queryRewrite` 强制注入，缺失即拒绝 | 不可见 |
| 查询选择 | 声明可组合性 | 校验意图、结构化错误回传 | — | 生成 QueryIntent |
| 动作 | 声明 Action Type | 权限、确认、幂等、审计、执行 | — | 只能请求 |

原则不变：元数据驱动选择与解释，Java 保证权限、计算、执行与失败，模型负责理解与受约束表达。

## 4. 时间语义规范

模型只描述时间语义，不做日期运算；Java 以执行锚点（`anchoredAt`，业务时区 Asia/Shanghai）确定性解析。

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
- 追问：模型输出相对上一轮 QueryIntent 的增量（如仅改粒度），不再用正则重锚。

## 5. 查询意图（指标查询工具）

QueryIntent 是 Cube 查询的受限子集，由模型经 JSON Schema 结构化输出：

```text
measures[]      本体指标 key
dimensions[]    本体属性 key
filters[]       {member, operator ∈ equals|notEquals|contains|gt|gte|lt|lte|set|notSet, values}
time            {dimension（时间属性 key）, expression: TimeExpression, granularity?: day|week|month|quarter|year}
compare?        {expression: TimeExpression}            （环比/同比）
order[], limit  limit ≤ 5000；达到上限视为截断失败
```

校验失败返回结构化错误（不存在的成员、不可组合、越界）供模型一次纠正；仍失败则 fail loud 或进入澄清，禁止回退默认查询集。

## 6. 分阶段目标与退出门禁

| 阶段 | 目标 | 退出门禁 |
|---|---|---|
| **A0 验证** | 本体声明 EasyV 应用、生成任务（属性/时间属性/关系/指标）→ 生成 Cube 模型；`queryRewrite` 强制版本；TimeExpression 解析器 | 与现有 SQL（`forge-task-by-status`、`forge-failure-reasons`、`forge-duration-summary`、`application-by-day`）在同一冻结集逐行一致；缺版本上下文被拒绝；按周粒度与环比查询可执行 |
| **A 语义问数** | 全部 EasyV 对象入本体并生成模型；QueryIntent 结构化规划 + 纠错 + 澄清；按查询校验覆盖与新鲜度；删除正则、快照门禁、默认回退、复读调用；界面“我的理解”与澄清；评测集 | 原 20 个查询可由意图等价表达；时间表达式 30+ 用例；真实模型评测集准确率报告；Java 全量与 Web 门禁通过 |
| **B 对象与智能体** | 对象查询/穿透工具；Agent Loop（限定步数）；对象浏览器与对象详情；结论下钻到对象 | 多步问题评测；每步审计可重放；越权与步数上限测试 |
| **C 动作闭环** | Action Type（工单/通知/标记）；人工确认、幂等、审计 | 权限、重复提交、失败语义测试；真实环境演练 |
| **D 运营化** | 定时发布（增量 + 周期对账）、血缘与数据健康、看板 | 部署环境持续运行观测 |

### 6.1 分阶段实施清单

每项完成标准：测试先行、Java 全量与 Web 门禁通过、契约同步；涉及部署的项需记录真实环境验证。

**A 语义问数**（A0 已完成，见 §9）

1. 本体补齐原型任务、流水线节点、反馈对象与关系；生成器支持派生指标（成功率等）与反馈双时间口径（操作时间 / 应用创建时间）。
2. Java Cube 适配器：签发含冻结 `productVersions` 的 JWT；识别 `SEMANTIC_VERSION_*`；`/meta` 校验本体成员；Cube 部署从 Property profile 拆出，数据库来源统一为 `JAVA_DATABASE_URL`，使用 facts 只读角色。
3. QueryIntent JSON Schema + 校验器（成员存在、可组合、limit、时间覆盖）+ 结构化错误；单次结构化规划、一次纠错、澄清分支；删除 `DEFAULT_KEYS` 回退与主 Agent 复读调用。
4. 删除 `requireFacts` 全局门禁，改为按查询校验覆盖与新鲜度；证据记录 QueryIntent、解析后时间、Cube 生成 SQL 与结果行。
5. 追问改为增量 QueryIntent；删除 `EasyVDateRange` 正则、`EasyVFollowUpPolicy` 重锚、追问建议相对时间改写。
6. 契约（JSON Schema / Zod / fixtures）与界面：“我的理解”条（时间、粒度、口径、覆盖区间，可修改）、澄清选项、覆盖不足提示。
7. 评测集 50–100 题（时间说法、粒度、过滤、对比、追问、歧义）；确定性部分单测，真实模型评测出准确率报告作为发布门禁。
8. easyv-dev 部署与真实账号端到端验收（含 9/24 失败的三类问题回归）。

**B 对象与智能体**

1. 对象查询工具：按本体对象过滤、排序、分页、按关系穿透；PostgreSQL facts 执行，强制冻结版本；Neo4j 投影用于关系扩展。
2. Agent Loop：工具集（指标查询 / 对象查询 / 时间解析），限定步数与超时，每步事件、审计与可重放；越权与步数上限 fail loud。
3. 对象浏览器与对象详情页（属性、关系、相关指标、时间线），由本体元数据驱动渲染。
4. 结论下钻：回答中的数字可点击到支撑对象列表，再到对象详情。
5. 多步问题评测集与演示剧本。

**C 动作闭环**

1. Action Type 声明（参数 schema、目标对象、权限、前置条件、风险与确认策略、幂等键、超时、审计载荷）。
2. Action 执行服务：服务端重校验身份与目标状态、人工确认、幂等、失败语义、审计；首批动作：创建排查工单、通知负责人、标记异常应用。
3. 模型只能提出动作请求，界面展示影响与确认；现有“动作建议”升级为可执行请求。
4. 真实环境演练：重复提交、权限拒绝、下游失败与重试。

**D 运营化**

1. 定时发布：每小时增量、每日 RECONCILE，经现有发布队列与幂等键；界面显示各数据产品新鲜度。
2. release-worker 看守与告警（部署文档方案落地）。
3. 血缘与数据健康面板：结论 → 证据 → 数据产品版本 → 源批次 → 源行。
4. 看板：固定回答到看板，按新冻结版本刷新并保留历史快照。

### 6.2 遗留待确认（2026-09-24 自原前端计划进度日志迁入）

- EasyV 用户映射：会话 userId 为平台账号主键（验收账号 `18668184122` 为 2），业务方提供的 EasyV userId=16 当前无字段承载；EasyV scope 为 `accessMode=all`，userId 仅作审计归属。若需按创建者限定数据，需设计平台账号与 EasyV 用户的映射契约。
- 反馈 cohort 口径（原 P1-2）：由 A-1 的双时间口径承接，仍需业务确认默认口径；长期源库地址待确认。
- 密码轮换仅有管理员 API（见部署文档），无 Web 改密与自助改密。
- Property 域维持封存（`dip3.property.enabled=false`）；Property 数据与跨组件验收（原 P0-4）暂停。
- 历史进度、部署与验收证据以 git 历史为准（原 `docs/superpowers/plans/2026-09-08-frontend-capability-alignment.md`）。

## 7. 对现有基线的调整

- Multi-domain 基线“Main Agent 必须且只能调用一次 workflow tool”调整为：A 阶段单次结构化规划；B 阶段起允许限定步数的多步工具调用。Job pin、binding、Worker revalidate、审计与终态原子写入不变。
- EasyV 领域包内 `EasyVDateRange` 正则、`EasyVQueryCatalog` 固定 SQL、`requireFacts` 全局门禁在 A 阶段移除；领域不变量改为按查询/指标声明。
- Cube 从 Property 专属 profile 中拆出为平台语义查询引擎；Cube 模型为本体生成物，不手写。
- Property 域维持封存，不在本轮迁移。

## 8. 风险与约束

- Cube 模型随部署发布：以“本体生成 + 入库 + 漂移测试 + 发布时 `/meta` 校验”保证与本体版本一致；口径变化新增成员，不改旧成员。
- 版本绑定不能依赖调用方自觉：`queryRewrite` 对每个被引用 cube 注入 `productVersionId` 过滤，上下文缺失直接拒绝。
- 运行依赖增加 Cube / Cube Store；需纳入健康检查与部署文档。
- 模型不确定性：以结构化输出、纠错重试、澄清分支与评测集门禁约束，不以默认值兜底。

## 9. A0 验证结果（2026-09-24，已通过）

实现（尚未接入分析链路，现有行为不变）：

- 平台 `semantic.api`：`TimeExpression` / `TimeExpressionResolver` / `ResolvedTimeRange` / `TimeCoverage`；本体声明类型 `OntologyObjectType` / `OntologyProperty` / `OntologyLink` / `OntologyMetric`；`CubeModelGenerator`（YAML + `versioned-cubes.json`）。
- EasyV `EasyVOntologyModel` 声明应用、生成任务；生成物 `cube/conf/model/easyv/*.yml`、`cube/conf/versioned-cubes.json` 入库，`EasyVCubeModelDriftTest` 守护（`-Dsemantic.regenerate=true` 重新生成）。
- `cube/conf/cube.js` `queryRewrite`：对 `versioned-cubes.json` 中被引用的 Cube 注入 `productVersionId = JWT.productVersions[productKey]`；缺失即拒绝；调用方引用版本维度即拒绝；物业 Cube 不受影响。

验证：

- 单元：时间解析 46 例（月末截断、闰年、跨年周、上海时区边界、非法表达式、覆盖计算）；生成器 6 例；queryRewrite Node 测试 4 例（纳入 `test:web`）；Java 全量 487 例通过，Web 门禁 76 例（71 通过、5 容器测试按开关跳过）。
- 真实数据（easyv-dev 临时隔离 Cube 1.6.31 容器，冻结集 `ed9b4650`，验证后已删除）：`forge-task-by-status`、`forge-failure-reasons`、`forge-duration-summary`、`application-by-day` 在“全部数据”与 09-18~09-24 两个窗口与原 SQL **逐行一致**（8/8）；缺版本、缺部分版本、引用版本维度均被拒绝；生成 SQL 含两个冻结版本参数；按周粒度与环比（`queryType=multi`）可执行且与直接 SQL 核对一致——两者原 20 条 SQL 均无法表达。

A 阶段需处理的发现：

- `queryRewrite` 抛错时 Cube 返回 HTTP 500；Java 适配层须按 `SEMANTIC_VERSION_*` 错误码识别并 fail loud，或改为抛出 Cube `UserError` 返回 4xx。
- `compose.easyv-dev.yaml` 的 Cube 使用 `PLATFORM_POSTGRES_*`，在当前部署与 backend 实际库（`JAVA_DATABASE_URL`）不一致；启用 Cube 前须统一来源。
- Cube 目前复用平台库应用账号；生产应为 Cube 配置仅能读取 `facts` 的只读角色。
- `versioned-cubes.json` 为全局索引，当前仅由 EasyV 漂移测试生成；第二个本体生成领域接入前改为汇总所有领域声明生成。
- 派生指标（如成功率 = completed / terminal）需扩展生成器支持引用其他指标。
