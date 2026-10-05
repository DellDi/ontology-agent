# Ontology Agent Runtime：本体契约 + 受治理工具 + 多步智能体

> 状态：Baseline（2026-09-24）；2026-09-29 补充经用户确认的原型设计分析与可复用呈现路线（§11）。
> 实施状态：A 与原型结构统计扩展已部署，评测稳定性见 §10，结构接入证据见 §11.6；B1 对象分析、原型画布与配置化接入待实施。2026-10-03 本地 UI 进度与下一交付目标见 §12，远端最新版本和部署状态尚未核实。
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
本项目采用结构化时间表达与确定性解析，不以不断追加关键词规则扩展时间能力。

2026-09-29 补充的 Palantir 官方依据与本项目取舍见 §11.8；产品分层借鉴官方能力，具体技术选型与阶段划分是本项目设计。

## 3. 目标架构

```
                   Ontology（唯一契约；版本冻结、审计）
     Object Type / Property（含时间属性与时区）/ Link / Metric / Function / Action Type
                              │ 派生（生成物入库，漂移测试守护）
      ┌───────────────────────┼────────────────────────┐
  指标查询工具              对象查询工具                 动作工具
 （Cube：聚合/粒度/对比，    （过滤/穿透/明细，            （参数/权限/人工确认/
   JWT + queryRewrite        PostgreSQL facts + Neo4j）     幂等/审计）
   强制冻结版本）
      └───────────────────────┼────────────────────────┘
   Agent Loop：模型在限定步数内多步调用工具；每步校验、审计、可重放
   领域函数工具：结构相似度、约束检查、候选评估（声明输入输出与版本，领域实现）
   呈现：工具证据 / 对象引用 → 视图描述 + 应用状态 → 图表 / 原型画布 / 比较视图
   时间：结构化 TimeExpression → Java 确定性解析 → 绝对日期进入每个工具调用
```

### 3.1 职责边界

| 内容 | Ontology | Java（确定性） | Cube | 模型 |
|---|---|---|---|---|
| 对象/属性/关系/指标口径 | 声明（唯一来源） | 校验、生成 Cube 模型 | 执行聚合 | 只读理解 |
| 时间语义 | 声明时间属性、时区、默认口径 | 解析 TimeExpression、校验覆盖范围 | 按绝对 `dateRange` 执行 | 输出 TimeExpression |
| 冻结版本绑定 | — | 签发含 productVersionIds 的 JWT | `queryRewrite` 强制注入，缺失即拒绝 | 不可见 |
| 查询选择 | 声明可组合性 | 校验意图、结构化错误回传 | — | 生成 QueryIntent |
| 领域函数 | 声明输入输出、对象约束与版本 | 执行领域算法，保留规则依据与结果证据 | 聚合已物化的评估结果 | 选择工具与参数，不编造评分 |
| 视图与应用状态 | 引用对象类型和成员；视图配置独立于业务语义 | 校验对象权限、版本、证据引用；前端按组件契约渲染 | 提供统计结果 | 选择与组合已有视图、解释结果 |
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
| **A 语义问数** | 已接入的 EasyV 生产过程对象入本体并生成模型；QueryIntent 结构化规划 + 纠错 + 澄清；按查询校验覆盖与新鲜度；删除正则、快照门禁、默认回退、复读调用；界面“我的理解”与澄清；评测集 | 原 20 个查询可由意图等价表达；时间表达式 30+ 用例；真实模型评测集准确率报告；Java 全量与 Web 门禁通过 |
| **A 扩展 + B1 原型设计分析（下一交付）** | 接入原型结构与选型，复用 A 聚合查询；提前实现 B 的对象查询、有限多步分析、原型呈现与对话联动（§11） | 真实原型可复原、结果可追溯、诊断可定位；第二种组合场景复用同一运行时与渲染能力 |
| **B 对象与智能体** | 对象查询/穿透工具；Agent Loop（限定步数）；对象浏览器与对象详情；结论下钻到对象 | 多步问题评测；每步审计可重放；越权与步数上限测试 |
| **C 动作闭环** | Action Type（工单/通知/标记）；人工确认、幂等、审计 | 权限、重复提交、失败语义测试；真实环境演练 |
| **D 运营化** | 定时发布（增量 + 周期对账）、血缘与数据健康、看板 | 部署环境持续运行观测 |

执行顺序：A 已有能力持续回归 → §11 的 A 扩展 + B1 → B 的剩余通用能力 → C。D 中健康、血缘和发布验证随各次交付落实；通用配置界面按 §11.5 的退出门禁推进，不作为首个场景的前置工程。

### 6.1 分阶段实施清单

每项完成标准：完成与影响范围匹配的测试、构建和契约验证；发布前完成约定的 Java/Web 门禁。涉及部署的项需记录真实环境验证；纯文档调整不运行应用测试。

**A 语义问数**（A0 已完成，见 §9；1–8 已完成，结果见 §10）

1. 本体补齐原型任务、流水线节点、反馈对象与关系；生成器支持派生指标（成功率等）与反馈双时间口径（操作时间 / 应用创建时间）。
2. Java Cube 适配器：签发含冻结 `productVersions` 的 JWT；识别 `SEMANTIC_VERSION_*`；`/meta` 校验本体成员；Cube 部署从 Property profile 拆出，数据库来源统一为 `JAVA_DATABASE_URL`，使用 facts 只读角色。
3. QueryIntent JSON Schema + 校验器（成员存在、可组合、limit、时间覆盖）+ 结构化错误；单次结构化规划、一次纠错、澄清分支；删除 `DEFAULT_KEYS` 回退与主 Agent 复读调用。
4. 删除 `requireFacts` 全局门禁，改为按查询校验覆盖与新鲜度；证据记录 QueryIntent、解析后时间、Cube 生成 SQL 与结果行。
5. 追问改为增量 QueryIntent；删除 `EasyVDateRange` 正则、`EasyVFollowUpPolicy` 重锚、追问建议相对时间改写。
6. 契约（JSON Schema / Zod / fixtures）与界面：“我的理解”条（时间、粒度、口径、覆盖区间，可修改）、澄清选项、覆盖不足提示。
7. 评测集 50–100 题（时间说法、粒度、过滤、对比、追问、歧义）；确定性部分单测，真实模型评测出准确率报告作为发布门禁。
8. easyv-dev 部署与真实账号端到端验收（含 9/24 失败的三类问题回归）。

**A 扩展 + B1 原型设计分析（结构统计已实现并发布，B1 待实施）**

按 §11.6 顺序交付；属于 A 的领域建模扩展与 B 的首个完整业务场景，不另建 Agent 主链。当前实现、验证与部署状态以 §11.6 为准。

**B 对象与智能体**

1. 对象查询工具：按本体对象过滤、排序、分页、按关系穿透；PostgreSQL facts 执行，强制冻结版本；关系查询先复用 PostgreSQL；只有实际多跳查询需求与验证证据支持时再增加 Neo4j 投影。
2. Agent Loop：工具集（指标查询 / 对象查询 / 时间解析），限定步数与超时，每步事件、审计与可重放；越权与步数上限 fail loud。
3. 对象浏览器与对象详情页（属性、关系、相关指标、时间线），由本体元数据驱动渲染。
4. 结论下钻：回答中的数字可点击到支撑对象列表，再到对象详情。
5. 多步问题评测集与演示剧本；复用 §11 的对象引用、函数工具和界面状态联动，避免按领域复制实现。

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

- EasyV 用户映射（2026-09-28 已确认）：仅按 EasyV `user_id` 限定数据；平台账号经 `identity.subject_bindings`（V20，通用于各接入源）绑定 EasyV `user_id`，`EasyVScopeResolver.dataScope` 解析：`PLATFORM_ADMIN` 为全部数据，其余账号限定为绑定值，未绑定即拒绝（已在 A 分析链路生效）。语义层 `Scope.restricted({userId})` 已由 Cube 访问策略强制。
- 反馈 cohort 口径（原 P1-2，2026-09-28 已确认）：默认按操作时间 `operated_at`；可按 `application.createdAt` 关联时间切换。当前源库为测试环境，开发阶段按真实业务场景使用，后续切换正式地址。
- 管理员 Web 改密入口为 `/admin/accounts`，复用已有管理员 API；普通用户自助改密尚未提供。
- Property（物业收缴率分析）尚未恢复：2026-09-29 easyv-dev 查库，物业账单、项目与用户表均为空，Neo4j 未运行；需完成真实 ERP 接入与投影验收，不能仅打开领域开关。
- 历史进度、部署与验收证据以 git 历史为准（原 `docs/superpowers/plans/2026-09-08-frontend-capability-alignment.md`）。

## 7. 对现有基线的调整

- Multi-domain 基线“Main Agent 必须且只能调用一次 workflow tool”调整为：A 阶段单次结构化规划；B 阶段起允许限定步数的多步工具调用。Job pin、binding、Worker revalidate、审计与终态原子写入不变。
- EasyV 领域包内 `EasyVDateRange` 正则、`EasyVQueryCatalog` 固定 SQL、`requireFacts` 全局门禁已在 A 阶段移除，由 `EasyVSemanticAgent`（规划 → `SemanticQueryCompiler` 校验编译 → `SemanticQueryPort` 执行 → 引用校验）替代；领域不变量改为按查询/指标声明。计划模式为 `semantic-query-read-only`，范围快照为 schema v2；历史 `deterministic-read-only` / `question-driven-read-only` 执行保留只读展示，不支持追问（`FOLLOW_UP_LEGACY_EXECUTION`）。
- Cube 从 Property 专属 profile 中拆出为平台语义查询引擎；Cube 模型为本体生成物，不手写。
- Property 域维持封存，不在本轮迁移；原因与恢复条件见 §6.2。
- 下一交付改为 §11 的原型设计分析：复用 EasyV 领域，不因新增表或视图就拆新 Domain Pack；本体与规则可声明，通用编排和领域实现保持边界。

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

- `queryRewrite` 抛错时 Cube 返回 HTTP 500；Java 适配层须按 `SEMANTIC_VERSION_*` 错误码识别并 fail loud，或改为抛出 Cube `UserError` 返回 4xx。（已解决：保持 HTTP 500 + `SEMANTIC_*` fail loud 映射，不引入 Cube UserError。）
- `compose.easyv-dev.yaml` 的 Cube 使用 `PLATFORM_POSTGRES_*`，在当前部署与 backend 实际库（`JAVA_DATABASE_URL`）不一致；启用 Cube 前须统一来源。（已解决：`scripts/easyv-dev` 统一从 `JAVA_DATABASE_URL` 派生 `CUBE_DB_HOST/PORT/NAME` 注入 Cube，删除 `PLATFORM_POSTGRES_*`。）
- Cube 目前复用平台库应用账号；生产应为 Cube 配置仅能读取 `facts` 的只读角色。（已解决：`CUBE_DATABASE_*` 独立只读角色，DBA 经 `scripts/sql/create-facts-reader-role.sql` 创建，migrate 幂等授权。）
- `versioned-cubes.json` 为全局索引，当前仅由 EasyV 漂移测试生成；第二个本体生成领域接入前改为汇总所有领域声明生成。（A1 已解决：由 `SemanticModel.discover()` 汇总全部 `OntologyModelContribution` 生成 `semantic-access-policy.json`。）
- 派生指标（如成功率 = completed / terminal）需扩展生成器支持引用其他指标。（A1 已解决：`OntologyMetric` 比率指标。）

## 10. A 阶段实施与评测结果（2026-09-29）

实现（§6.1 A 1–7）：

- 结构化澄清：模型 `clarify` 与 `ambiguous` 时间经 `BackendException.clarification` 透传，失败快照写入 `planSnapshot._clarification{question, options≤6}`；界面展示问题与候选项。首轮澄清以“原问题（补充：所选项）”新建会话承接，追问轮澄清在当前会话作为新追问执行；首轮未完成的会话发送消息同样新建会话。
- 「我的理解」：完成快照写入 `_understanding`（对象、指标、维度、过滤、原话→解析区间、粒度、对比期、Top N、数据覆盖 full/partial/none）与 `_editorCatalog`（编译器可接受的成员路径）；综合回答输入带 `coverageStatus` / `effectiveRange`。
- 结构化调整：`POST /api/analysis/sessions/{id}/follow-ups/structured` 以用户编辑后的查询意图创建追问（`FollowUpPolicy.structuredPlan` 校验编译，计划含 `_queryOverride`），执行时跳过模型规划直接编译，违规 `EASYV_OVERRIDE_INVALID` fail loud。
- 部署：Cube/Cube Store 成为 EasyV 运行依赖（脱离 property profile，纳入 easyv 健康组）；Cube 库地址由 `JAVA_DATABASE_URL` 派生，账号为 DBA 预创建的 facts 只读角色，migrate 入口幂等授权（`FactsReaderGrants`）。

评测门禁（`EasyVPlanningEvalIT`，`-Plive-integration`；评测集 `backend-java/src/test/resources/eval/easyv-planning-eval.json`，80 题：指标 8、时间 25、粒度 7、对比 5、维度/排行 8、过滤 7、时间属性 3、追问 8、澄清 4、不支持 5；锚点 2026-09-24 Asia/Shanghai）：

- 判分：状态一致；查询按对象、指标（期望⊆产出）、维度/过滤集合、粒度、时间属性、解析区间、对比区间逐项命中；等价写法以 anyOf/alternatives 显式列出。门禁：整体 ≥ 90%，time 标签题时间正确率 100%。
- 过程：首轮基线 69/80（86.3%）、时间 54/55。失败归因为规划提示词缺陷（单值问题附加粒度、“昨天”误用 relative、time.expression 嵌套错误、追问对比丢失 compare）与校验反馈不可纠正，已在提示词与 `QueryIntentCodec` 违规信息中修复根因；未以放宽判分规则换取通过（仅补充语义等价写法：失败数指标带冗余状态过滤、P50 指标带冗余主链过滤、两个月份拆成两条查询）。
- 最终（模型 `deepseek-flash`，同一代码连续 3 轮）：80/80 时间 55/55、80/80 时间 55/55、79/80 时间 54/55。未通过的 1 题为“上周末有多少生成任务？”模型选择澄清（未给出错误数字）；门禁按单轮判定，3 轮中 2 轮通过，模型输出存在波动，发布前应重跑评测。

easyv-dev 部署与真实账号验收（§6.1 A 8，2026-09-29）：

- 发布：`91c71f5`（web）+ `636ca0c`（backend / release-worker），发布目录 `/opt/ontology-agent-releases/<rev>`，旧目录 `/opt/ontology-agent` 与 `session-delete` 镜像保留用于回滚；发布前备份目录与平台库（`/opt/ontology-agent-backups`）。Flyway V18 → V20，facts 只读角色 `ontology_facts_reader`（DBA 权限账号创建，LOGIN、无 SUPERUSER/CREATEDB/CREATEROLE），migrate 授权成功；Cube/Cube Store 首次随 EasyV 启动，easyv 健康组（含 cube）UP。
- 验收（经 Web BFF，冻结集 `ed9b4650`，锚点 2026-09-29）10/10 通过：“最近30天每天”解析为 08-31~09-29 按日并提示部分覆盖（数据 09-07~09-23）；“上个月成功率与失败原因”不再受反馈口径门禁影响，区间完全无数据时明确告知；反馈默认按操作时间；“成功率是多少”返回结构化澄清与三个口径候选；自然语言追问“改成按周”；结构化调整（最近7天按日，跳过模型规划）与非法意图创建即拒绝；绑定 EasyV 用户 8 的账号只见本人数据（37 个应用，与平台库直查一致）；未绑定账号 `EASYV_USER_BINDING_REQUIRED` 拒绝。
- 验收中发现并修复：区间内无数据时比率指标 0/0 返回单行 null 被视为可引用证据导致 `EASYV_ANSWER_UNGROUNDED`（`636ca0c`）。
- 验收账号 `acceptance-admin` / `acceptance-scoped`（绑定 EasyV 用户 8）/ `acceptance-unbound`，凭据仅存于服务器 `/root/.ontology-acceptance`（600）。


## 11. 原型设计分析与可复用呈现路线（2026-09-29 经用户确认；结构统计已发布，B1 待实施）

### 11.1 业务目标与当前起点

目标：让用户围绕 AI 大屏的真实原型，在对话中查看选型结构、布局构造、指标分布，诊断重复与匹配问题，沿对象继续追问并比较候选方案。演示必须以真实数据、可定位对象和可解释评估支撑，不能用预制截图或模型虚构分数代替链路。

首个业务范围为 **EasyV 领域内的原型设计与质量分析**。仅在业务语义、权限或数据生命周期确有独立边界时再拆分新领域，不按源表数量划分领域。

源码核查起点（不等于新增功能已实现）：

- `EasyVOntologyModel.PROTOTYPE` 当前只有应用关联、时间与数量；V8 的原型数据集声明排除了 XML、模板 JSON、原型 JSON 等结构字段。首先扩展实际数据接入，单独加 Cube 指标无法补出这些事实。
- EasyV 工作台已有 `PrototypeLayoutState`、XML/JSON parser 与布局呈现。评估复用其中只读解析和渲染能力，不整体搬入编辑器；原编辑器的空输入兜底不能被分析链路当作真实结构。
- 源端 `ThemeBlockMatchingEngine` 已产生匹配分、兼容度、候选方案等结果。需要核实持久化位置、字段含义和历史覆盖；源码存在输出字段，不等于历史数据已保存。
- 当前前端已有 `AnalysisInteractionUiRendererRegistry`，支持 chart/table/graph 等类型；尚无原型画布与通用对象选择联动。当前本体由 Java 声明，不宣称已支持配置界面动态建模。

用户给出的选型矩阵是业务规则讨论素材：指标数量、宽高形态、排列方式、图表组合可成为约束；图中着色、推荐与禁用含义须结合现有选型定义核实，不根据颜色自行推断。

### 11.2 建模与数据接入

最小业务对象链：

```text
大屏应用 → 原型版本 → 布局区域 / Block 实例 → 指标实例
                            │
                            ├─ 采用的选型方案定义 → 组件类型与排列结构
                            └─ 选型评估 → 候选方案、评分分项、规则版本
```

- 区分可复用的方案定义、原型中的具体实例、针对实例的评估记录。不是每个 JSON 字段都建独立对象；只有需要独立查询、关联或审计的实体才提升为对象。
- 保留原始结构快照，同时提取分析所需的区域、几何信息、组件类型、指标语义与关系。通过对象 ID 将统计结果、结构图与原始证据对应起来。
- 复用 source ingestion → canonical product → 冻结 Dataset Version Set 链路；Agent 和前端不绕过平台事实库直接读取源库。新增 schema 使用 V21 或后续实际未占用的迁移编号，不修改已执行的 V8。
- 标识包含源连接/环境、源对象标识与版本语义，禁止把不同 EasyV 环境的同数字 ID 当作同一对象。保留已有权限与父应用归属；对象列表、结构内容、缩略图和聚合使用一致的数据范围。
- 先核实源端是否保留原型修订和选型过程。若只有最新状态，从接入时开始保留快照并注明覆盖起点；禁止把平台采集版本冒充源端完整编辑历史。
- 区分原型结构还原与最终大屏运行效果。只有结构时展示结构与图表类型占位，不伪造真实业务图表数据或声称还原最终渲染。

### 11.3 指标、规则与算法边界

| 问题 | 计算依据 | 执行位置与结果要求 |
|---|---|---|
| 指标分布、方案使用率、区域占比 | 区域与指标实例、方案引用、几何结构 | Cube 聚合；明确实例数与去重指标数、分母及采集覆盖 |
| 精确结构重复 | 明确归一化规则后的结构签名 | 领域函数/物化步骤计算，Cube 汇总；声明是否忽略名称、位置或尺寸 |
| 布局近似、组件组合或语义重复 | 分别定义结构、组合、指标语义的相似标准 | 独立评估口径，返回相似对象与差异依据，不能混成一个不透明“重复率” |
| 选型适配 | 区域尺寸、指标数量/类型、候选方案约束 | 先硬约束筛选，再按可解释规则排序；返回分项及未满足约束 |
| 方案比较 | 固定指标、候选集合、规则与原型版本 | 只读分析，展示构造变化与评分差异，不自动写回源原型 |

规则优先复用现有业务算法。历史评估与按新规则重新计算的评估必须区分；记录候选集范围、算法/规则版本和输入版本。最优仅指“当前候选集与规则下排名最高”，不宣称全局最优或将启发式分数表达成概率。

首轮只选有真实数据依据的指标；缺失历史评分时明确“不可核验”，需要重算时标明重算。语义相似度若使用模型，应独立标注并以人工标注样本验证，不能替代确定性结构判定。大规模相似搜索的索引或预计算按实测规模与延迟决定，不先建通用向量平台。

### 11.4 智能体与呈现联动

复用现有执行、冻结版本、证据和 SSE 链路，按当前场景补齐指标查询、对象查询、领域函数三类工具；引入有限步数的工具编排，禁止为每个问法写专用工作流。查询对象和评估函数均校验作用域，不能靠模型自行遵守。

呈现分成三个部分：

1. **业务结果**：工具输出真实对象引用、结果集与证据；统计或评分不由视图生成。
2. **视图描述**：声明渲染类型、结果/对象引用、字段映射、排序、着色与高亮参数。复用现有 render block 契约；确需新增时才扩展，不预建另一套通用 UI DSL。
3. **应用状态**：当前原型版本、选中区域、筛选条件和比较对象。工具返回结果驱动视图更新，用户点击对象成为后续对话的明确上下文。

约束：

- 优先用工具输出确定性更新对象集合；模型可选择视图和已注册参数，不生成对象 ID、数据或未经注册的执行逻辑。
- 结果引用可追溯至本轮执行及冻结版本；画布、图表和文字指向相同对象。跨版本比较必须显式选择两侧版本，不能静默切到最新数据。
- 一套原型结构渲染能力读取数据绘制不同结构；增加方案、指标或同类布局不新增页面模板。原型画布、对象列表、图表和比较视图可组合，也能单独使用。
- 无效结构、未知渲染类型、失效引用明确展示错误及上下文，不以空白画布表示分析成功。
- 新的专业视觉能力作为可复用组件注册，声明输入与选择等事件，保留版本和发布验证。未来可用 AI 辅助开发组件，但生成代码须经过预览、测试与发布，不在普通分析对话中直接执行任意代码。
- 渲染组件只负责呈现与交互；数据读取、计算及授权留在后端，不把领域规则写进画布。

### 11.5 配置化与后续领域接入

采用“真实场景验证边界 → 可声明定义驱动运行 → 管理界面维护”的顺序。配置化是减少同类接入的重复研发，不承诺任何新算法或全新表现形式零开发。

| 扩展内容 | 目标接入方式 | 何时需要代码 |
|---|---|---|
| 同一结构的新指标、维度、约束阈值 | 本体/规则定义及校验发布 | 现有表达能力无法覆盖的新语义 |
| 新对象与关系 | 源字段映射、对象声明、作用域声明 | 新连接器或复杂结构解析 |
| 同类图表、原型结构与视图组合 | 已注册组件的字段、参数、事件绑定 | 全新的专业交互或表现形式 |
| 新领域算法 | 有输入输出契约的函数注册 | 实现和验证新算法本身 |
| 新领域 | 领域声明、映射、权限与必要 adapter | 仅增量领域能力，不复制 Session/Job/Agent/UI 主链 |

第一步继续利用现有本体声明、生成器和渲染注册表，集中可变定义，不为此次交付先造配置后台。
随后用第二个真实分析组合检验复用：新增定义与参数即可完成查询和呈现，通用编排/页面无按场景分支。
基于该证据，再把稳定的定义转为可持久化配置，接入既有治理链路：草稿 → 校验/预览 → 发布激活 → 版本固定 → 可回滚；旧执行仍使用原定义。
最后提供字段映射、规则参数和视图绑定的管理界面。配置发布能实际驱动运行、生成模型并校验漂移，才算完成配置平台；仅保存 JSON 或新增表单不算。

源连接、权限、映射、本体和结果契约共同构成接入；不是只扩展 Cube schema。已有 Cube 模型继续由本体生成，不能变成手工维护的第二份业务定义。暂不建设插件市场、任意脚本热加载或覆盖未知领域的万能建模器。

### 11.6 下一交付的顺序与退出门禁

2026-09-30 续接交付：第 1 步已完成，第 2 步的 ingestion/本体/Cube 实现、真实源验证和 easyv-dev 全量/增量发布已完成，Java 镜像为 `ontology-agent-java:f8f555a`。第 3–4 步待实施；原型画布与区域高亮未实现。不改变 §9–10 的历史验收结论。

| 顺序 | 交付内容 | 退出门禁 |
|---|---|---|
| 1. 源数据与口径核查（2026-09-30 已完成，证据与口径见 §11.9） | 核实部署实际源库中的原型结构、方案库、指标、评分持久化与历史；形成字段映射和真实样本 | 源记录 → 结构解析 → 对象关系逐项核对；明确缺失字段、权限与版本边界；冻结首轮指标口径 |
| 2. A 扩展：结构与统计 | 在现有 ingestion/本体/Cube 链路增加最小对象及关系，完成分布统计与明确口径的重复分析 | 同一冻结集下统计与独立查询/人工标注一致；解析失败可定位；更新/删除、父应用范围与重跑一致性通过 |
| 3. B1：对象分析与可视化 | 对象查询、领域评估函数、有限多步分析；原型画布、候选比较、选择/高亮联动 | §11.7 在真实账号下走通；每个数字与高亮可定位证据；未授权对象不可读；错误、超时/步数限制、未知视图可诊断 |
| 4. 复用与发布 | 第二个真实组合场景复用工具/组件，发布到 easyv-dev | 变更指标、对象集合、着色或布局组合不改通用 Agent 与页面主链；浏览器交互、窄屏、契约和相关测试通过；原 A 评测发布前重跑 |

函数评测覆盖准确性和边界条件；模型评测覆盖对象指代、关系查询、工具选择、澄清及不支持问题，不能只验证答案措辞。

第 2 步已实现的边界：V21 为现有 `easyv-prototype-task` 源数据集增加布局 XML 与原型 JSON，schema 升为 v2；三个新增产品为版式、区域、图表组件，与原五个产品组成同一冻结集。没有新增重复源数据集。首次接入必须 FULL/RECONCILE，旧 v1 源链继续做增量物化会明确拒绝；既有冻结 facts 不受影响。版式保留解析状态与错误码，失败记录的计数/签名为 null，不产出子事实；facts 不保存标题、描述、指标名称等自由文本。区域未标注的尺寸保留 null，展示为“未标注”，尚未实施尺寸推导。新对象通过父应用绑定授权、active cohort 与冻结版本；原生成质量能力仍要求原五个产品，不额外改变已有能力契约。

发布前补齐冻结集解析边界：`latestFrozen` / `requireFrozen` 要求集合包含全部必需产品，返回整个冻结集，且所有产品仍须 published。原五产品能力因此能选中新的八产品集合；缺失必需产品仍拒绝。该边界有持久化测试与真实接入测试覆盖，不通过另发一份五产品旧集合绕过。

部署实测补齐 Worker 证据边界：能力的 required 产品是集合选取条件，证据可以引用同一冻结集中的新增产品。完成态校验复用执行前已校验的 manifest，逐项检查证据的 product key 与 version ID；未知产品、其他版本、其他冻结集或本体仍拒绝。避免 Cube 已返回结构统计却在最终落库时被原五产品列表误拒绝。

接入产品列表的唯一运维配置是 `compose.easyv-dev.yaml` 的 ingest 命令（8 产品），`scripts/easyv-dev ingest` 复用该配置，无单独列表。Cube 模型与访问策略由本体生成，漂移门禁保留。部署后的真实冻结集查询与父应用删除范围已对账；真实非管理员账号权限、浏览器完整交互验收仍待完成。部署顺序见 `docs/easyv-dev-deployment.md` 的 V21 章节。

2026-09-30 验证证据：

| 门禁 | 本次结果 |
|---|---|
| Java 单元/Testcontainers 测试（Java 21） | Surefire 528 项，0 失败、0 错误、0 跳过；全量执行后修正新增测试缺失的计划契约，再定向重跑 Worker 18 项通过。覆盖 V21 新库/旧库迁移、八转换器装配、解析错误事实、增量替换子组件、RECONCILE 删除、旧 v1 链拒绝、重跑/顺序无关哈希、Cube 漂移及冻结集证据版本校验 |
| Web `pnpm test:web` | 88 通过，5 个可选容器测试跳过；覆盖结构对象父应用授权/版本约束、compose 产品清单对齐和显式 ingest mode 优先级 |
| TypeScript / ESLint / Web 与 Java 构建 | `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm build`、Java `mvn -DskipTests package` 通过 |
| 真实源 `LiveEasyVIngestionIT` | 使用部署机当前只读源配置，经 5 源 → 8 产品 → 同一冻结集物化到一次性 PostgreSQL；120 原型全部 ok，777 区域、1617 图表组件，与独立源 JSON 展开 SQL 一致；FULL/INCREMENTAL/RECONCILE 内容哈希和行数一致，源计数及状态分布前后不变 |
| 运维配置 | compose 配置解析、脚本语法、`git diff --check` 通过 |
| easyv-dev 发布 | 平台库 V21、facts-reader 授权完成；FULL 冻结集 `ingest-947f5eb3-8ece-404e-8144-ba912d9ce1f5`，INCREMENTAL 冻结集 `ingest-c1678964-0ed2-475b-b1d1-6ef377b3d021`，8 产品行数/哈希全部相同。120 原型全部 ok，777 区域、1617 组件；v2 增量源版本正确继承 v2 FULL 父版本。backend/web/Cube healthy，release-worker 已更新 |
| 部署后实际提问 | 管理员会话 `d56abd13-bd66-4c7b-a018-14d4eee68892`，执行 `193e6d98-e846-3adb-bf0e-9ce96460d8d3` 的 job/snapshot 均 completed；真实模型 → Cube → 回答/图表落库完成。查询使用最新 INCREMENTAL 冻结集，active cohort 为 119 原型/770 区域/1601 组件，5 类布局逐行与独立 facts SQL 一致；较原始 120 少 1 个已删除父应用对应的原型（7 区域、16 组件）。登录页浏览器可访问，完整登录后交互仍待人工验收 |

Java 默认测试不包含真实模型调用。额外执行 `mvn clean verify` 时 Failsafe 触发四个 live IT，因未注入真实源/LLM 配置而失败；带当前源配置单独执行的 `LiveEasyVIngestionIT` 已通过，原 A 的模型规划/端到端 live 评测未在本次重跑，仍属于发布前门禁。测试门禁通过不能替代部署环境 Cube 查询、真实账号权限与浏览器验收。
数据接入缺口优先解决，不为了视觉效果先接虚构结果。当前阶段完成分析与方案比较后停止，写回编辑进入 C 的动作设计；新增动作必须定义真实目标 API、参数、权限、前置条件和审计。

### 11.7 首个演示与验收路径

1. “最近生成的大屏，哪些布局重复明显？”——给出统计范围、口径、实际原型集合及缩略结构；样本不足如实说明。
2. “打开这一组，重复在哪里？”——沿结果下钻，高亮对应区域，展示结构或指标的相同与不同。
3. 选中区域追问“为什么选这种构造，匹配得好吗？”——携带选中对象与版本，展示约束、已记录或明确重算的评分及候选。
4. “保持指标不变，比较其他构造。”——只读展示候选差异；没有可行方案时说明具体约束，不生成伪候选。
5. 切换到“指标分布/选型使用情况”——复用同一对象集合、权限、工具与视图组合，验证场景变化无需重写页面。

验收同时包含无数据、结构损坏、评分缺失、无可行候选、越权对象引用和旧版本回看。
产品价值以“真实对象可查看、结论可定位、比较可解释、追问可连续”为准，不以图表数量或截图效果判定完成。

### 11.8 官方实践依据与项目取舍

2026-09-29 查阅的 Palantir 官方资料：

- [Ontology overview](https://www.palantir.com/docs/foundry/ontology/overview)：对象、属性、关系、函数、动作与权限共同构成业务操作层。项目据此保持本体、聚合引擎与领域函数分工。
- [Chatbot tools](https://www.palantir.com/docs/foundry/chatbot-studio/tools)：对象查询、函数、动作、应用变量等工具可组合。项目先交付只读对象分析与评估，写回按 C 阶段治理。
- [Application state](https://www.palantir.com/docs/foundry/chatbot-studio/application-state)：对象集合与应用变量连接对话和其他视图，推荐工具结果确定性更新变量。项目据此实现对象选择与画布联动。
- [Custom widgets](https://www.palantir.com/docs/foundry/custom-widgets/overview)：专业视图可由自定义组件扩展。项目据此采用通用视图复用与专业组件注册，而非每个场景固定一套页面。
- [Pilot build a widget](https://www.palantir.com/docs/foundry/pilot/build-a-widget)：AI 可辅助生成组件，经参数/事件连接宿主并发布，组件在受限环境运行。项目将 AI 辅助组件开发作为后续效率手段，不混同于分析时执行模型生成代码。

上述是已核实的产品分层依据；Cube、Java 领域包、A 扩展/B1 划分以及配置化推进顺序是本项目基于现有边界的设计，并非 Palantir 的具体内部实现。

### 11.9 源数据与口径核查结果（2026-09-30）

方法：经只读会话查询 easyv-dev 源库 `easyv_saas`（未写库，仅结构统计）并对照 `easyv-ai-java` 源码。数字仅代表本次快照（原型创建于 2026-09-07 ~ 09-24）。

**原型结构（`ai_screen_prototype`，每应用一行，无修订历史）**

- 120 行：`screen_structure_xml` 全部可解析；XML 与 `screen_prototype_json` 的 Block ID 集合逐行一致；5~10 个 block/原型，1~7 个图表/block，使用 41 种方案，5 类布局（凹形 39、dashboard_02 39、左中右 32、左右 5、半包围 5）。
- XML 提供布局骨架（`block_type_id`、`blockSize`、`span`、`weight`）；JSON 的 `page-N.blocks[blockId]` 提供 `schemeId`、`boundMetrics` 与 `components[]`（`chartFamily`、`gridPosition`）。
- 缺口：页眉/页脚类 Block 共 121 个没有 `blockSize`（其余 small 72 / medium 514 / large 70），尺寸须由 `block_type_id + span + 所在容器` 推导，不能只依赖 `blockSize`。
- `span` 相对父容器的排布方向：水平容器为宽度占比，垂直容器为高度占比（由 `ai_template_layout.layout_style` 推导，未与前端渲染核对，实现前须核对）。

**方案库（`ai_block_data` 70 个、`ai_block_type` 4 行、`ai_block_internal_data` 6 行、`ai_template_layout` 22 行）**

- 方案按 `(block_type_id, chat_count 1~7)` 索引，含槽位几何 `position`、角色、模式（`kpi_grid` / `stacked_main` / `main_plus_summary` / `summary_plus_main`）；槽位图表类目约束在 `ai_block_internal_data`。
- 4 种 `block_type_id` × 7 档图表数在库中全部存在方案，因此“方案库有无”不能筛出不合适的组合；`ai_block_type.config` 只有 `padding`，无尺寸约束。

**评分持久化**

- 历史查询位置：`ai_pipeline_node_record`（`step_name='PipelineCompleted'`）的事件输出 → `output.raw.regenContextSnapshot.step5Candidates.step4Output.blockAssignments[]`，含 `matchScore`、`bestSchemeScore` 与五项分解；当时查得 159 条快照，按 `ai_screen_app.generation_task_id` 关联到 119/120 个原型，每任务仅一份。数据库 `output` 列保存完整事件，实际列内路径有两层 `output`：`output.output.raw.regenContextSnapshot`。这些数量是当时查询证据，不能据此认证快照为不可变的生成时状态；2026-10-04 源码核对发现的覆盖路径见下。
- 753 个 block 中 730 个有分数（最低 38.6、均值 72.6、最高 100），23 个 `comboScoreBreakdown` 为空。
- 58/120 个原型在快照之后被对话编辑；45 个 block 的方案与快照不一致（含 17 个编辑时新增、快照中不存在）。

**现有组合逻辑不看尺寸**：`ThemeBlockMatchingEngine`（Step4）与 `Step5CandidateScoringEngine`（Step5A）只使用指标数、模式、位置优先级和图表类目；`blockSize` 仅作为提示词上下文透传，不参与硬约束或评分。产品选型矩阵（指标量 × 宽高形态）中“是否推荐”的判定在现有代码与库中没有落地，须由平台侧新增的适配评估函数承担（见下）。

**首轮口径（已确认）**

1. **评分**：产品目标仍是只展示可核验的“生成时评分”，不重算、不外推。原先提出的“当前方案、指标与图表匹配 `currentFilledBlocks` 即可展示”判据不足：2026-10-04 核对本地源 checkout 发现编辑会覆盖该上下文。必须先证明评分阶段的原始输入及来源不可变，再逐项核对当前 block；暂未取得此证据时只保留“评分观测、输入尚未核验”。Step4 最优候选分与最终选中方案也必须分开，不将方案一致当作评分归属一致。
2. **选型适配（新增，独立于生成时评分）**：平台领域函数，输入为位置、指标数与类型、图表、区块物理尺寸；先硬约束（方案存在、指标可落入槽位类目、槽位物理尺寸不低于图表类目最小可读尺寸），再输出可解释分项与未满足约束，规则带版本，与生成时评分分列展示。尺寸阈值以矩阵为校准样本并用编辑行为（被替换/删除的 block）做旁证，但阈值属启发式，须在规则版本中标注，不表述为概率或全局最优。
3. **重复**：分层展示，不合并为单一“重复率”——L1 布局骨架相同（92/120 涉及，最大组 24，主要由 39 种模板骨架决定）、L2 骨架+方案相同（4/120）、L3 再加图表数（4/120）、L4 再加图表族（0/120）。

**已知边界**：产品矩阵为 5 种宽高形态，方案库仅 4 种 `block_type_id`，且 type 3 同时出现 small/large、type 4 出现 medium/large，二者不一一对应，映射须在第 2 步建模时显式定义；生成侧未见历史编辑记录（`ai_screen_prototype` 仅保留最新态），此后的修订快照从平台接入时开始保留并注明覆盖起点。

## 12. 进度核对与下一交付目标（2026-10-03）

核对基线为 `main` 的 `e9c770c`。首次拉取因 GitHub DNS 失败，后续 `git pull --ff-only` 成功并返回 `Already up to date`。easyv-dev SSH 与平台数据库的实际协议连接仍不可用；TCP 建连不能作为内网恢复的证据。用户确认内网不可达，改用独立本地 PostgreSQL（`ontology_agent_local`，端口 55432），通过正式 Flyway 入口初始化至 V21；新版 Web 在端口 3000 启动。该本地库没有内网历史会话和 EasyV 业务 facts，新版 UI 未发布至 easyv-dev。

| 工作项 | 当前状态与边界 |
|---|---|
| A 语义问数与原型结构统计 | 已实现，2026-09-30 接入、部署与对账证据见 §10–11.6；本次未重跑 Java、真实源或模型评测 |
| shadcn/ui 基座与 AI Elements 接入 | `85b12ce` 已实现：vendored 对话、消息、输入、工具等组件；`e9c770c` 已移除旧 workbench 基础控件与引用。`ai` 仅作为类型依赖；现有 Java/SSE 与 ViewModel 保留 |
| 新版工作台与分析会话 | `e9c770c` 已实现：左侧会话导航、中央消息流、按需右侧详情；侧栏折叠/宽度保存、设置弹窗、Conversation 自动跟随、PromptInput 与工具状态展示。代码完成不等于浏览器与部署验收完成 |
| B1 对象分析与原型呈现 | 尚未实现：原型对象查询、画布、区域选择/高亮、候选比较和有限多步分析；UI 框架迁移没有补齐这些业务能力 |

本次本地验证：`pnpm test:web` 101 通过、5 个可选容器测试跳过；`pnpm exec tsc --noEmit`、`pnpm build` 通过；`pnpm lint` 为 0 错误、9 条 warning，来自 vendored `message.tsx` / `prompt-input.tsx` 的 Hook 依赖、未使用参数、图片与无效 disable 注释。未进行新版 UI 浏览器验收、Linux 镜像构建或 easyv-dev 发布。

### 12.1 当前优先级：新版工作台验收与发布收尾

目标：将已实现的 shadcn/ui + AI Elements 工作台交付为真实账号可用的版本，停止继续扩展 UI 套件。

1. 本地已拉取至最新，先完成本地新版工作台验收；内网恢复后核对部署镜像并以真实数据复验，只将实际构建、发布、验证过的版本记录为已部署。
2. 以真实账号检查新建分析、首个进度前等待、流式回答、追问、澄清、失败与断连、历史回放；检查输入框间距、发送状态和消息跟随，用户阅读历史时不能被强制拉回底部。
3. 检查侧栏折叠/宽度恢复、设置与主题、右侧详情、键盘关闭/焦点以及窄屏溢出；确认管理员入口与数据范围仍遵守 Java 权限。核对剩余 lint warning 和依赖补丁，不通过禁用规则掩盖实际问题。
4. 完成受影响测试、生产镜像和 easyv-dev 浏览器验收，保留原 A 模型评测与非管理员越权验证门禁。

2026-10-03 本地未就绪状态修复：首轮表单执行遇到 `ONTOLOGY_NOT_PUBLISHED` 或 `DATASET_VERSION_SET_NOT_PUBLISHED` 时，由 Java 返回 303 至原会话，附错误码与 traceId；其他权限/资源错误保留原 API 语义。会话显示“分析暂未就绪”、保留问题，提供按角色显示的管理入口、重新检查与返回工作台，诊断信息折叠展示，停止等待与自动执行。移除跨页面持久化的自动执行尝试标记：旧版提交失败后未创建执行也会被浏览器判定“已提交”，导致历史回访永久等待；现在由服务端执行状态与已有幂等键控制，组件内仍去重，失败会话回访可重新检查环境；不创建虚假执行或分析结果。链接基础样式移入 CSS base layer，修正 shadcn 主按钮链接的文字颜色。验证：Java `AnalysisControllerTest` 与 `AnalysisServiceTest` 共 20 通过；Web 102 通过、5 个可选测试跳过，自动执行行为测试 12 通过；tsc、相关 ESLint、生产构建通过。本地浏览器已验证新建、刷新、重新检查及历史回访；当前仍为无业务 facts 的本地库，未发布至 easyv-dev。

退出标准：完成/失败状态与后台一致、无空白执行框或输入框遮挡、滚动和窄屏交互可用，记录真实账号、发布版本与验收结果。缺少发布环境或浏览器证据时保持“代码已实现、验收待完成”。

### 12.2 下一业务交付：B1 对象查看与画布联动

第一段交付目标：从“哪些布局重复明显”的统计回答打开支撑原型集合，再查看一个真实原型的区域与组件，并选择/高亮对应对象。所有查询、对象引用和呈现使用同一冻结版本与父应用授权范围。

实现前先核对现有结构 facts 是否足以还原画布，补齐实际缺失的几何/关系字段；对象查询沿现有 Java application/port/adapter 扩展，Web 消费结果与选择状态。不另建 Agent 主链，不在 UI 直接读取 EasyV 业务源库。尺寸方向、未标注区域与来源覆盖按 §11.9 的已知边界核实，不能猜测补全。

第一段退出标准：真实账号能够从统计下钻到对象列表和原型画布；对象 ID、区域/组件与证据逐项一致；越权引用拒绝，损坏结构、缺字段、无数据与历史版本有明确反馈。之后继续 §11.6 的评估函数、候选比较与有限多步分析，再按 §11.7 用第二个真实组合场景验证复用。生成时评分须按 §11.9 可核验口径展示，不能混用当前方案与旧快照。

### 12.3 B 阶段执行计划（2026-10-03 开始）

目标保持 §6 与 §11 的完整范围：对象查询与关系穿透、可追溯的原型呈现和对话选择、领域评估与候选比较、有限多步工具编排，以及第二个真实场景的复用和发布。按下面的依赖顺序交付，第一段通过不表示整个 B 已完成。

| 顺序 | 具体工作与复用边界 | 验收证据 | 状态 |
|---|---|---|---|
| B1.0 画布结构事实 | 保留 XML 的页面尺寸、嵌套布局容器、顺序、span、方向、gap、padding、主视觉引用，继续丢弃名称/描述/指标等自由文本；在现有版式产品增加结构树，使用 V22 和新版转换定义 | 解析测试、正式迁移与物化测试；结构树可还原嵌套关系，错误行无伪结构；旧冻结事实不可变，新内容参与 hash；原统计签名保持原口径 | 本地实现与门禁通过，真实源复验待完成 |
| B1.1 对象读取 | 复用本体对象/属性/关系声明、现有冻结集合与 EasyV 范围。先实现原型列表、详情、区域与组件关系查询，再接入统一对象查询工具；所有调用显式携带本轮执行与冻结集合，禁止默认切到最新 | Java/API/Web 契约；同一集合列表、详情、关系一致；分页稳定；跨用户、父应用删除、版本伪造、无数据和解析错误测试 | 对象读取/API 与 B2.1 Agent 工具接入本地门禁通过；真实数据验收待完成 |
| B1.2 原型呈现与选择 | 在既有 renderer registry / render block 中接入对象列表、结构画布与详情。读取结构树绘制，不为每种布局写模板；保留原型/区域/组件引用，列表与画布选择相互高亮 | 浏览器：查询范围 → 原型 → 区域/组件；两个不同布局共用渲染器；键盘/窄屏、缺尺寸、坏结构与旧版本明确反馈 | 本地呈现与隔离浏览器验证通过；真实数据验收待完成 |
| B1.3 选择进入对话 | 用户选中的对象和版本成为明确请求上下文，服务端重校验；工具返回的真实对象引用确定性驱动视图，模型不生成对象 ID | 同一对象连续追问、切换原型与取消选择；错版本、越权引用拒绝；SSE/历史回放与证据一致 | 本地实现、B2.3 多轮选择、B2.4 HTTP 回放与 B2.5 非管理员隔离浏览器/BFF 全链通过；实际公司源/账号验收待完成 |
| B1.4 评估与候选 | 按 §11.9 分开显示可核验的生成时评分与带规则版本的适配评估；接入方案/槽位所需事实，硬约束在领域函数内执行，比较固定输入与候选范围 | 输入与快照逐项核验；评分缺失/方案被编辑/不可读尺寸/无候选的失败路径；规则分项、候选集和输入版本可审计 | 冻结几何、领域适配评估/API/区域比较面板已实现并本地验证；原始生成输入核验、真实数据校准与验收待完成 |
| B2 有限工具编排 | 在现有 Java Agent/Worker 内串行编排指标查询、对象查询、关系穿透、时间解析与领域函数；限定步数与超时，每步真实事件及审计，避免按问法编写专用流程 | 多步问题集、对象指代与工具选择评测；越权、上限、超时、工具失败、澄清与重放测试；原 A 回归 | B2.0/B2.1 本地门禁、B2.2 原 A 规划与四条对象工具路径、B2.3 四轮 Worker/选择/回放、B2.4 Java HTTP 与 B2.5 浏览器/BFF 指标下钻和区域追问闭环通过；实际公司源/账号验收待完成 |
| B3 复用与发布 | 按 §11.7 真实剧本完成重复诊断、原型查看、匹配解释与方案比较；第二个真实组合场景复用相同工具/组件；发布 easyv-dev | Java 全量、Web/构建/契约门禁；真实账号、独立 SQL/源结构对账；第二场景不改 Agent/页面主链；发布版本、截图和验收记录 | 待实施 |

B2 当前阶段目标与顺序（2026-10-04；先完成 B2.0 主链，再扩展工具）：

1. 先在现有指标主链完成结果回传、再次规划、明确结束、次数/时间预算与逐次审计（B2.0）。随后复用 `EasyVObjectReadService`、`EasyVSchemeAssessmentService` 与本体关系，将指标查询、对象列表、对象详情、关系读取和适配评估纳入同一只读工具协议。模型只能引用服务端从真实结果注册的对象句柄，不能提供执行 ID、版本 ID 或自行生成对象 ID；用户选择继续由 Java 强制约束。
2. 沿用 `EasyVSemanticAgent` / Worker 主链，读取真实结果后再次规划。最多 8 次工具调用，其中指标查询仍最多 4 次；总时长预算包含规划、工具和回答；模型流按剩余预算取消，同步工具在调用前后核验预算并沿用各自传输/数据库超时，不宣称取消了仍在远端运行的查询。时间表达式继续由语义编译器按冻结锚点解析。超限、超时、工具失败明确终止；结构化调整保留确定性执行。
3. 每次工具调用保留输入、实际输出、父调用和成功/失败审计，并发出真实执行事件。对象及评估结果成为可引用证据，确定性驱动现有对象视图与比较呈现；历史回放和对象轮次追问保持可读取。
4. 验证多步结果依赖、伪造句柄/版本、选择范围、冻结输入、无数据、未知工具、澄清、步数与超时，以及原 A 查询/时间/引用回归；跑对应 Java、Web 契约和构建门禁。正式库仍不注入测试业务数据。真实模型、真实源及非管理员验收和第二场景/发布归 B3，不能以本地测试代替。

B 阶段开始时的代码基线：V21 的 `easyv_prototype_block` 仅保存直接父容器 tag/id/direction，版式表没有布局树。它不足以表达嵌套 `Layout` / `Sider` / `Footer` / `Content`、页面尺寸和 gap/padding；不能从这份扁平事实猜测画布。EasyV 原型编辑器的实际消费者 `prototype-layout-parser.ts` 依据父容器方向拆分 span，并读取布局宽高、位置、padding 与间距；B1.0 以此保留结构输入，后续绘制仍需核对组件网格与留白口径。

边界：先交付只读结构视图，不把图表类型占位描述为最终大屏效果；新树不读取运行时源库。旧 V21 冻结集没有树时明确标记结构尚未接入，不在读取时解析 staging 或猜测坐标。内网不可达不阻止本地代码、正式迁移、Testcontainers 和契约推进；真实源重新发布、非管理员范围、模型评测与部署验收仍须补齐，不能用测试 fixture 代替。当前本地空库不注入演示业务数据作为已发布能力。

B1.0 本次证据：Java 全量 535 项，0 失败/错误/跳过；Web 102 通过、5 个可选容器测试跳过。覆盖有序嵌套树、尺寸/跨度/主视觉引用、属性白名单与不可变结果、属性顺序无关序列化、几何变化内容哈希及旧 facts 不可改写、错误记录无伪树、V21 → V22/空库/重复初始化迁移与 Cube 漂移。本地 `ontology_agent_local` 已通过独立 migrate 入口升至 V22，版式注册为 `easyv-prototype-layout-v2` / schema 2；本地版式 facts 仍为 0 行，未用 fixture 伪造接入。当时对象查询、画布与 Agent 多步能力尚未实现；后续对象读取进度见下段，真实源与远端发布仍未验证。


B1.1 对象读取证据（2026-10-03）：

- `ObjectQueryPort` 直接读取冻结 canonical facts，列表/详情/关系共用本体属性与关系声明；过滤和排序仅接受结果对象的属性 key，值使用 SQL 参数。列表默认 50、最多 200，offset 最多 10000；追加主键排序、用 limit+1 返回 hasMore，空列表保持为空。成员资格复用 requiredLinks/baseFilter，并对每个涉及产品强制冻结版本。
- 本体补齐版式→区域/组件、区域→版式/组件、组件→区域关系；区域与组件使用 source_id + block_id 组合关联，不以跨原型可能重复的 block_id 关联。补充布局树节点 ID、组件 ID、起始网格行列，Cube 模型由本体重新生成，漂移测试及本地 Cube metadata 编译通过；没有新增事实表、迁移或产品。
- `POST /api/analysis/sessions/{sessionId}/objects/query` 必须携带 executionId、datasetVersionSetId。objectId 为空读取列表，指定 ID 读取详情，再指定 relation 穿透声明关系；显式核对会话与执行归属、已发布本体和原冻结集合，禁止最新版本替代。当前角色/绑定重新解析后与提交时范围取交集：撤权与跨用户拒绝，权限增加不扩大旧执行范围。对象引用携带 objectKey/objectId/productVersionId，响应携带执行、本体、冻结集合，读取日志保留绑定与返回数量。
- 版式详情在授权对象已存在后读取同产品版本的 layout_structure：available / not_retained / parse_failed 三态，不解析 staging、不补造旧版树或坏结构。区域/组件详情返回声明属性，全部自由文本继续排除。Web 新路由仅透明代理；JSON Schema、严格 Zod 和 Java 序列化 fixture 共用契约；错误继续保留 code/traceId。
- 验证：Java 全量 548 项，0 失败/错误/跳过，随后新增装配测试 2 项通过；Web 105 通过、5 个可选容器测试跳过；tsc、相关 ESLint、Web 生产构建通过。正式物化后的 PostgreSQL 测试覆盖稳定翻页、冻结父应用软删除、跨用户范围、同名区域/组件不串原型、属性/数值/时间过滤、SQL 注入值与非法成员、错误原型无子对象；API/服务测试覆盖冻结集合伪造/不可用、权限收窄/撤销/绑定变更、三种结构状态及未认证。
- 边界：Agent 尚未调用对象查询端口；本次之后的原型呈现进度见 B1.2，下钻条件扩展、选择进入对话与有限多步编排继续按 B1.3/B2 实施。新版 Java API/Worker 已在本地 8080 启动且 health=UP，Web 3000 的对象 BFF 实际返回 401/AUTH_REQUIRED（未认证读取被拒绝）；本地 Cube 新模型已加载。当前本地正式库的 layout/block/component 均为 0 行，真实对象、非管理员浏览器链路、真实源重新发布和 easyv-dev 部署仍待验证。测试 fixture 仅在测试数据库，不写入本地正式库作为业务展示。


B1.2 原型呈现证据（2026-10-03，本地，尚未发布 easyv-dev）：

- Java 按实际语义查询确定性追加 `object-browser` render block，携带来源冻结集合、原型对象类型和可精确保留的根属性过滤。有界时间转换为业务时区的起点 GTE / 次日零点 LT，ALL 不补造日期过滤；按当前期查看对象范围，明确不将聚合分组、排名、TopN 当作对象筛选。一跳关联或 HAVING 过滤暂不产生入口，缺少四个原型相关产品的旧集合也不产生不可用入口。
- 聊天结果通过原有 render block → interaction part → renderer registry 接入“查看原型”侧面板。修正了 view model 丢失事件/历史来源 sessionId、executionId 的问题，SSE 与历史恢复都绑定原轮次，不借用当前轮次的版本。对象读取响应只增加本体的属性标签/类型和可读取关系描述，不暴露 SQL；属性与关系按钮由 Java 声明驱动。
- 同一纯投影器读取保留的树，按源编辑器 12 栅格、gap、padding、方向和跨度还原区域/主视觉；支持多页，保留对象 ID，列表、画布、详情选择联动，组件选择高亮所属区域。缺尺寸、非法/溢出跨度、未知方向、重复区域、冻结对象缺失均显示可诊断原因；历史 not_retained 与 parse_failed 不生成假结构。组件事实未保留像素尺寸，因此不把网格坐标推断为图表像素位置或最终大屏效果。
- 浏览器使用隔离的契约 fixture 服务（3111，不连接数据库，不是正式应用路由）验证横向/纵向布局、键盘 Enter 选择、区域/组件高亮、关系读取、缺尺寸、历史结构缺失、解析失败、403 与空对象状态；390px 视口的文档宽度与视口一致，没有横向溢出。截图保存在本机 `.codex-runtime/b12-object-browser.png` 和 `b12-narrow.png`，测试服务完成后关闭。
- 门禁：Java 全量 552 项，0 失败/错误/跳过；Web 110 通过，5 个可选容器测试跳过；tsc、相关 ESLint、生产构建通过。新增测试覆盖两个几何布局的精确坐标、缺失和非法结构、多页与主视觉引用、Java 范围入口/时间/旧集合边界、真实聊天 view model 的 SSE/历史执行上下文保留。正式本地库仍无原型事实，未用 fixture 冒充接入。
- 下一步仍按完整计划推进：B1.1 的统一 Agent 对象工具、B1.3 的选择进入对话与服务端重校验、B1.4 的事实和评估规则、B2/B3。当前仅证明本地代码、门禁与隔离 UI，真实源几何核验、非管理员浏览器链路和 easyv-dev 发布尚未完成。


B1.3 选择进入对话证据（2026-10-04，本地，尚未发布 easyv-dev）：

- 原型查看器显式提供“针对这个对象追问”。只在对象详情实际读取成功后启用；浏览列表或高亮本身不改变聊天范围。输入框上方显示可取消的选择提示，每条历史消息记录其对象范围；连续追问沿该对象已完成的轮次更新来源执行，切换到旧轮次重新选择时保留用户指定的来源。取消后新消息显式提交 null；待执行/失败历史保留请求引用，失败执行不会变成可承接的对象来源，取消后的普通轮次回访也不会恢复旧选择。
- 请求只传 executionId、datasetVersionSetId 和 objectKey/objectId/productVersionId，不接受属性、权限或 SQL。Java 从同用户、同会话的已完成 Java 快照核对来源，派生父追问并固定原冻结集；普通追问仍使用原有最新完整集合规则。创建与提交执行时重新授权并读取对象，权限只能与冻结范围取交集；Worker 沿任务权限快照读取，实时绑定进一步收窄时同时收窄语义查询与证据的数据范围。
- 规划器获得授权后读取的真实属性和引用。Java 根据本体的主键与直接关系追加对象过滤，自然语言和结构化调整共用此约束；不支持的关系明确拒绝并要求取消选择或改问，不把用户选择静默替换成全范围。所选对象读取有真实 started/completed/failed 事件，引用写入审计与计划快照，指标证据仍使用该轮冻结集合。这里是确定性的选择校验，统一 Agent 对象工具与多步关系组合仍按 B1.1/B2 推进。
- 修复实际历史助手组件丢失执行来源的路径：静态与 live 入口均传入原轮次 sessionId/executionId。共享 Schema 和严格 Zod 接受受控选择，拒绝额外权限/属性、错误追问绑定和孤立标签；Web 透明代理保持原契约，409/403 的真实原因与请求编号在发送失败时可见。
- 本地验证：Java 全量 567 项，0 失败/错误/跳过；Web 116 通过、5 个可选容器测试跳过，TypeScript、相关 ESLint、生产构建通过。Testcontainers 验证来源归属、会话、完成状态与 Java 契约；服务/Agent 测试覆盖版本伪造、权限收窄/撤销/绑定变更、连续父轮次、提交重校验、主键及组合关系约束、结构化调整不调用规划器、读取失败事件及冻结证据。隔离浏览器使用真实聊天组件，验证历史入口→对象详情→选择提示→连续提交、切换版式、取消、键盘操作与 390px 无横向溢出；测试服务不连接正式数据库，不是正式分析结果。
- 边界：本地正式库仍无原型业务 facts；真实模型规划与非管理员端到端、旧/新冻结集的真实源验收、easyv-dev 发布尚未完成。下一段是 B1.4 所需方案/槽位、指标与评分事实，以及领域评估规则；B2 工具编排、B3 第二场景及发布保持完整范围。

B1.4 指标绑定事实（2026-10-04，评估能力仍在实施）：

- 源端本地 checkout `easyv-ai-java` HEAD `2c62b081` 的 `ScreenPlanningExportAssembler` 按 slotIndex 排序，将 `components` 与 `boundMetricIds` 同序输出；组件没有稳定的 metricId 字段，不能从名称反推绑定。解析器仅将明确对齐的 ID 数组投影为有序槽位绑定，保留 slotIndex、componentId、metricId、chartFamily、sceneType、sourceType；不保留 boundMetrics 中的指标名称、源列或业务描述。
- V23 在现有区域 facts 增加 metric_binding_status 与 metric_bindings，区域产品升为 `easyv-prototype-block-v2` / schema 2；其他产品、八产品清单、源数据集 v2 与既有结构统计签名保持原契约。available 表示 ID 数组与组件数量一致、所有 ID 均为非空字符串；缺失为 not_retained，错误类型、数量不一致或无效 ID 为 invalid。绑定不可用时仍保留真实结构，但不补造 ID；旧冻结 facts 的两列保持 null，读取时须明确历史输入尚未覆盖。
- 新绑定参与区域内容哈希，指标替换会产生新区域版本，原区域/版式/组件事实不可改写。L1–L4 仍描述原有结构重复口径，不把指标 ID 混入这些签名。V23 当时尚未接入方案库、生成评分快照与候选集；后续 V24 评分观测见下。运行时对象读取和 UI 尚未消费绑定，不将这一事实扩展计为评估功能完成。
- 评分核验的下一实现边界：上述本地源码中 Step4.matchScore 为位置权重分（最高 50）与最优候选 bestSchemeScore 之和；bestSchemeScore 五项分解对应 bestSchemeId。Step5 的最终 selectedScheme 可能不同，Step5A.preScore 又有独立四项口径。须同时保存评分阶段、候选方案和原始数值；当前输入与 currentFilledBlocks 一致也不意味着 Step4 最优候选分就是最终选中方案的分数，不能统一标为百分比。此次为源码核对，未重新验证内网历史快照对应的生成代码版本；源快照缺少规则版本时必须说明未知，不以当前源码推定历史归一化。
- 本地验证：Java 全量 572 项，0 失败/错误/跳过；Web 116 通过、5 个可选容器测试跳过。解析测试覆盖按槽位对齐、错误类型/数量/空 ID、白名单与不可变绑定；Testcontainers 覆盖真实物化、新旧版本内容哈希、统计签名不扩展、绑定失败仍保留结构，V22 已发布区域升级 V23 后绑定保持 null、旧版本 schema 不改写、新库与幂等初始化。当前本地库已备份并经独立 migrate 升至 V23，区域定义为 v2/schema 2；区域 facts 仍为 0 行，未注入展示数据。Java API/Worker 已用新版启动；完整 B1.4、B2、B3 与真实源/模型/非管理员/发布验收继续待完成。

B1.4 评分观测事实（2026-10-04，V24；尚未认证生成时输入）：

- 源端本地 checkout `easyv-ai-java` HEAD `2c62b081` 中，`RedisRegenStateStore.saveAndSyncDb` 将最新上下文写回最近一条 `PipelineCompleted` 的 `output.output.raw.regenContextSnapshot`。`RegenContextRefresher` 从当前保存的原型重建 `currentFilledBlocks` 后调用此路径；结果保存、区域/标题/主视觉编辑及布局切换均有真实调用者。源表没有更新时间，现有 RECONCILE 策略适合重新读取这些覆盖后的记录。该证据修正 §11.9 原始假设：与当前上下文一致不能证明是评分时输入，当前源码也不能证明历史部署版本。
- V24 复用 `easyv-pipeline-node` 源与产品：源契约升为 schema 2，追加 output（原七列顺序不变）；完整事件仅留在受治理 staging。产品改为 `easyv-pipeline-node-v2` / schema 2，由原物化入口调用纯函数，投影任务内区域/方案/指标 ID、类型、原始数值、五项分解、排名、目标区域条件及有序槽位绑定。facts 不保留名称、描述、源列、文件或完整原始 output；不增加产品、Cube 模型或通用采集能力。
- 有可解析上下文一律为 `available_unverified`，来源标为 `mutable_regen_context`；非目标节点为 `not_applicable`，缺失与损坏分别保留 `missing` / `invalid` 和定位错误码。缺失数值和列表保持 null，不补零或空数组。最优候选 `bestSchemeId` 与最终 `selectedScheme.schemeId` 分开，原始 matchScore 可超过 100，不标百分比；源未保留规则版本和归一化口径。旧冻结 facts 三列保持 null，不回填、读取 staging 或补造历史输入。
- 本地验证：Java 全量 581 项，0 失败/错误/跳过；Web 116 通过、5 个可选容器测试跳过，Java package 通过。纯解析与 Testcontainers 覆盖真实列内路径、候选与最终方案不同、编辑后上下文仍不可核验、白名单、缺失/损坏/重复槽位、非有限数值、重复物化哈希稳定、源覆盖但 create_time 不变时新哈希及旧事实不可改写；V23 已发布旧流水线事实升至 V24 后保持 null 和原版本 schema。旧源 v1 缺少 output，由现有物化版本校验拒绝，必须先重新接入 source v2。
- 本地库已备份并经独立 migrate 完成 V23 → V24；流水线数据集为 schema 2 / RECONCILE / 八列，产品定义为 v2 / schema 2，Java API/Worker 重启后 health=UP，Web 仍在 3000。流水线 facts 为 0，没有注入业务 fixture；远端未发布。评分观测目前仅由物化链路消费，尚未接入 API、UI 或 Agent，不代表评分核验/评估功能可用。
- 下一步：确认不可变的原始生成输入证据及历史覆盖，再接入方案/槽位库、明确尺寸与类目规则版本，实现固定输入/候选集合的领域评估和比较呈现。原始输入无法证明的记录保持不可核验；适配评估独立于历史生成评分。B2 工具编排与 B3 第二真实场景、真实账号/模型/源及发布验收保持完整目标。


B1.4 方案库事实（2026-10-04，V25；领域评估与比较继续实施）：

- 源仓库 checkout `2c62b081` 的 `AiBlockDataServiceImpl.convertToScheme` 按 row/col 排序并重新生成 slotIndex；按 `block_internal_id` 关联 `ai_block_internal_data`，类目来自 allowed_chart_categories，recommend_type 是推荐组，需经源码词表才能展开具体图表类型。源 DDL `sql/v8.17.0-20260604/20260604-1-tables.sql` 明确两个 ID 为 int4，三份 JSON 配置为 varchar；接入契约分别用 INTEGER / STRING，不扩大通用连接器的类型兼容。
- V25 注册两个 RECONCILE 数据集 `easyv-block-scheme` / `easyv-slot-type` 和一个 `easyv-scheme-library` 产品。现有多输入物化器同时绑定这两份冻结源，现有 lineage 保存双方版本；facts 仅投影方案 ID、区域类型、图表数、模式和有序槽位的几何、坐标配置、角色、权重及关联约束，不保留 name / bindMetric。不在读取时查询最新源，推荐组不伪装成已展开的图表类型。
- 槽位输入 available / missing / invalid 三态，错误码与源方案 ID 可定位；缺位置、数量不一致、缺失或损坏的引用类型均不补造合法方案。显式空数组与缺失约束区分，空约束不会解释为允许任意图表；实际评估还须检查类目匹配、几何和可读尺寸。保留的配置是平台接入时的版本，不能认证为历史生成时的方案库。
- 生产 ingest 清单扩为九产品，原八个语义统计产品保持原要求；方案库是领域评估输入，未为了发布它新增无调用者的 Cube 对象。装配门禁、生产清单门禁及 live-integration 的两源/九产品/双输入 lineage 断言已同步。真实源测试尚未执行，私有采集账号还需验证新增两表的读取权限。
- 针对性验证 26 项通过：纯投影、源类型、缺失/坏约束、缺少必需输入、旧 facts 不可改写、相同物化哈希稳定和约束变化新哈希。Testcontainers 按源 DDL 创建 int4/varchar 表，使用现有只读 PostgreSQL 连接器、采集编排、物化器与冻结发布器验证 FULL / RECONCILE 全链路；测试源与事实仅在隔离容器。
- 完整门禁与本地运行：Java 590 项，0 失败/错误/跳过；Web 116 通过、5 个可选容器测试跳过，Java package 通过。追加验证已发布版本不能继续插入方案 facts（明确 BUILDING 版本错误），相关物化套件 5 项通过。平台本地库已备份并通过独立 migrate 完成 V24 → V25；两数据集 ID 为 INTEGER / RECONCILE，产品 v1 且有两个必需输入。新版 Java health=UP，Web 3000/login 返回 200；方案 facts 与任务均为 0。未发布远端，未宣称可在 UI 使用评估。
- 下一实现顺序：领域函数读取授权区域的冻结结构/指标绑定和同冻结集的方案库 → 明确图表族/类目词表、物理尺寸、padding 与最小可读尺寸规则版本 → 固定输入与候选集合，输出硬约束及可解释分项 → API/工具和比较 UI。缺少方案库的旧集合明确输入尚未覆盖；历史评分原始输入核验独立保留为未完成，不阻断新的适配评估实现。B2/B3 的完整范围和真实验收保持不变。


B1.4 适配评估与候选比较（2026-10-04，V26）：

- 评估基于同一来源执行、冻结集合、授权区域和固定指标实例。复用 EasyVObjectReadService 的所有权、撤权、范围收窄和版本检查；方案库只读该冻结集合，历史集合缺方案库返回 SCHEME_LIBRARY_NOT_RETAINED，不查询最新库。接口 POST /api/analysis/sessions/{sessionId}/objects/assess 仅接收 ObjectSelection，不接受客户端属性、权限或 SQL。
- V26 只补实际缺失的输入：区域 title_present 与组件 geometry（源 relativeX / relativeY / width / height 的百分比框）。区域产品 v3/schema 3、组件产品 v2/schema 2；旧冻结事实保持 null、不回填编辑器默认值。标题内容仍不进入 facts。几何或标题变化参与相应产品内容哈希，原有 L1–L4 统计签名不扩展。源 prototype-task 数据集仍为 v2，九产品清单和 Cube 统计模型保持当前契约。
- 领域函数 SchemeAdaptation 先检查区域类型、固定指标/槽位数量、百分比范围、不重叠、图表类别、有效可读尺寸与一对一分配。候选穷举当前源每区域 1–7 个指标的分配（最多 7!）；相同 metricId 的不同组件实例不合并。当前方案使用冻结源组件几何和原绑定顺序；候选使用冻结库槽位几何重新分配。库约束缺失/未知、未知图表族、未保留几何、无方案、无可行分配均有明确原因，失败结果 score=null。
- 规则 easyv-adaptation-v1 是显式启发式，状态 heuristic_pending_real_data_calibration。有效区域扣每侧 13px；有标题时预留 52px；同排/同列组件边距按当前原型编辑器排序扣半个 16px 间距。13px/52px 是评估包络，不能称为最终大屏的像素精确复现。阈值：indicator 120×64、chart 240×160、table 320×180、map 400×240。category 使用源 chart/indicator/table，donut 归 indicator，map 归 chart 但独立尺寸阈值；未认证的类别不加别名兜底。
- 分数仅在可行分配中计算 0–100 均值：可读余量 50%（宽高相对阈值的最小比例减 1，封顶 1）、角色 30%（indicator→summary、chart→main、table→table）、位置 20%（indicator 优先上部、table 优先下部、chart 优先中部）。未引入指标优先级、历史推荐权重或概率含义；也不是全局最优性证明。历史生成评分仍遵守 V24 的 available_unverified 口径，不与该分数合并。
- 区域属性面板提供用户主动“评估候选方案”、当前方案/候选分配示意、可行排序、尺寸/阈值与分项、失败原因、规则和产品版本。响应与选择引用不一致会被客户端拒绝。Web BFF 原样透传。每次评估将完整输入、候选、规则、来源引用和结果保存到现有 audit_events，保留 180 天；审计写入失败不返回成功。
- 候选范围为冻结库同 blockTypeId 全部方案，最多 200 项；超过限制明确报错，不截断后宣称已比较全部。界面首屏显示前六项，其余显式展开。此函数比较候选的适配条件，不修改 EasyV 原型或发布方案。
- 验证与运行证据见本次 .codex-runtime/b14-assessment-*.log 与截图。隔离浏览器用共享 Java 契约 fixture 验证可行分配、尺寸失败与历史库缺失，明确不连接本地正式库。完整 B 仍包含统一 Agent 对象/评估工具、B2 有限多步编排、B3 第二真实场景，以及真实生成输入认证、非管理员/真实源/模型/远端发布验收。

本轮门禁与本地运行：Java 全量 611 项，0 失败/错误/跳过，package 通过；方案库读取的补充 Testcontainers 5 项通过，旧/新约束和 SQL 参数范围保持指定版本。Web 120 通过、5 项可选容器跳过，tsc、相关 lint、Next.js 生产构建通过。本地正式库已备份并通过独立 migrate 升至 V26，区域 v3/schema 3、组件 v2/schema 2；Java 已重启。layout/block/component/scheme facts 和 jobs 均为 0，未注入业务 fixture。Java health=UP、Web 3000/login=200；Java 与 Web /objects/assess 未登录均返回 401/AUTH_REQUIRED。隔离浏览器证据明确不代表真实账号或正式数据验收。


B2.0 结果驱动的指标循环与逐次审计（2026-10-04）：

- 保持现有 Java Agent/Worker、`QueryIntent`、语义编译器、冻结范围、回答引用与结构化调整主链。自然语言执行每批真实指标结果后重新规划，模型只能选择追加合法查询、明确结束、澄清或不支持；结构化调整不再调用规划器。最多 4 次指标查询，重复的已编译查询拒绝执行；用尽次数仍要求追加时明确失败，不作部分结果的伪成功回答。
- `observations` 回传本轮实际结果、覆盖、区间、列与引用行，结果行仍最多 50 条，`totalRows` 保留完整行数。规划与回答共享 180 秒轮次预算，模型流超过剩余预算时取消并报告 `AGENT_EXECUTION_TIMEOUT`；同步工具在调用前后核验预算，沿用 Cube 的独立传输/轮询超时，因此这不是远端查询的强制取消机制。
- 每次指标查询使用既有 `subtool` 子审计：记录父调用、已编译意图、解析后日期、冻结产品版本、授权范围、完整当前期/对比期结果、SQL 和数据覆盖。所选对象读取也单独审计。租约仍由原记录器检查，失败不吞错；计划快照与真实事件按实际查询和再次规划顺序保存，历史回放继续使用原契约。
- 验证：Java 全量 626 项，0 失败/错误/跳过；Web 121 通过、5 个可选容器测试跳过；Java package、TypeScript、相关 ESLint 与 Next 生产构建通过。新增测试覆盖真实前置结果决定后续过滤、冻结范围一致、重复/上限/提前结束、后续澄清、工具失败、模型超时取消、完整审计与 50 行输入边界；Testcontainers 通过实际 JSONB 验证父子关联、结果、SQL 与 ISO 日期；Web 验证交错查询/规划步骤符合 JSON Schema、Zod 和 SSE 回放契约。证据在 `.codex-runtime/b20-*.log`。
- 本阶段不新增业务 schema 或迁移。本地正式库的 layout/block/component/scheme facts 仍全部为 0，没有把隔离测试结果写成业务数据。真实模型多步评测、真实源和非管理员验收尚未运行；easyv-dev 尚未发布。
- 下一阶段 B2.1：在同一有界循环中接入对象列表/详情、声明关系读取与适配评估；对象句柄只从服务端真实返回注册，用户选择不能扩大范围，调用继承当前执行及同一冻结集合。然后完成对象结果证据、比较视图、对象轮次追问与审计重放，最后推进 B3 第二真实场景和发布验收。完整 B 目标继续有效，B2.0 不表示 B2/B 已完成。


B2.1 同一 Agent 的对象工具、方案比较与回放（2026-10-04）：

- `EasyVSemanticAgent` 使用同一 `calls` 协议选择 `query_metrics`、`query_objects`、`read_object`、`traverse_objects` 和 `assess_scheme`。每步结果返回后再规划，最多 8 次工具调用、其中最多 4 次指标查询，继续共享 180 秒预算。对象列表最多返回 50 行，并保留 offset/hasMore；模型只能使用服务端注册的真实对象句柄。历史引用没有继承属性，使用时重新授权读取。
- 运行中的 Worker 尚无完成快照且不携带登录角色。对象读取与评估复用原服务的正式读取逻辑，运行时入口检查租约并继承当前执行、本体、冻结集合；从身份库核验当前账号状态、组织、角色与 EasyV 绑定，最多收窄冻结权限。用户选择由本体关系生成约束，历史句柄、详情、关系和指标查询都不能绕过它；执行期间范围变化明确失败。
- 工具接入曾暴露 `AnalysisService → 能力注册 → Agent → 对象读取 → AnalysisService` 循环依赖。对象读取改为复用会话仓储的 `requireOwned`、已发布本体和领域校验，保留原来的角色/冻结产品要求，解除反向服务依赖；没有启用循环依赖或使用延迟装配绕过。
- 每次调用沿用 `subtool` 父子审计，保存真实请求、冻结产品版本、授权范围和完整输出。对象结果与适配评估成为可引用证据；评估证据对模型限制 50 行，保留完整行数和候选集合是否完整，审计及比较视图保留完整候选。不可评估的 score 保持 null，规则仍明确标记为待真实数据校准的启发式。
- `_resolvedContext.toolCalls` 保存有序调用和真实引用。只读对象轮次可以没有指标 queries；原指标计划继续可读。JSON Schema、Web Zod、SSE/result 投影和 renderer registry 支持 `scheme-comparison`，直接展示本轮保存的评估，不在初次渲染时重复评估；区域选择继续携带冻结引用进入追问。
- 验证：Java 全量 640 项，0 失败/错误/跳过；Web 123 通过、5 个可选容器测试跳过；TypeScript、相关 ESLint、Next 生产构建与 Maven package 通过。测试覆盖对象列表 → 声明关系 → 方案评估 → 引用回答、伪造句柄/版本/历史引用、所选范围、账号组织/权限变化、运行中无完成快照、第 9 次调用拒绝、证据截断与完整审计、对象轮次追问和错误回放。Testcontainers 使用实际账号与 Worker 身份验证 Spring 装配及 PostgreSQL 父子审计 JSONB。Java 实际工具轨迹与共享 fixture 逐项一致；浏览器隔离验证比较卡片、依据展开、区域选择和无方案库反馈。证据：`.codex-runtime/b21-*.log`、`b21-scheme-comparison.png`。
- 本阶段没有新增业务迁移；正式本地 layout/block/component/scheme facts 均为 0。隔离 fixture 仅用于测试与界面预览，不是已发布业务数据。Java 已重启到本轮代码，8080 健康检查 UP，3000 登录页 HTTP 200；真实提交返回 `ONTOLOGY_NOT_PUBLISHED` 并重定向到页面，尚未进入 Worker 或调用真实模型。当前本地库没有已发布本体，也没有对象/方案事实；没有为通过运行检查伪造业务版本。真实源/真实账号、多步真实模型评测、规则校准、第二组合场景和 easyv-dev 发布仍未完成；完整 B 目标继续有效。

### B2.2 本地运行准备与真实模型工具验收（2026-10-05）

- 本地库先备份至 `.codex-runtime/b22-before-bootstrap.dump`，再通过既有管理员本体初始化接口发布 `ontology-java-multidomain-v2` / `2.0.0`。权限、完整性校验和审计沿用正式服务；审计为 `ontology.baseline.bootstrapped` / `succeeded`，请求编号 `5416941c-30dc-4455-8695-3ed9808e0950`。没有插入业务 facts 或补造冻结集合。正式提交现已通过本体前置检查，转为 `DATASET_VERSION_SET_NOT_PUBLISHED`，重定向回分析页显示具体原因；尚未进入正式库 Worker/模型执行。
- 真实模型评测发现 `time.compare` 被解析器静默忽略，对比问题变成单期查询。`QueryIntentCodec` 现在拒绝错误层级及未声明时间字段，交给已有一次纠正轮；不移动字段、不推断对比期。提示词给出完整调用结构。另补 Provider JSON 对象输出约束，继续由 Java 校验语义；使用方式依据 [DeepSeek JSON Output 文档](https://api-docs.deepseek.com/guides/json_mode/)，不增加 Provider 重试或 fallback。
- 对象回答中引用 `structureStatus` 元数据也被真实评测发现。回答协议明确只能引用实际 `rows[row]` 字段；失败反馈列出该行可引用的非空字段，使原纠正轮有明确依据。所有结果为空时返回空 citations，服务端继续使用已有数据范围证据；不编造行、字段或数量。对象列表为空后不以数量统计代替对象读取。
- 现有 `EasyVPlanningEvalIT` 保留 80 题、整体 ≥90% 与时间 100% 门槛。报告追加真实模型规划决策，失败时保存原始响应；每题输出进度，避免长时间无法判断运行位置。最终 `deepseek-flash` 达到 **80/80**，其中时间题 **55/55**；额外针对性回归 **7/7**。报告在 `.codex-runtime/b22-final-eval/easyv-planning-report.{json,md}` 与 `easyv-comparison-regression.json`，运行证据 `.codex-runtime/b22-planning-live.log`。这是本次结果，不等于对模型未来输出的稳定性保证。
- 同一 live IT 用隔离 Testcontainers PostgreSQL 的源 fixture，经正式源发布、产品物化和冻结入口生成九产品集合，再调用真实模型与正式 Agent/对象/评估服务。平台身份是实际 `EASYV_ANALYST`、绑定用户 16，Worker 不携带登录角色；源还包含用户 17。**4/4** 场景通过：版式列表 → 详情 → 区域/组件关系、当前/候选方案比较、旧集合未保留方案库、空对象列表。逐项核对真实对象 ID、产品版本、用户范围、父子审计输入与输出；关系场景须真正读到三个对象类型，调用名称本身不构成通过。评估须返回完整两项候选并有可计算分数。证据 `easyv-object-tool-report.json`。fixture 与评测账号只存在于自动销毁的容器，不写入正式本地库；直接调用有租约的 Agent，不将其描述为 Worker/SSE/浏览器端到端验收。
- 本地正式 layout/block/component/scheme facts 仍均为 0。公司网络不可达，真实源及实际非管理员账号验收、原始生成输入认证、规则校准、第二真实组合场景、easyv-dev 发布仍未完成。B2.2 只关闭本地准备、原 A 真实模型规划回归及四条隔离对象工具路径，完整 B 目标保持原范围。

本轮最终门禁：Java 默认单元/Testcontainers 套件 **644 项**，0 失败/错误/跳过，Maven package 通过；真实模型 live IT 三项门禁通过。Web **123 项通过**，5 个可选容器测试跳过、0 失败。证据 `.codex-runtime/b22-java-all-package.log`、`b22-java-summary.json`、`b22-web-all.log`。Java API/Worker 已重启到本轮代码，Web 继续使用本地 3000；本轮只改 Java 与验收代码，前端生产构建仍沿用 B2.1 的已验证结果。正式运行仍受未发布数据集合阻断。

### B2.3 真实模型多轮选择、Worker 与历史回放（2026-10-05）

- 复用 `EasyVPlanningEvalIT` 与原对象工具评测 helper，在自动销毁的 PostgreSQL 容器中，经正式源发布、物化、冻结入口构造旧/新两套集合。实际账号为 `EASYV_ANALYST`，绑定 EasyV 用户 16；源包含用户 17，执行由正式 Worker 领取，重新核验当前账号。测试不伪造完成快照或手工拼装追问执行上下文。
- 四轮 `deepseek-flash` 执行均完成：区域列表/详情 → 显式选择区域评估方案 → 从保存的评估追问继续选择并读取组件 → 普通追问“刚才这个组件属于哪个区域”。中途发布更新集合；前两条显式对象追问固定来源集合和产品版本，普通追问按既有契约绑定最新完整集合。逐项核对用户 16 的真实对象 ID、产品版本、父追问与来源执行、完成状态、全部父子审计。
- 真实运行发现普通追问绑定新集合后，历史对象句柄仍携带旧产品版本，正式 Worker 报 `OBJECT_VERSION_MISMATCH`。修复仅在 `EasyVAgentTools` 的历史句柄注册处：历史轨迹提供对象身份，执行产品版本来自当前冻结集合；不继承历史属性，必须通过正式对象服务重新授权读取。历史轨迹与快照不改写，显式选择仍固定来源集合。补测试覆盖重新读取及当前对象已不存在/无权访问；失败不恢复旧属性、不返回默认值。
- 四轮分别保存 **74 / 51 / 54 / 48** 条事件。真实签名 Cookie 与持久化登录会话进入正式 SSE Controller，直接消费 `StreamingResponseBody`；输出逐帧匹配持久化事件，完成事件关闭输出，`afterSequence` 续读没有重复/漏项。历史快照经正式读取入口重放，结果、选择、数据版本与原执行一致。此验收覆盖 Worker、数据库、身份与 SSE Controller，不声称已覆盖 HTTP 代理和浏览器实时渲染。
- 证据：`.codex-runtime/b23-worker-followup-report.json` 保存各轮真实规划决策、完整快照、事件、审计与 SSE 帧；`.codex-runtime/b23-worker-live.log` 为修复后通过记录，`b23-worker-before-fix.{json,log}` 保留故障。针对性 Java 测试 **57 项**通过；Web **123 项**通过，5 个可选容器测试跳过。
- 最终门禁：Java 默认单元/Testcontainers 套件 **646 项**，0 失败/错误/跳过，Maven package 成功；Web **123 项**通过，5 个可选容器测试跳过。证据 `b23-java-all-package.log`、`b23-java-summary.json`、`b23-web-all.log`。首次全量命令误带本地 EasyV-only 领域开关，导致三个既有 Property/双域套件失败；已按项目标准默认环境重跑通过，保留 `b23-java-with-local-domain-flags.log`，未调整断言或产品行为来绕过。
- 正式本地 layout/block/component/scheme facts 仍为 0，Java API/Worker 已重启到本轮代码，8080 健康检查 UP、3000 登录页 HTTP 200。隔离评测没有写入正式业务库，没有发布 fake 业务版本。完整 B 的真实数据与发布验收仍未完成。

下一步按依赖推进：完成指标到对象下钻的真实模型验收，并补 HTTP/浏览器执行与历史页面验证；公司网络恢复后，以真实源重新发布结构/几何/方案事实，在实际非管理员账号上核验范围、结构与独立 SQL 对账；再完成 §11.7 第二真实组合场景、原始生成输入核验/规则校准和 easyv-dev 发布。沿用现有 Agent/工具/组件，不按问题追加专用流程。


### B2.4 统计到对象的真实模型 HTTP 闭环（2026-10-05）

1. 复用 B2.3 的隔离源发布/物化 fixture，连接实际 Cube 与 Redis，沿正式 Java HTTP 登录、提交、Worker、SSE 和历史读取链执行。正式本地业务库不写入测试数据。
2. 验收同一轮“已解析原型数/区域总数/组件总数 → 版式对象 → 区域/组件关系”；数字、用户范围与产品版本必须和独立 PostgreSQL SQL 一致。
3. 从返回的真实区域引用发起选择追问，在同一冻结集合完成组件统计与候选方案评估；HTTP 续读、完成事件、历史快照、审计和无权访问须可核验。
4. 完成匹配影响范围的门禁并记录证据。此段不代替真实公司源、浏览器/BFF 完整验收、生成时输入核验/规则校准、第二真实组合场景和 easyv-dev 发布。

状态：B2.4 已通过真实 HTTP 验收和匹配门禁，本地 API/Worker 已更新。完整 B 仍有下述后续验收目标。

- 新增显式 live 门禁 `EasyVRuntimeEvalIT` / `EasyVHttpRuntimeEval`，使用真实 DeepSeek、Cube、Redis、Java HTTP 和正式 Worker；业务源 fixture 只在 Testcontainers PostgreSQL 发布和物化，平台登录 Cookie 由真实登录接口签发，模型输出没有 mock。
- 第一轮统计已解析原型数、区域总数、图表组件总数均为 **1**，与独立 SQL 相符；全库同时存在用户 17 的版式，用户 16 的统计/对象/关系结果始终限定其授权范围。第二轮从第一轮真实区域引用追问组件统计与候选方案评估，确认编译后 `blockKey` 约束、冻结集合/产品版本、两项候选结果和正式审计。
- 复现并修正真实 SSE 故障：Worker/数据库已有 104 条事件，但实时 HTTP 仅收到前 100 条；末尾综合回答、工具完成与最终 completed 事件丢失。已核对实际 Tomcat 11.0.22 的 Connector 默认异步超时 **30 秒**，原分析流超时为 5 分钟，两者不一致。`spring.mvc.async.request-timeout` 直接复用 `dip3.stream.timeout`，不增加新的配置选项、重试或事件兜底。
- 确定性验证每轮首次真实模型规划前等待 32 秒；最终执行 `e0f6f771-718c-3a37-afb9-01a65c956e1c` / `a633429c-f1b4-35de-9890-cdea485f8780` 分别持续 **47,988 / 43,616 ms**，完整收到 **70 / 45** 条 SSE，与数据库事件逐帧一致，包含 completed 和最终渲染块。`afterSequence` 续读及 HTTP 历史快照也逐项一致；无登录 HTTP **401/AUTH_REQUIRED**，另一个实际登录账号 HTTP **404/SESSION_NOT_FOUND**。
- 首次 live 调用的回答 JSON 连续两次无法解析。沿用现有纠正轮次与错误码，将 Jackson 原因及行/列加入解析错误，补未转义换行的单测；没有放宽 JSON 契约或自动修复输出，也不宣称模型此后不会再次产生无效 JSON。另一次失败是验证脚本只接受区域 `componentTotal`，而模型实际使用组件 `count`；现按相同区域约束及实际值验证这两种本体声明的有效查询，未改变运行时查询规则。
- 证据：`.codex-runtime/b24-http-runtime-report.json`、`b24-http-fixed.log`；保留首次模型失败、断言修正前和 SSE 截断失败报告/日志，避免成功覆盖故障记录。Java adapter/Agent/tools 聚焦门禁 57 项通过；最终 Java 默认单元/Testcontainers 门禁 **647 项**，0 失败/错误/跳过，Maven package 成功；Web 门禁 **123 项**通过、5 个可选容器测试跳过。全量证据 `b24-java-all-package.log`、`b24-java-summary.json`、`b24-web-all.log`。

- 本地 API/Worker 已加载本轮修复，8080 health=UP，3000 经真实种子登录后工作台 HTTP 200，固定本体 2.0.0 ready；layout/block/component/scheme 正式 facts 仍均为 0。证据 `b24-runtime-ready.json`；未向正式业务库写入隔离评测数据，也未发布到 easyv-dev。

下一阶段 B2.5：沿当前 Web BFF 与页面执行入口，验证指标 → 真实对象 → 区域选择追问的页面呈现、加载/执行状态和历史恢复，复用 Java HTTP 合约。真实公司源/账号、原始生成输入核验与规则校准、§11.7 第二真实组合场景及 easyv-dev 发布仍属于完整 B 的未完成目标。


### B2.5 页面与 BFF 全链验收（2026-10-05）

1. 复用 B2.4 的隔离源发布/物化与实际 Cube/Redis，以非管理员账号沿完整 Next 页面/BFF、Java API、自动 Worker 和真实模型执行；使用当前 Web standalone 构建，隔离页在 localhost:3100，不覆盖 127.0.0.1:3000 的 Cookie 或业务库。
2. 验证发起/执行状态、三个指标、版式/区域/组件浏览、明确选择后的统计与方案追问；页面显示须与正式快照和独立 SQL 一致。
3. 从 BFF 订阅实际运行中 SSE，和持久事件逐帧对照；刷新页面、重开历史与对象选择来源保持一致。桌面及窄屏截图作为人工浏览器证据，不把 HTTP 测试冒充浏览器验收。
4. 仅修复复现的问题，完成 Web/相关 Java 门禁、记录证据并清理隔离进程。真实公司数据、输入核验/评分校准、第二真实组合场景与远端发布仍保留为完整 B 的后续目标。

状态：B2.5 隔离真实模型浏览器/BFF 验收通过；完整 B 的实际业务数据、校准、第二场景与远端发布尚未完成。

- 新增显式人工 live 门禁 `EasyVBrowserEvalIT`：复用 B2.4 的 PostgreSQL/Cube/Redis 容器与源发布/物化 helper，启动正式自动 Worker 和 Web standalone 构建。只有 `RUN_EASYV_BROWSER_EVAL=1` 才执行；在 `.codex-runtime/b25-browser-ready.json` 给出隔离入口，等待实际浏览器观察写入 `b25-browser-done.json`，校验结果/引用/事件与关键观察，20 分钟内没有完成标记则失败，最后清理 Web 与容器。
- 首次启动探针失败：JDK HTTP client 默认 h2c Upgrade 在本地 Node HTTP 服务上报 `HTTP/1.1 header parser received no bytes`；同一 localhost/127.0.0.1 探针显式 HTTP/1.1 后均返回 200。仅修正测试驱动的 HTTP 版本，并采用与 Web 镜像相同的 standalone server/static 运行入口，未加入产品兼容或重试。保留 `b25-browser-startup-failed.log/json`。
- 浏览器复现 UI 根因：源布局的 Layout 直接包含 Block，Java 已正确发布/返回区域，展示端却先遍历 Layout 的孩子，把 Block 当成容器，导致结构图报“结构中没有可展示的区域或主视觉”。复用同一个 `walk` 从 Layout 开始处理，消除重复的根节点遍历；不补造结构或尺寸。新直接 Block 回归断言修复前失败，修复后与已有嵌套、横纵排布、主视觉、非法几何测试通过。修正前 HTTP/数据库检查通过，但浏览器 `canvasSelectable=false`，不能据此宣称 B2.5 完成；证据保留于 `b25-before-projection-fix-report.json/log`、`b25-projection-before-fix.log`。
- 执行中的输入框仍禁用，但提示原为“首轮分析未完成，发送将以新会话重新分析”；现使用已有禁用状态展示“正在分析，完成后可继续追问”，未完成且可以重新发起时保留原提示。未改变提交、权限、查询或 Worker 合约。
- 最终由页面登录非管理员 `browser-eval-analyst`，提交统计/对象问题，从画布选择区域、浏览组件并确认所属区域高亮，再明确选择区域进入追问。会话 `dbeb56af-cf9d-4d53-9a46-6edf5f3c1b8d`：根执行 `250570fc-295c-3e00-b203-413699b8461b`、选择追问 `7db3801c-85c6-3cac-9950-3bca276be520` 均 completed，同属 `browser-eval-full-set`。三个统计与独立 PostgreSQL SQL 均为 1，区域引用为 `16:page-1__b_1`，当前方案及候选 39/40 的结果显示在正式比较组件中，规则仍标注待真实数据校准。
- 正式 BFF 在实际运行中订阅两轮 SSE，完整 **108 / 44** 条事件与数据库逐帧一致，含最终 completed；两轮审计均 completed。默认窗口与 **390px** 浏览器验证画布、组件关联、区域追问、刷新和从会话地址重开历史；根统计表只出现一次、两个候选及选择引用正确恢复。取消选择移除当前输入框选择条。390px 下 document/body 宽度均为 390，无页面横向溢出，浏览器错误/警告列表为空；测试视口已恢复。
- 门禁：显式 Java browser live IT **1 项通过**（编译当前测试源码并实际执行）；Web **124 项通过、5 个可选容器测试跳过**，TypeScript、改动文件 ESLint、Web build 均通过。Java 产品代码本阶段未改动，上一阶段默认 647 项全量门禁仍作为基线，本阶段未重复执行。证据 `b25-browser-report.json`、`b25-browser-live.log`、`b25-web-all.log`、`b25-tsc.log`、`b25-lint.log`、`b25-web-build.log`；截图 `b25-running-desktop.png`、`b25-canvas-desktop/mobile.png`、`b25-followup-running-mobile.png`、`b25-comparison-mobile.png`、`b25-history-mobile/desktop.png`。
- 隔离 3100 Web 及测试容器已退出，正式 3000/8080 仍为 HTTP 200/health UP；正式 layout/block/component/scheme facts 仍为 0，没有向业务库写入测试输入或发布到 easyv-dev。

下一阶段 B2.6：核对真实源连接、原型结构/几何与方案库覆盖以及实际账号主体映射，沿治理发布链产生真实冻结集合；在真实非管理员账号上重复本阶段流程并与独立 SQL/源结构对账。原始生成输入的可核验性与规则校准继续显式记录，随后按 §11.7 完成第二真实组合场景及发布。源不可达时保留实际诊断，不能用隔离测试输入替代正式业务事实。
