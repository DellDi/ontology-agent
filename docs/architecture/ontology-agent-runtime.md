# Ontology Agent Runtime：本体契约 + 受治理工具 + 多步智能体

> 状态：Baseline（2026-09-24）；2026-09-29 补充经用户确认的原型设计分析与可复用呈现路线（§11）。
> 实施状态：A 已部署，评测稳定性见 §10；§11 为已确认方向、待实施计划，不代表已具备配置化接入或原型结构分析能力。
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

**A 扩展 + B1 原型设计分析（待实施）**

按 §11.6 顺序交付；属于 A 的领域建模扩展与 B 的首个完整业务场景，不另建 Agent 主链。当前轮次只更新路线图。

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


## 11. 原型设计分析与可复用呈现路线（2026-09-29，经用户确认，待实施）

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

以下均为待实施，不改变 §9–10 的历史验收结论；后续执行须逐项附证据更新状态。

| 顺序 | 交付内容 | 退出门禁 |
|---|---|---|
| 1. 源数据与口径核查 | 核实部署实际源库中的原型结构、方案库、指标、评分持久化与历史；形成字段映射和真实样本 | 源记录 → 结构解析 → 对象关系逐项核对；明确缺失字段、权限与版本边界；冻结首轮指标口径 |
| 2. A 扩展：结构与统计 | 在现有 ingestion/本体/Cube 链路增加最小对象及关系，完成分布统计与明确口径的重复分析 | 同一冻结集下统计与独立查询/人工标注一致；解析失败可定位；更新/删除、父应用范围与重跑一致性通过 |
| 3. B1：对象分析与可视化 | 对象查询、领域评估函数、有限多步分析；原型画布、候选比较、选择/高亮联动 | §11.7 在真实账号下走通；每个数字与高亮可定位证据；未授权对象不可读；错误、超时/步数限制、未知视图可诊断 |
| 4. 复用与发布 | 第二个真实组合场景复用工具/组件，发布到 easyv-dev | 变更指标、对象集合、着色或布局组合不改通用 Agent 与页面主链；浏览器交互、窄屏、契约和相关测试通过；原 A 评测发布前重跑 |

函数评测覆盖准确性和边界条件；模型评测覆盖对象指代、关系查询、工具选择、澄清及不支持问题，不能只验证答案措辞。
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
