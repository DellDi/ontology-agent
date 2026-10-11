# EasyV 生成质量评估：价值定义、问题集、验收口径与采集设计（草案 v3）

> 状态：**方向已获用户确认并授权推进；首批采集、发布及展示修正已完成，业务验收未闭环**（2026-10-10）。D1–D5 已有答复（§7）；U1 按用户答复保留现有生命周期。当前进度见 §8、§10、§13 及 [实施与验证](./easyv-quality-p0-implementation.md)，不得把最初的设计草案当作当前未实施状态。
> 与既有文档的关系：本工作属于 [运行时总路线的 B：对象与智能体](../architecture/ontology-agent-runtime.md#6-分阶段目标与退出门禁)。[业务问题验收清单](./easyv-business-questions.md) 与运行时 §14.14/§14.15 的问题及失败记录保留；当前主线衔接见运行时 §14.16。
> 证据环境：§3.2 保留最初本地 3000 快照的规模参考；2026-10-10 后续源端覆盖核实、发布与自然问题试运行来自公司验收 easyv-dev（3100），见实施记录。源码核实不等同于公司源服务部署版本认证；本地快照验证不等同于真人业务验收。

## 0. 与 A/B/C/D 总路线的关系

总路线没有改名：**A 语义问数 → B 对象与智能体 → C 动作闭环 → D 运营化**。

- 当前工作在 **B**：复用 A 的统计能力，把需求、处理记录、原型和关联原话接到既有对象读取与智能体链路，验证结果能否帮助质量判断。
- 本文 §6 的 **P0/P1 是字段补采优先级**，不是产品阶段。§4 的 A/B/C 是问题可答性，也不是总路线。
- **C** 保留真实动作接入门禁：先明确目标 API、权限、对象与可验证结果，再实施行动闭环。
- **D** 保留持续运营门禁：周期采集、对账、失败告警和持续运行不能由一次发布代替。
- 在线配置、本体版本管理与发布按用户远期规划推进，不在本批预建配置平台。

## 1. 为什么重做

| 现象 | 证据 |
|---|---|
| 问题由"现有数据能展示什么"决定 | 80 题规划评测集围绕平台运营指标与时间表达（含 55 题时间题），没有一题问原型的布局、组件或主题；B4–B7 的验收路径是"点击下钻后 ID 集合与 SQL 一致""453 组件翻 23 页" |
| 验收用同一份数据自证 | 提问、取数、对账都在同一份 facts 内完成，证明"回答等于数据"，不证明"回答帮到谁做了什么决定" |
| 测试账号不代表真实使用者 | §14.14 用 `acceptance-scoped`（只能看自己的 33 个原型）验收；质量评审需要看全局 |
| 最有价值的信号没有进入库 | 源端记录了用户需求原文、逐轮修改指令、评分标签，本项目只采了计数（见 §3） |
| 产品团队自己已在看这类指标 | 源端已有"使用日报"（`AiUsageReportMapper`）：意图分布、失败与未支持样例、用户提问明细、已删除应用统计。本项目的问题集应与之对齐并超越，而非另起炉灶 |

## 2. 产品与业务价值（草案，由产品负责人确认）

> 本节是对产品方向的**假设**，未经真实使用者验证，**不设任何目标值**。产品负责人确认或修订后，§4 问题集随之调整。这是一个超前规划的产品，价值定义先于使用者反馈；真实使用者评审作为后续校准（§5 第 3 条）。

### 2.1 产品定位

面向 AI 大屏生产团队的**生成质量闭环工作台**：把用户在生成、修改、采纳、放弃、评分中留下的真实信号，转成可定位、可归因、可验证的质量判断与产品决策。

与源端使用日报的区别：日报是计数看板（意图分布、失败样例、截取 80 字的提问）；本产品要做到**下钻到单个原型和单轮对话、区分问题的归属、验证修复是否生效**。

价值闭环：**看见 → 定位 → 回看 → 归因 → 行动 → 验证**。每个问题必须落在闭环的某一环，并写明"结论触发什么行动"；写不出行动的问题不进问题集。

### 2.2 业务价值假设

| 编号 | 假设 | 衡量 | 度量现状 |
|---|---|---|---|
| V1 | 减少用户为同一诉求反复修改与失败 | 返工轮次分布；被拒/澄清占比；修改轮次失败率 | 部分可度量，需补采（B） |
| V2 | 提高生成结果被采纳的比例 | 采纳率（另存） | 可度量（A），口径见 3.1 |
| V3 | 缩短"发现质量问题 → 定位 → 修复"的周期 | 质检队列命中；修复后同类问题是否下降 | 需补采（B） |
| V4 | 产品路线图由真实诉求排序 | 不支持诉求的频次与原话 | 需补采（B） |
| V5 | 一次性评审沉淀为可复用资产 | 标注样本数；评分规则校准 | 需新增能力（C）；B1.4 的 30 项标注至今为空 |
| V6 | 成本与质量可以一起看 | 单位采纳成本（token / 积分） | 需新数据源（C）：`ai_token_usage` 与积分结算未进本项目 facts，源端使用日报已有 token 汇总 |

### 2.3 候选指标（口径警示在最后一列；目标值由产品负责人设定）

| 指标 | 定义 | 口径警示 |
|---|---|---|
| 采纳率 | 至少另存过一次的原型数 / 生成的原型数 | 另存不等于满意；标记只落在最近一条 `appGeneration` 行 |
| 返工轮次 | 每个原型的有效修改轮次，看中位数与尾部 | 一行是一轮；须用 `intent` 排除 `ACK` / `CLARIFY` / `OUT_OF_SCOPE`；`intent` 部分失真 |
| 首轮可用率 | 生成后没有有效修改就被另存的原型占比 | 需 `intent` 排除非修改轮次 |
| 被拒/澄清占比 | （`OUT_OF_SCOPE` + `CLARIFY`）轮次 / 全部对话轮次 | 需 `intent` |
| 失败率 | Forge 任务失败 / 任务数；修改轮次 `execute_result=0` / 轮次数 | `execute_result` 混合了业务结果与积分结算结果 |
| 放弃率 | 被用户删除的应用 / 生成的应用 | 内部用户的删除可能是清理测试数据，须结合用户与时间判断 |
| 单位采纳成本 | 被采纳原型平均消耗的 token / 积分 | 需新数据源 |

### 2.4 使用者

三类角色由业务方指定；"现在怎么做"待角色本人确认。

| 角色 | 闭环位置 | 要做的决定 | 现在怎么做 |
|---|---|---|---|
| 生成质量负责人 | 看见、归因、验证 | 本期质量是否变差；先改哪类场景；修复是否生效；成本是否可接受 | 待确认（可能是使用日报） |
| AI 生产大屏质检员 | 定位、回看、行动 | 有限人力先检查哪些原型；单个原型的问题归属；哪些样本值得沉淀 | 待确认 |
| AI 大屏产品经理 | 归因、行动 | 下个迭代补哪些能力；默认生成策略哪里有偏差；新能力是否值得继续投入 | 待确认 |

普通用户也可能评判生成好坏，其反馈（评分、标签、另存、删除）是证据来源，不是本文的提问者。

## 3. 质量评估的证据链与现状

目标链路：**需求原文 → 生成结果 → 用户逐轮修改 → 采纳 / 失败 / 放弃**。

| 环节 | 源端位置 | 本项目现状 |
|---|---|---|
| 需求原文 | `dt_ai_operation_log.user_input`（`prototypeGeneration` / `promptCompletion` 行，值为 `sceneDescription`） | 未采 |
| 系统对需求的理解 | Step0 润色后的需求（`simpleDescription` / `fullDescription`）；**Step1 完整输出落库**（`ai_pipeline_node_record.output.raw`）：`appName`、`pageTitle`、`coreIntent`、`businessContext`（`industryCategory`、`audienceType`）、`screenObjective`、`themes[]`（`businessModule`、`intent`、`moduleDescription`、`constraints[]`：`USER` 带用户原话依据）、`interactionRequests[]`（`rawInstruction`、`supported`、`unsupportedReason`） | 未采 |
| 生成结果结构 | `ai_screen_prototype` | 已采（结构、几何、签名） |
| 生成过程是否降级 | 流水线节点 `status`，取值 `SUCCESS` / `FALLBACK` / `FAILED`（`DbRecordObserver.deriveStatus`） | **已采**；本地快照 MAIN 分支只见 `SUCCESS` / `FAILED`，**无 `FALLBACK` 事件** |
| 用户逐轮修改 | `dt_ai_operation_log`（`chatRefactor`，一轮一行，`user_input` 为用户原话）；`ChatExecution` 节点（`intent`、`status`、`show_message`，部分带 `output.blockId`、`progressSnapshot.{goalSummary, planSummary, flowNodes, resultSummary}`） | 仅采轮次的时间与 `execute_result`；**无原话、无意图、无摘要** |
| 失败与拒绝原因 | `operation_log.fail_reason`；`ChatExecution.status` | 仅采 `execute_result`（0/1） |
| 采纳 | `is_save_as_edit`（标记在该应用最近一条 `appGeneration` 行） | 已采 |
| 评分与理由 | 整屏：1–5 分 + `description`（`反馈标签：…` + 自由文本，≤1024 字）。单轮：对话消息的赞/踩，写成该轮 `rating`＝4/2 | 仅采 `rating` |
| 评分时的整屏载荷 | `metadata`：前端传入 `{screenId, xml, prototypeScreenData, pageComponentsMap, appName}`，GZIP+base64 | 不采（见 D4） |
| 用户删除应用 | `ai_screen_app.is_delete`（逻辑删除，原型保留）；**同时物理清除**会话、全部 `ai_pipeline_node_record`、token 用量、指标池、上传文件（`cascadePurgeByApp`）；`dt_ai_operation_log` **不在清除范围** | 应用墓碑已采；节点记录随源端消失 |
| 每轮修改前后的原型差异 | **未发现**：原型只保留最新态 | 无 |

评分标签词表固定：1–2 分「质量欠佳 / 效果不好看 / 结果不可用 / 其他」，3 分「基本可用 / 仍需调整 / 不够顺手 / 其他」，4–5 分「理解准确 / 效果美观 / 超出预期 / 其他」，可直接聚合。

先例：Forge 失败原因原文已入库（`EasyVCanonicalTransform.failureReasonText`，同时保留 md5 作稳定分组键），"facts 不保存自由文本"这条原则在此处已被突破，本文沿用同一模式。

### 3.1 口径陷阱（源码与台账已登记，解读数据前必读）

1. **`chatRefactor` 一行是一轮对话，不是一次修改。** 所有 chat 意图都记日志，含 `ACK`（闲聊）、`CLARIFY`（澄清）、`OUT_OF_SCOPE`（不支持）。整屏重做记为 `prototypeGeneration`，指标池扩充记为 `metricGeneration`。
2. **`execute_result=1` 不等于诉求被满足。** 它同时受业务结果和积分结算结果影响；源仓库 `docs/TODO.md` 登记过"并发块重构互相覆盖，丢指令仍记 SUCCEEDED""多指令第二件中断仍报成功""主视觉替换被执行成整块重做"。这些条目的当前修复状态**未核对**。
3. **`intent` 标签部分不可靠。** TODO 登记 `AddMetricPlanner` / `ReplaceMetricByNamePlanner` 的标签写死为 `BLOCK_REPLACE_BY_DIALOG`。用 `intent` 分类必须抽样对照 `user_input`。
4. **`is_save_as_edit` 是"把 AI 结果另存进编辑器"，不是满意度。**
5. **评分稀疏，且分两层**：本地快照 1128 条操作里约 10 条有评分（整屏 4、单轮赞踩 6）。
6. **源端使用日报的"应用二次修改"只枚举了 8 种意图**，未含加指标、换布局、改标题、加删模块等；若沿用其口径会系统性低估修改量。
7. **删除应用会使对话记录从源端消失**，本项目采集的副本可能成为唯一留存（见 D3）。

### 3.2 本地快照的实测数字（仅作规模参考）

- 692 轮 `chatRefactor`，其中 57 轮 `execute_result=0`（涉及 21 个原型）；60/120 个原型至少有一轮，最多的一个原型 70 轮。
- 20/120 个原型被另存；其中 9 个同时有过对话修改。
- 15 个原型的 `prototypeGeneration` 不止 1 条（整屏重做还是重试，待区分）。
- 692 条里 690 条的 `task_id` 能关联到 CHAT 分支节点，说明采集后可按轮次关联。
- 用户高度集中：两个用户占 63/120 个原型。任何"哪类更好"的结论都会被用户差异混淆。

## 4. 问题集 v3（草案）

产生方式：先由 §2 的价值闭环与角色决策推出问题，**再**标可答性；不因数据不可答而删题。每题写明"结论触发的行动"，写不出行动的不收。

可答性：**A** 现有数据可答；**B** 需补采集；**C** 需新数据来源或新增能力（含依赖上游，见 §7 D5）。

### 4.1 生成质量负责人

| 编号 | 问题 | 结论触发的行动 | 可答性 | 依赖 |
|---|---|---|---|---|
| QO1 | 近两周整体质量比上两周好还是差？采纳率、返工轮次、失败率、被拒占比各是多少？ | 是否升级处理本周质量问题 | A + B | 采纳、失败已有；被拒与返工需 `intent` |
| QO2 | 哪类需求（行业/场景、有无数据文件）的首轮可用率最低？ | 优先改哪类场景的生成策略或模板 | B | 需求原文、Step1 `industryCategory`、采纳、轮次 |
| QO3 | 生成后用户最常让 AI 改什么？ | 把高频修改前移为生成默认 | B | `intent`、`user_input` |
| QO4 | 失败和被拒的修改指令，原因分布如何？哪些是系统缺陷，哪些是能力边界？ | 缺陷进修复队列，边界进产品需求池 | B | `fail_reason`、`intent` |
| QO5 | 某项修复上线后，同类问题的失败/返工率下降了吗？ | 确认修复有效，或回滚 | B | 分类（QO3/QO4）+ 发布时间点 |
| QO6 | 哪些原型被用户直接删除？删除前经历了什么？ | 找出"放弃"的主要诱因 | B | 删除后保留策略（D3） |
| QO7 | 产出一个被采纳的大屏平均消耗多少 token / 积分？哪类需求最贵？ | 成本与质量的取舍、配额依据 | C | `ai_token_usage`、积分结算，需新数据源 |
| QO8 | 有没有"回复成功但屏上没变，或变过头"的轮次？ | 是否补硬校验 | C | 每轮前后原型差异（上游 U2） |

### 4.2 AI 生产大屏质检员

| 编号 | 问题 | 结论触发的行动 | 可答性 | 依赖 |
|---|---|---|---|---|
| QI1 | 今天先检查哪些原型？依据是什么（返工轮数、失败、被拒、整屏重做、降级）？ | 生成当日检查队列 | A + B | 轮次计数与降级状态已有；失败/拒绝类型需补采 |
| QI2 | 打开一个原型：用户要什么、系统理解成什么、生成了什么、用户依次说了什么、每轮结果如何、最后采纳了吗？ | 判定问题归属：需求理解、生成、修改执行、能力边界 | B | 需求原文、Step0/Step1 理解、用户原话、`show_message` |
| QI3 | 用户对这个原型的哪个区域或指标反复修改？ | 定位具体生成缺陷 | B（部分） | `ChatExecution.output.blockId` 仅部分意图填写，覆盖率待核实 |
| QI4 | 用户这一轮的话与屏上实际变化一致吗？ | 标记"执行与指令不符"的缺陷 | C | 同 QO8 |
| QI5 | 这次生成哪些环节降级或用了兜底？ | 区分系统降级与用户诉求 | A | `status=FALLBACK` 已采；本地无此类事件，验收可能判"样本不足" |
| QI6 | 同一个诉求用户说了几遍？ | 重复指令是"没做对"的强信号，优先检查这些轮次 | B | `user_input` 与轮次顺序；相似度判断属模型推断，须标注 |
| QI7 | 系统对需求的理解与用户原话有偏差吗？ | 标记需求理解错误，反馈给 Step0/Step1 | B | Step1 `coreIntent` / `themes` / `constraints` 与 `user_input` 对照；对照结论属模型推断，须标注 |
| QI8 | 我标注一个原型"好/差/原因"后，能沉淀成评审样本吗？ | 进入评分规则校准集（B1.4） | C | 需新增标注能力 |

### 4.3 AI 大屏产品经理

| 编号 | 问题 | 结论触发的行动 | 可答性 | 依赖 |
|---|---|---|---|---|
| PM1 | 用户提了哪些当前不支持的诉求？按频次排序，各给几条原话。 | 进入下个迭代需求池 | B | 对话 `OUT_OF_SCOPE`；Step1 `interactionRequests[supported=false]` 的 `rawInstruction` 与 `unsupportedReason` |
| PM2 | 哪类修改最频繁？说明默认生成有什么系统性偏差？ | 调整默认生成策略 | B | `intent`；注意 3.1 第 3、6 条 |
| PM3 | 哪些版式、主题、图表组合更容易被采纳？哪些常被换掉？ | 推荐或下线某些版式与方案 | A + B | 采纳已有；"被换掉"需 `intent`；样本小 |
| PM4 | 哪类需求一上来就被整体推翻重做？ | 判断需求理解（Step0/Step1）是否要改 | B | 需求原文、`GLOBAL_REGENERATE` / 换布局 |
| PM5 | 澄清之后，需求能被满足吗？ | 澄清话术是否有效 | B | `CLARIFY` 轮次与后续轮次的关联 |
| PM6 | 新上线的能力（换布局、改标题、交互配置等）用的人多吗？成功率如何？ | 继续投入还是下线 | B | 对应 `intent`；`Intent` 枚举里已有这些意图 |
| PM7 | 重度用户与轻度用户的使用和采纳有什么差异？ | 避免被少数用户的偏好带偏 | A + B | `user_id` 已有；本地快照两个用户占 63/120 个原型 |
| PM8 | 用户评分低时选了什么标签、写了什么？ | 定位不满意的主要类型 | 样本不足 | 标签词表固定可聚合，但评分仅约 10 条，**不作主指标** |

分布：A 1 题、A+B 4 题、B 14 题、C 4 题、样本不足 1 题，共 24 题。

### 4.4 首批交付建议

- **无需采集即可先交付（阶段 1）：** QI5，以及 QO1、QI1、PM3、PM7 中现有数据可答的部分。目的是让角色先看到结果，校准"问得对不对"。
- **补采 P0 后最先兑现价值：** QO3、QO4、QI2、PM1、PM2。它们直接对应 V1、V3、V4，且依赖的字段集中在 §6.1 的 P0。
- **留待上游或新来源：** QO7、QO8、QI4、QI8。

## 5. 验收口径

沿用既有四档判定（支持 / 部分支持 / 不支持 / 样本不足），改变**谁来判**与**判什么**：

1. **由对应角色判定。** 每题由对应角色回答"这个结果能否直接支持我的决定"，记录角色、日期、结论；实现方不得自评为"支持"。
2. **事实对账保留，但只是必要条件。** 对账通过而角色判定为"不支持"，记为不支持。
3. **真实使用者评审是校准，不是前置。** 本产品超前规划，价值定义由产品负责人先行（§2）。首批 A 类结果交付后，由三类角色逐题标注"问对了 / 问偏了 / 缺了什么"，并各补若干自己的问题；"现有数据不可答"是有效结果，用来驱动采集，不用来改题。
4. **验收账号用管理员（D2）。** 质量评审类问题使用 `PLATFORM_ADMIN`（`accessMode=all`，本地为 `acceptance-admin`）；`acceptance-scoped` 代表单个普通用户视角，不用于本文问题。不新增角色。
5. **对照使用日报。** 凡使用日报已有同类指标（意图分布、失败样例、提问明细），验收须说明本项目的结果与其口径差异（见 3.1 第 6 条），不得出现无解释的数字分歧。
6. **决策基线（待使用者确认）。** 例如质检员"选出该先检查的 N 个原型"，对比其现有做法的耗时与命中；现状做法未知前，不写入通过标准。
7. **不改题换通过。** 首轮失败保留，重跑须在修复后用原题。

## 6. 采集设计

### 6.1 优先级

| 级别 | 字段 | 来源 | 支撑的问题 |
|---|---|---|---|
| P0 | `user_input`、`fail_reason`（全部 `ai_action_type`） | `dt_ai_operation_log` | QO2–QO4、QI2、PM1、PM2、PM4 |
| P0 | `intent`、`session_id`（`ChatExecution`）；`output.blockId` | `ai_pipeline_node_record` | QO1、QO3、QI1–QI3、PM1–PM5 |
| P0 | Step1 的 `industryCategory`、`audienceType`、`coreIntent`、`pageTitle`、`screenObjective`、`themes[]` 的 `businessModule` / `intent` / `constraints[]`、`interactionRequests[]` | `ai_pipeline_node_record` 的 Step1 `output.raw` | QO2、PM1、PM4、QI2 |
| P1 | `ChatExecution.show_message` 与 `progressSnapshot.{goalSummary, planSummary, resultSummary}`（系统自述，标注"非独立事实"） | `ai_pipeline_node_record` | QI2、PM5 |
| P1 | Step0 润色后的需求 `simpleDescription` / `fullDescription` | `ai_pipeline_node_record`（`Step0`） | QO2、QI2 |
| P1 | `description`（评分标签 + 自由文本，拆出标签） | `dt_ai_operation_log` | PM6 |
| P1 | 原型页面标题、区域模块名与说明、指标名称与说明、主视觉 `contents` | 原型 JSON | §14.15 的主题与模块语义 |
| 不采 | `metadata`（评分时整屏载荷） | `dt_ai_operation_log` | 见 D4 |
| 依赖上游 | 每轮前后原型差异 | 未发现 | QO8、QI4 |

只采指定路径的字段，**不整体复制** `output` JSON：Step1 的 `output.raw` 含 `candidateThemes`、CSV 语义等大块内容，与本问题集无关。

### 6.2 实施路径（沿用既有链路）

1. Flyway：从 **V27** 起新增列（当前最大为 V26）；沿用 V21、V23、V24、V26 "保留某类事实"的增列方式，源数据集 schema 版本同步升级。
2. 采集转换：扩展 `EasyVCanonicalTransform` 的 FEEDBACK 与 pipeline-node 映射，从节点 `output` 的指定路径抽取字段；`session_id` 作为关联键。
3. **删除策略（D3）：** 沿用 `snapshot_diff` 和应用 `soft_delete`；2026-10-10 用户确认先保留现有生命周期，不增加删除后留存。单改 `DeletePolicy.NONE` 不会自动复制 FULL/RECONCILE 中的历史节点。
4. 本体：`EasyVOntologyModel` 补属性；**补 `actionType` 取值与口径说明**（目前只写"评分、另存、组合执行"，Agent 因此看不出 `chatRefactor` 是对话轮次）；Cube 模型由本体重新生成，漂移门禁照旧。
5. 读取：原文只经单对象详情与受限的 Agent 工具读取，沿用"冻结版本 + 当前权限求交"；列表与聚合只出现分类和计数。
6. 采集与发布：FULL 或 RECONCILE → 冻结集 → 发布 → 重新导出本地快照。本地快照无法恢复未采的文本，只能重采。

### 6.3 文本护栏

- 原文入库前设长度上限，**截断必须留标记**。现有 `failureReasonText` 在 4000 字符处静默截断（`EasyVCanonicalTransform`），没有"是否被截断"的标记，评估原话时会把截断当完整文本；新增字段不沿用这一点，同时建议补上该字段的截断标记。具体上限待定。
- **用户原话只有一个来源**：`operation_log.user_input`。不再从节点记录复制 `UserPrompt` 文本，避免两份副本生命周期不一致。
- 原文不进日志、不作 Cube 维度、不作指标标签；稳定 hash 用于分组与去重。枚举（`intent`、`status`、标签）可进 Cube。
- 原文列与枚举列分列存放，使将来"只清原文、保留信号"成为可能。
- 按 D1，原话可进入分析所用模型的上下文，沿用现有模型调用链，不新增提供方。

### 6.4 无需采集即可先做的事

- 补全本体对 `actionType`、`execute_result`、`is_save_as_edit` 的口径说明（3.1 前三条）。
- 用现有数据先给三类角色看 A / A+B 类问题的结果，验证"问得对不对"，再投入采集。

## 7. 决策记录

| 编号 | 决策 | 结论 | 依据与后果 |
|---|---|---|---|
| D1 | 用户原话是否允许进入分析所用模型 | **允许**（业务方答复：内部用于用户分析与产品改进） | 沿用现有调用链 |
| D2 | 是否新增质量评审角色 | **不新增，用管理员**（业务方答复） | 验收账号用 `PLATFORM_ADMIN`；不引入新的权限模型 |
| D3 | 源端应用删除后，原文与对话记录如何处置 | **2026-10-10 用户答复：尚未确认，先保留现有生命周期** | 本期不增加删除后留存策略；见下 |
| D4 | `metadata` 是否纳入 | **暂不采集** | 见下 |
| D5 | 逐轮前后差异是否向上游提需求 | **提交上游讨论，不阻塞本期**（业务方答复：可能涉及拉链表，落地不会快） | QO8、QI4 移出本期验收；见"上游讨论项" |

### D3 决策：先保留现有生命周期，删除后信号留存待 U1

"原文"指用户在 AI 大屏里输入的文字：生成时的需求描述、生成后每条对话修改指令、评分时选的标签与文字。没有它只能数次数，无法说明"用户要什么、我们给了什么"。

源端删除是**分层**的：应用是逻辑删除（`is_delete='1'`，原型保留），但删除时同一事务内**物理清除**该应用的全部对话与流水线节点记录；`dt_ai_operation_log` 不在清除范围，因此 `user_input` 删除后仍然存在。

决策：
1. **用户原话只取 `operation_log.user_input`。** 源端删除后它本来就保留，我们与其保持一致，不额外保存更长寿命的副本。
2. **本期不实现删除后信号留存。** 节点沿用 `snapshot_diff`；FULL/RECONCILE 的新版本不会自动复制历史记录，单改 `DeletePolicy.NONE` 也不能做到追加留存。旧冻结事实不回填、不改写，其历史生命周期沿用已有机制。
3. **默认问数只统计未删除应用**（沿用现有 active 语义）；本期不开放“含已删除”的放弃分析。
4. **U1 待上游确认：** 源端清除的承诺、用途和本项目留存边界明确后，再单独设计和验收，不用本期 P0 暗中改变语义。

### D4 判断：`metadata` 暂不采集

前端评分时传入的 `metadata` 是**评分那一刻整张大屏的载荷**（`xml`、`prototypeScreenData`、`pageComponentsMap` 等），不是评分的附加说明。价值在于它记录了用户评分时实际看到的最终屏，对 B1.4 缺失的"真实完整渲染"有潜在用处。暂不采集的理由：只有被评分的记录才有（本地约 10/1128），体积大（未实测），其中结构信息已由原型事实覆盖。评分样本增长、或 B1.4 确需最终屏时再议。评分时的标签与文字在 `description`，已列入 P1。

### 上游讨论项（提交 easyv-ai-java 维护方）

| 编号 | 问题 | 说明 |
|---|---|---|
| U1 | 删除应用时物理清除对话记录，是隐私承诺还是存储清理？ | 决定本项目 D3 的留存边界 |
| U2 | 每轮修改前后的原型差异如何留存 | 完整方案可能涉及拉链表（原型历史版本）。轻量替代供讨论：每轮在 `ChatExecution.output` 记录变更摘要（目标 block、变更前后指标/图表类型 ID）。这是建议，不是已验证方案 |
| U3 | `intent` 标签失真（`AddMetricPlanner` 等写死 `BLOCK_REPLACE_BY_DIALOG`）的修复状态 | 影响所有按意图的分类 |
| U4 | `execute_result` 同时混合业务结果与积分结算结果 | 影响失败率口径 |
| U5 | 使用日报的"已删除应用删前使用情况"疑似恒为 0 | 按代码推断：该查询依赖会话与节点记录，而删除时这两者已被物理清除；**未经数据验证**，仅供上游核对 |

## 8. 分阶段与门禁

| 阶段 | 内容 | 门禁 | 状态 |
|---|---|---|---|
| 0 | 产品负责人确认 §2 价值假设与指标口径、§4 问题集 | 确认或修订记录 | 用户确认方向并授权开展；目标值和真人价值判定仍未设 |
| 1 | 本体补口径；用现有数据交付 §4.4 的无需采集部分，并让角色判定 | 角色判定记录 | 既有版式复用分析正常链路试运行完成；不代替 QI5 降级事件验收，角色判定待获得 |
| 2 | 源端字段**代码层**核实 | — | **已完成**（§3，源码事实） |
| 2b | 源端字段**数据层**覆盖核实（§10.4 的只读聚合） | 用户已明确授权；只读聚合，不导出原文 | 已完成，见 P0 实施记录 |
| 3 | 本地实现 P0 采集与读取；Testcontainers 验证迁移、转换、权限、截断、旧冻结版本 | Java 与契约测试通过；生命周期按 D3 不变 | 已完成：Java 719（新增测试桩修正后相关测试复跑）、Web 169 通过；迁移与构建通过 |
| 4 | 公司环境采集、发布、导出本地快照 | 用户已明确授权；对账与回滚入口 | 已发布并完成 FULL 冻结与本地快照核对；显示语义修正已部署，两条自然业务问题复验完成，解释质量与真人角色校准仍待完成，见 P0 实施记录 |
| 5 | 真实角色验收与校准 | 按 §5 判定，结果如实记录 | 真实数据技术试运行已有证据；真人角色判定待获得 |
| 上游 | U1–U5 讨论 | 不阻塞 0–5 | 待提交 |

## 9. 本草案的局限

- §2 的价值假设与 §4 的问题由实现方起草，**未经真实使用者验证**，不能视为需求；指标目标值一律未设。
- §3.2 的数字来自本地快照，不代表公司环境。
- 源码结论基于本机分支与前端仓库，未核对公司部署版本；"字段在源端落库"不等于"公司数据里有值"，覆盖率须由阶段 2b 核实。
- `output.blockId` 的填写范围依据源码注释（"仅 BLOCK_REPLACE_*"），新增意图是否也填写未核实。
- 本地快照无 `FALLBACK` 事件，不能证明降级标记在公司环境同样稀少或可用。
- 本地快照里只有 1 个已删除应用：其 6 个 `task_id` 在操作日志里都在、在节点记录里一个都没有；对比未删除应用 904 个 `task_id` 中 736 个有节点记录。方向与源码一致，样本过小，不能当作统计结论。

## 10. 交接说明（给后续智能体）

### 10.1 当前状态（2026-10-10 更新）

- 已完成：草案、源码核实、本地旧快照试运行、授权的公司源只读覆盖核实、P0 代码与 V27、本地迁移、全量回归和构建。发布及验收证据见 [P0 实施记录](./easyv-quality-p0-implementation.md)。
- Git：阶段性提交包含本文及已验证的质量证据、读取和显示实现，提交号以 Git 记录为准；原有架构图删除与对应架构介绍修改单独保留，不带入本期产品能力提交。
- 待产品负责人：确认 §2 与 §4；设定指标目标值；转交上游讨论项（§7 U1–U5）。
- 阶段 2b/4 已获用户全额授权并指示开展，无需再次询问相同授权。U1 明确答复为先保留现有生命周期。

### 10.2 硬约束（来自仓库 AGENTS.md）

- 不读取、不回显 `.env*` 中的密码与密钥；不设 `DIP3_ALLOW_REMOTE_DATABASE=true`；不用 `.env.company` 启动本地后端；未经明确要求，不对公司库做写入、迁移、恢复、采集或清理。
- schema 变更必须配套 Flyway 迁移（`backend-java/src/main/resources/db/migration/`，本期 V27 已实施）。实施前先读 V21、V23、V24、V26 的做法与对应转换代码。
- 验证结论写明环境；没有验证证据不宣称完成。
- 根因优先、fail loud：不静默截断、不吞错、不返回默认值。
- 源仓库（`/Users/dsy/Documents/easy-v/easyv-ai-java`、`easyvadmin-monorepo`）只读：不修改、不暂存、不提交。其代码版本不等于公司部署版本。

### 10.3 本地只读查询与已踩的坑

本地库在容器里，经容器内 unix socket 免口令查询，**只用于本地库**：

```bash
docker exec ontology-agent-local-postgres psql -U ontology_agent -d ontology_agent_local -At -F '|' -c "<SQL>"
```

冻结集 `88909298-8028-4941-8866-5004ed0609a5`（`ingestion.dataset_version_set_items` 取得）的产品版本：

| 产品 | `product_version_id` |
|---|---|
| easyv-ai-application | `ed4e3a30-accb-3032-ad1d-4304451a9556` |
| easyv-generation-feedback | `5c1aa280-5ddd-311a-a76e-460dc7a08f0d` |
| easyv-pipeline-node | `d85fda6d-4abf-39ed-bb1f-ed4c2b45504d` |
| easyv-forge-task | `1b025a71-0935-3731-b6c0-046b98f07678` |
| easyv-prototype-layout | `6ab8a9b8-7c8d-3e9c-81ee-52bf5a8d8daf` |
| easyv-prototype-block | `9643538e-0d3e-32a0-b16c-cd227729fac7` |
| easyv-prototype-component | `030ffe9e-2c9f-3002-a58b-aca4f0a2d94b` |
| easyv-prototype-task | `773e2bc9-e822-3eed-8b09-0848eac32563` |
| easyv-scheme-library | `7cda09bf-4eb8-3af1-9479-b75516b2590f` |

坑：本地有 3 个内容相同的冻结集（`easyv_pipeline_node` 各 4774 行）。**聚合必须带 `product_version_id` 过滤**，否则计数会乘以 3。

### 10.4 阶段 2b：源库只读聚合（已授权执行，结果见 P0 实施记录）

前提：产品负责人明确授权，并指定连接方式。在只读事务里执行；**不输出任何原文列**；先用 `information_schema.columns` 核对列名与类型（`output` 是否为 jsonb、`metadata` 是否为文本）。表在 schema `easyv_saas`。

```sql
-- S1 Step1 业务语义覆盖率（MAIN 分支）
SELECT count(*) AS step1_rows,
  count(*) FILTER (WHERE nullif(output::jsonb #>> '{output,raw,businessContext,industryCategory}','') IS NOT NULL) AS industry,
  count(*) FILTER (WHERE nullif(output::jsonb #>> '{output,raw,businessContext,audienceType}','') IS NOT NULL) AS audience,
  count(*) FILTER (WHERE nullif(output::jsonb #>> '{output,raw,coreIntent}','') IS NOT NULL) AS core_intent,
  count(*) FILTER (WHERE jsonb_array_length(coalesce(output::jsonb #> '{output,raw,themes}','[]'::jsonb)) > 0) AS themes,
  count(*) FILTER (WHERE jsonb_array_length(coalesce(output::jsonb #> '{output,raw,interactionRequests}','[]'::jsonb)) > 0) AS interaction_requests
FROM easyv_saas.ai_pipeline_node_record
WHERE branch = 'MAIN' AND step_name = 'Step1';

-- S2 ChatExecution 的目标区域与进度快照覆盖率（按意图）
SELECT intent, count(*) AS rows,
  count(*) FILTER (WHERE output::jsonb ->> 'blockId' IS NOT NULL) AS has_block,
  count(*) FILTER (WHERE output::jsonb -> 'progressSnapshot' IS NOT NULL) AS has_snapshot
FROM easyv_saas.ai_pipeline_node_record
WHERE branch = 'CHAT' AND step_name = 'ChatExecution'
GROUP BY intent ORDER BY rows DESC;

-- S3 用户原话非空率与长度分布（只输出长度，不输出文本）
SELECT ai_action_type, count(*) AS rows,
  count(*) FILTER (WHERE nullif(user_input,'') IS NOT NULL) AS has_input,
  percentile_disc(0.5)  WITHIN GROUP (ORDER BY char_length(user_input)) AS p50_len,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY char_length(user_input)) AS p95_len,
  max(char_length(user_input)) AS max_len,
  count(*) FILTER (WHERE char_length(user_input) > 4000) AS over_4000
FROM easyv_saas.dt_ai_operation_log GROUP BY 1 ORDER BY rows DESC;

-- S4 节点状态分布（确认 FALLBACK 是否出现）
SELECT branch, step_name, status, count(*) FROM easyv_saas.ai_pipeline_node_record GROUP BY 1,2,3 ORDER BY 1,2,3;

-- S5 评分、标签、评分载荷覆盖
SELECT ai_action_type, count(*) AS rows,
  count(*) FILTER (WHERE rating IS NOT NULL) AS rated,
  count(*) FILTER (WHERE nullif(description,'') IS NOT NULL) AS has_description,
  count(*) FILTER (WHERE description LIKE '反馈标签：%') AS has_tags,
  count(*) FILTER (WHERE metadata IS NOT NULL) AS has_metadata
FROM easyv_saas.dt_ai_operation_log GROUP BY 1;

-- S6 删除语义：已删除应用是否仍有操作日志、会话、节点记录
SELECT count(*) AS deleted_apps,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM easyv_saas.dt_ai_operation_log o WHERE o.app_id = a.app_id)) AS with_oplog,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM easyv_saas.ai_screen_session s WHERE s.app_id = a.app_id)) AS with_session,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM easyv_saas.ai_screen_session s
                                 JOIN easyv_saas.ai_pipeline_node_record r ON r.session_id = s.session_id
                                 WHERE s.app_id = a.app_id)) AS with_nodes
FROM easyv_saas.ai_screen_app a WHERE a.is_delete = '1';

-- S7 记录开关是否一直开着：节点记录的时间跨度
SELECT date_trunc('week', create_time) AS wk, count(*) FROM easyv_saas.ai_pipeline_node_record GROUP BY 1 ORDER BY 1;
```

通过标准：S1 各字段非空率、S2 的 `has_block` 与 `has_snapshot`、S3 的 `has_input` 与 `over_4000`、S4 是否有 `FALLBACK`、S6 的 `with_oplog` 与 `with_nodes` 差异。结果按"事实 / 推断"分开记入本文 §3 与 §9。

### 10.5 阶段 3：本地实现清单

先读：V21、V23、V24、V26；`EasyVCanonicalTransform`；`EasyVOntologyModel` 的操作反馈与流水线节点对象；`DatasetDefinition.DeletePolicy`；`backend-java/src/test` 中对应的转换与迁移测试。

1. **迁移 V27**：新增 P0 字段（§6.1）。复用现有 `easyv-pipeline-node` 产品，以 `easyv-quality-node` 本体对象投影 Step1 / ChatExecution；避免为同一来源、版本和权限边界复制产品。操作日志作为显式第二输入，以 `task_id` 精确关联应用。
2. **转换**：从节点 `output` 的指定路径抽取字段，不整体复制 JSON；`user_input` 超限时写截断标记。
3. **删除策略**：维持现有生命周期（2026-10-10 用户答复，D3），本期不增加删除后留存。
4. **本体**：补 `actionType` 取值、`execute_result` 与 `is_save_as_edit` 口径说明；Cube 模型由本体重新生成，通过漂移门禁。
5. **读取**：原文只经单对象详情与受限的 Agent 工具；列表与聚合只出现枚举与计数。
6. **测试**：Testcontainers 覆盖迁移、转换、权限、截断标记、多执行节点、旧冻结版本；契约测试覆盖对象读取与 Web 透传；`pnpm lint`、tsc、`pnpm build`、`mvn -f backend-java/pom.xml test`。不将未经实现的删除后留存列为已验证项。
7. 公司库迁移、采集和发布单独按阶段 4 执行；本轮已获明确授权，仍先备份并记录部署与对账证据。

### 10.6 未验证事项清单

- Step1 / ChatExecution / 原话覆盖率已核实（P0 实施记录）；`progressSnapshot` 仅核实有值，不在 P0 采集。
- `ACK` / `CLARIFY` / `OUT_OF_SCOPE` 实际存在；按意图的去重任务数不可相加为轮次总量，源端标签准确性仍需抽样。
- 源端 `docs/TODO.md` 所列缺陷的当前修复状态。
- `DeletePolicy.NONE` 不能让 FULL/RECONCILE 自动追加保留历史；删除后留存未实施，待 U1 明确。
- 上游物理清除的动机（U1）；使用日报"删前使用情况"是否恒为 0（U5）。
- 源端的 `ai_token_usage` 与积分结算数据是否值得引入（QO7），尚无设计。


## 12. 展示方向修正与远期规划（2026-10-10）

### 本期

用户提问遵循 §4 的业务语言，例如“生成后用户最常让 AI 改什么？”“哪些用户需求没处理好？给我看看具体例子。”不要求用户知道内部环节、意图码、去重规则或工具步骤；这些由系统理解、执行并披露口径。

显示语义归属性所属的本体声明：属性名称、记录标题、重要信息、技术标识和枚举值名称。通用前端消费这些声明，列表、详情、筛选、统计图表与模型回答沿用同一份含义。原始值仍用于查询、关联与下钻；技术标识留在折叠的出处区。没有真实对象名称时显示类型与实际时间，不编造业务名称。当前 EasyV 本体仍由 Java 代码声明；这不是新增领域完全无需代码的配置平台。

不把“当次被判为不支持”直接解释成产品能力边界，也不把执行成功解释成诉求已满足。原话不在列表中时须进一步读取有权限的单对象详情，不能推断原话未保留。

### 远期（本期不实施）

本体的在线管理、版本化配置与发布可作为独立产品规划：让领域维护者管理对象名称、标题属性、重要属性、值名称和关系展示；发布时校验引用、权限与版本，明确其与现有冻结执行的关系。配置的权威来源和生命周期须先设计，避免同时维护前端字典、数据库配置和 Java 声明三套含义。具体存储、管理界面与迁移方案待用户后续规划确认，不为此预建平台。

## 13. 当前 B 内的业务验收与下一批（2026-10-10）

本节保留已有 easyv-dev 执行，并按用户最新决定，在本地公司数据快照验证常规业务问题，发布后只检查健康，不重复同题验证。单个大屏回看使用本地管理员选定实际应用；历史运行来自单用户范围账号。数值、原话和显示验证不能代替 §5 的真人角色判定。

| 用户会问的问题 | 当前证据与缺口 | 下一步与通过条件 |
|---|---|---|
| 生成后用户最常让 AI 改什么？ | 已有自然问题运行和独立 SQL 对账；2026-10-11 单应用自然题的正文已复用独立分类统计，12 类/75 条对话处理记录，新增指标 12 条记录/8 次请求，未以 50 条截取明细替代。3 条原话均来自新增指标类，跨分类代表性和系统分类准确性尚未认证 | 抽样对照不同分类的原话，区分分类事实与推断；明确处理记录与请求单位，不能据此直接判断默认生成存在系统性偏差 |
| 哪些用户需求没处理好？给我看看具体例子。 | 曾出现仅由时间接近推断同一模块的无依据解释，失败保留。2026-10-11 本地原问题已分别展示 3 条对话处理失败与 14 条当次不支持记录；4 个样例把同记录时间、日志结果、原话与有值的失败原因成组呈现，42 个引用及本地 SQL 对账通过。一条当次不支持请求的日志仍记为成功，不认证需求满足 | 同记录呈现通过；样例正文仍需清楚标明真实关联的节点分类，分类准确性及实际效果继续核实。不得由时间接近推断同一诉求，不把失败与不支持混加成未满足总量 |
| 这个大屏最初要做什么，后来怎么改，最后有没有被另存？ | 已从真实失败记录选中对应应用并完成自然问题运行；79 条全环节处理记录、22 条澄清、14 条当次不支持、3 条失败，以及 6 条生成反馈/1 条另存经同冻结只读 SQL 核对。本地复验回答已区分修改诉求与实际屏幕变化、曾另存与最终版本；追问标签改用本体标题或时间，不再拼接主键。修改原话仍未逐条读，最终版本状态缺来源 | 此前自由回看泛化逐项原话要求，失败保留；2026-10-11 已改为原文摘录/实际记录统计/另存记录表，本地自然题的可核对呈现通过，详见实施记录。上一批明确 50 条已读记录口径；随后复用已有独立指标，排名/截取范围仍须披露。保留曾另存与最终版本的区别，完整偏差解释、逐轮实际变化与最终采纳仍待真实来源，不以当前原型补造历史 |
| 哪些需求当时没处理？用户原话是什么？ | 已有当次不支持分类及部分样例读取；分类可能失真，不能当作经过认证的产品能力边界 | 同范围核对全量计数与原话样例；区分系统当次分类、原话事实、待核实能力原因，支持按真实样例回看 |
| 系统理解的需求和用户原话有没有偏差？ | 已补采理解与操作原话；源端当前代码证实操作日志可在生成结束结算时落库，“晚于理解所以不能关联”的推断已纠正。同任务可以对照两份记录；完整模型输入仍缺。仅提示词修正未阻止逐项约束泛化；额外模型核对出现误报与漏报，已撤回且未部署。原话真实换行与逐字引文检查均不能阻止自由摘要泛化；现为文本对照增加仅接受连续原文摘录的模型私有协议，由程序生成本体标签与来源引用，不接受自由摘要。摘录对应关系和完整输入覆盖仍须核对 | 按已读原文逐项比较，不以指标数直接减模块数，不把前项要求套到后项；未取得完整模型输入不能认证自行扩展或漏解。当前验证结果见实施记录，QI7 全部质量判定与真人角色校准仍保留门禁，不重复公司同题 |

顺序：先完成单个大屏回看与解释证据核对，再校准需求分类及未处理样例；全局范围和三类真人角色的价值判定单独保留门禁。确需系统回复或进度摘要时，再按 §6.1 的下一批字段推进，不因存在 P1 清单就自动扩采。原话中的组件引用语法、理解 JSON 与重复支撑图表的展示缺口继续按真实案例记录，方案遵循 §12 的本体与通用呈现边界。
