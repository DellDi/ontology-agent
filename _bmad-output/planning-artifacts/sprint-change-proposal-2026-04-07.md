---
date: '2026-04-07'
project: 'ontology-agent'
workflow: 'correct-course'
mode: 'batch'
status: 'approved'
change_scope: 'moderate'
approved_date: '2026-04-07'
---

# Sprint Change Proposal

## 1. 问题摘要

### 触发背景

本次变更触发点出现在 `Story 5.1` 已经补齐“提交执行入口”之后。产品开始从“能否提交分析任务”转向“用户是否真正感受到 AI 原生分析工作台”的验收视角。

用户已经明确了新的产品判断：

- 目标不只是“问一句，回一段文本”
- 目标也不只是“有分析、有编排、有回溯”
- 目标是形成一套适配 `PC / mobile` 的 AI 原生交互体验：
  - 节点执行过程可视化
  - 实时编排渲染过程
  - 可视化流式交互面板
  - 图、表、思维导图、证据卡等富渲染控件
  - 自定义 Markdown / block render 体系

### 问题类型

**不是架构选型错误，而是在 Sprint 执行阶段，隐含的“交互层平台需求”被正式识别出来，需要补充为显式规划。**

这同时具有两种性质：

- 已有目标的细化：现有 PRD / Architecture 已经强调“流式反馈、可解释、PC 主战场、移动端轻量承接”
- 新增的设计清晰度：当前 artifacts 还没有把“统一渲染协议 / 富渲染部件层 / 多端同源 schema”拆成明确的架构与 story 边界

### 核心问题陈述

当前项目的总体方向并不需要推翻，`Vercel AI SDK` 也并非与现有架构冲突；相反，现有架构已经预留了它在 `Epic 5` 作为 **交互层增强** 的引入窗口。

真正的缺口在于：

- 当前 `Epic 5` 的故事仍偏“提交执行 -> SSE 状态 -> 结果展示”的基础闭环
- 还没有显式定义：
  - 稳定的执行事件 envelope
  - 面向 UI 的 render block / message part 协议
  - 工具执行过程如何映射到可视化面板
  - 同一份结果如何在 `PC` 与 `mobile` 做不同投影
- 因此，如果直接进入 `5.2 / 5.3` 开发，团队很容易做出“能流式，但只有文本/状态”的实现，后续再补富渲染时返工会明显增大

### 支撑证据

- [project-context.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/project-context.md) 已明确：
  - `Epic 5` 开始若需要更强流式 UI / token streaming / tool call 结果渲染，可以考虑引入 `Vercel AI SDK`
  - 但仅作为 **Next.js 交互层增强**，不接管服务端业务编排
- [architecture.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md) 已明确：
  - 主应用契约采用 `REST + SSE`
  - 长耗时分析采用“提交 -> 入队 -> 流式返回状态和结果”
  - 若前端需要显著增强流式交互，优先补 `Vercel AI SDK`，但不取代内部编排
- [5-2-stream-execution-progress-and-stage-results.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/5-2-stream-execution-progress-and-stage-results.md) 当前只覆盖“状态流 + 阶段结果”，尚未把 render schema / rich block protocol 作为显式交付物
- [5-3-ranked-causal-conclusions-with-evidence.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/5-3-ranked-causal-conclusions-with-evidence.md) 当前只要求“排序原因 + 证据摘要”，尚未要求统一富渲染结果模型
- [8-1-mobile-latest-analysis-summary.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/8-1-mobile-latest-analysis-summary.md) 当前更像单独 read model，没有明确复用 PC 结果 render schema

## 2. Checklist 结果

### Section 1: Trigger and Context

- `1.1` [x] Done：触发点位于 `Story 5.1` 与 `Story 5.2` 的交界，用户开始从端到端交互体验审视产品目标
- `1.2` [x] Done：问题性质为“隐含交互平台需求未显式 story 化”，不是现有路线彻底失败
- `1.3` [x] Done：已有 `project-context`、`architecture`、`5.2`、`5.3`、`8.1` 文档提供证据

### Section 2: Epic Impact Assessment

- `2.1` [x] Done：当前 `Epic 5` 仍可完成，但必须补充“交互协议与富渲染边界”
- `2.2` [x] Done：**不建议新增独立 Epic**；优先在现有 `Epic 5 / 8` 内补细化 story 和 acceptance criteria
- `2.3` [x] Done：`Epic 5`、`Epic 6`、`Epic 8` 都会受影响，其中 `Epic 5` 受影响最大
- `2.4` [x] Done：现有未来 epics 没有失效，但 `5.x / 8.x` 的细节不足，需要修订
- `2.5` [x] Done：优先级建议小幅调整，把“交互层协议”提升到 `5.2` 起始阶段，而不是作为后补优化

### Section 3: Artifact Conflict and Impact Analysis

- `3.1` [x] Done：PRD 核心目标不变，但建议新增“统一渲染块 / 多端投影”类需求，避免产品承诺停留在文本结论层
- `3.2` [x] Done：Architecture 需要新增“AI Interaction Rendering Layer”定义，明确 `Vercel AI SDK` 边界
- `3.3` [x] Done：UX 需要补充“流式分析画布 / 执行节点轨 / 富渲染块”模式，不再只停留在计划区、证据栏的静态概念
- `3.4` [x] Done：实施 artifacts 需要调整 `5.2 / 5.3 / 5.4 / 8.1` 的任务颗粒度与契约

### Section 4: Path Forward Evaluation

- `4.1` [x] Viable：直接在现有 Epic 结构内修正故事与架构边界，可行
- `4.2` [ ] Not viable：不建议回滚 `5.1` 或前面已完成的 `3.x / 4.x` 实现
- `4.3` [ ] Not viable：不需要缩减 MVP，只需要把“交互层能力”从隐含变为显式
- `4.4` [x] Done：推荐 **Hybrid = Direct Adjustment + Architecture Addendum + Story Refinement**

### Section 5: Proposal Components

- `5.1` [x] Done
- `5.2` [x] Done
- `5.3` [x] Done
- `5.4` [x] Done
- `5.5` [x] Done

### Section 6: Final Review and Handoff

- `6.1` [x] Done
- `6.2` [x] Done
- `6.3` [x] Done：用户已于 `2026-04-07` 明确批准
- `6.4` [x] Done：开始回写受影响规划工件与 story 文档
- `6.5` [x] Done：已形成 handoff 方案

## 3. 影响分析

### Epic 5 的影响

- **状态判断：** 目标成立，但 story 粒度偏粗
- **当前风险：**
  - 容易先做出“只有状态流和文本结果”的执行页
  - 后续再补节点可视化、图表块、证据卡、移动端投影时会打散结果模型
- **需要修正：**
  - 在 `5.2` 把“稳定事件协议 + UI render parts”纳入显式范围
  - 在 `5.3` 把“富渲染结果块”纳入结论模型
  - 在 `5.4` 明确持久化的是“步骤结果 + render blocks + 最终结论”，而不只是文本摘要

### Epic 6 的影响

- **状态判断：** 不需要重写，但后续要消费同一套 interaction schema
- **影响点：**
  - 多轮追问
  - 用户纠偏后重规划
  - 历史回放
- **需要补充的约束：**
  - 追问、回放和重规划不应重新发明第二套 UI 数据结构
  - 应复用 `Epic 5` 确立的 execution event / render block 协议

### Epic 8 的影响

- **状态判断：** 目标不变，但“移动端只读摘要”需要建立在与 PC 同源的结果模型之上
- **当前风险：**
  - 若单独为移动端拼接摘要 DTO，后续会与 PC 结果层脱节
- **需要修正：**
  - 移动端应消费同一套 render schema 的受限投影
  - 保持“能力缩减”，但不要“协议分叉”

### PRD 的影响

- **冲突程度：中**
- **当前问题：**
  - PRD 已经承诺“过程可解释、支持执行步骤、支持移动端轻量查看”
  - 但还没有把“富渲染结果协议”和“多端同源渲染模型”写成产品能力
- **需要修改：**
  - 新增或补充一条功能需求，明确系统输出不是只限纯文本，而是统一可渲染内容块

### Architecture 的影响

- **冲突程度：中**
- **当前问题：**
  - 已经有 `REST + SSE` 和 `Vercel AI SDK` 的原则
  - 但缺少“事件协议 -> UI parts -> block renderer -> device projection”的完整描述
- **需要修改：**
  - 增加 `AI Interaction Rendering Layer`
  - 明确 `Vercel AI SDK` 仅用于 Next.js 交互层
  - 保持 `Worker + Redis + Tool Registry + Orchestration Bridge` 为服务端编排主线

### UX 的影响

- **冲突程度：中**
- **当前问题：**
  - UX 已定义“三段式工作台”和“证据/结论/追问”结构
  - 但尚未定义执行过程的图形化表达、rich block grammar、跨端投影规则
- **需要修改：**
  - 增加“流式分析画布”定义：
    - 执行轨
    - 阶段结果块
    - 证据块
    - 结论块
    - 追问入口

## 4. 推荐路径

### 选定方案

**Hybrid：保持现有编排架构不变，引入 `Vercel AI SDK` 作为交互层增强，并对 `Epic 5 / 8` 做 story 级细化。**

### 不建议现在重构系统底座的原因

- 当前自有编排边界已经清晰：
  - `LLM Provider Adapter`
  - `Prompt Registry / Structured Output Guardrails`
  - `Tool Registry + Orchestration Bridge`
  - `Worker + Redis`
- 这些边界正好适合承接“真实执行”和“后台任务”
- 若现在让 `Vercel AI SDK` 反向接管服务端业务编排，会造成职责混乱

### 建议现在引入 `Vercel AI SDK` 的原因

- 你要做的不是普通结果页，而是 AI 原生交互工作台
- 进入 `Epic 5` 后，流式交互、分段渲染、工具/步骤可视化已经进入主路径
- 继续只靠自定义 SSE + 页面手工状态拼接，长期会让：
  - 事件协议分散
  - 富渲染块难统一
  - PC / mobile 复用困难

### 引入边界

`Vercel AI SDK` 的引入应严格限制在：

- Next.js 交互层的流式消息/数据块承接
- UI message / part / block 的生命周期管理
- 自定义渲染器桥接
- 流式更新在 PC / mobile 的统一消费方式

它**不应**接管：

- 执行计划生成
- 工具选择逻辑
- 后台任务编排
- 权限与 scope 判定
- Redis / Worker 状态协调

### 风险评估

- **实施工作量：中**
- **时间影响：中**
- **返工规避收益：高**
- **长期产品收益：高**

## 5. 详细变更提案

### 5.1 PRD 变更提案

#### 建议新增功能需求

**NEW: FR-17 统一渲染块输出**

系统应将分析执行过程、阶段结果、关键证据和最终结论组织为统一的可渲染内容块，以支持表格、图表、证据卡、执行节点、摘要卡等多种界面呈现方式，而不是仅返回纯文本结果。  
**适用平台：** PC 后台、移动端摘要投影

#### 建议补充全栈产品要求

**OLD**

- PC 前端应支持对话输入、计划展示、步骤反馈、结果呈现、追问和重规划
- 移动端能力应单独定义，不得默认继承 PC 完整分析工作流

**NEW**

- PC 前端应支持问题输入、计划展示、步骤反馈、阶段结果、富渲染结论、追问和重规划
- PC 与移动端应共享同源的分析结果 render schema，由不同端按能力边界进行投影，而不是维护两套独立结果协议
- 移动端能力应单独定义，但其摘要与追问入口应消费服务端受控的 render schema 投影

#### Rationale

这样可以把你的产品目标从“会展示结果”升级为“拥有统一的 AI 交互渲染能力”，并且不把它误降级为纯前端实现细节。

### 5.2 Architecture 变更提案

#### OLD

- 主应用契约采用基于 Next Route Handlers 的 `REST + SSE`
- 若近期需要显著增强前端流式交互与工具调用体验，优先补充 `Vercel AI SDK`，但只作为交互层能力，不取代平台内部编排

#### NEW

在现有通信模型后新增一层：

**AI Interaction Rendering Layer**

职责包括：

- 定义统一 `execution event envelope`
- 定义统一 `render block / message part` schema
- 将 worker 阶段结果、工具结果和最终结论映射为可消费的 UI parts
- 提供 renderer registry，支持：
  - 文本说明
  - 表格
  - 图表
  - 证据卡
  - 结论卡
  - 执行节点/时间线
  - 后续可扩展的思维导图或图形块
- 为 `PC` 与 `mobile` 提供同源 schema 的不同投影

边界要求：

- 该层可采用 `Vercel AI SDK` 作为 Next.js 交互增强实现
- 但内部 canonical source of truth 仍然是服务端 execution events 与结果模型
- `Worker + Redis + Tool Registry + Orchestration Bridge` 继续作为平台内部执行主线

#### Rationale

这一步能把“传输协议”和“渲染协议”区分开，避免未来把 SSE event 直接当成 UI state 结构长期固化。

### 5.3 UX 变更提案

#### OLD

- 三段式工作台：左导航 + 中央分析主区 + 右证据侧栏
- 关键组件包括：分析输入台、计划时间线面板、证据堆栈卡、原因排序面板、移动端摘要卡

#### NEW

在原有三段式工作台之上，补充“流式分析画布”定义：

- 中央主区不只显示静态计划和结论，还应承载：
  - 执行轨
  - 阶段结果块
  - 工具/步骤状态块
  - 富渲染证据块
  - 最终结论块
- 右侧栏从“静态证据侧栏”升级为：
  - 证据详情
  - 结果说明
  - 数据源/范围说明
  - 节点检查器
- 移动端只展示压缩后的摘要投影，不进入复杂编辑与重排界面

#### Rationale

这能让 UX 真正承载“AI 分析过程”，而不是只在现有卡片布局上往回填数据。

### 5.4 Story 变更提案

#### Story 5.2

**OLD 标题：** 流式反馈执行进度与阶段结果

**NEW 标题建议：** 流式反馈执行进度、稳定事件协议与阶段结果

**OLD Acceptance Criteria**

1. 分析任务执行期间，任一步骤进入运行、完成或失败状态时，系统必须向会话界面推送最新执行状态。
2. 用户可见状态更新间隔不得超过 5 秒。
3. 当分析执行超过 10 秒时，系统必须持续展示步骤级进度或阶段性发现，不能长时间无反馈。

**NEW Acceptance Criteria**

1. 分析任务执行期间，任一步骤进入运行、完成或失败状态时，系统必须向会话界面推送最新执行状态。
2. 用户可见状态更新间隔不得超过 5 秒。
3. 当分析执行超过 10 秒时，系统必须持续展示步骤级进度或阶段性发现，不能长时间无反馈。
4. 服务端必须输出稳定的 execution event envelope，至少覆盖：execution status、step lifecycle、stage result、tool/event metadata。
5. 客户端必须基于统一 render part / block schema 渲染阶段结果，而不是直接把原始 SSE payload 当作最终 UI 结构。

**新增任务建议**

- [ ] 定义 execution event envelope
- [ ] 定义 render part / block schema
- [ ] 建立 Next.js 交互层 stream adapter
- [ ] 覆盖至少 3 种非纯文本阶段结果块的渲染验证

#### Story 5.3

**OLD 标题：** 输出带证据的归因结论

**NEW 标题建议：** 输出带证据与富渲染块的归因结论

**OLD Acceptance Criteria**

1. 当分析计划执行到可形成结论的阶段时，系统必须输出排序后的原因列表。
2. 每个原因都必须附带至少一条用户可理解的证据摘要。
3. 在同一会话上下文下重复执行结构化归因分析时，系统应尽量保持相同的计划骨架和同类结论排序；明显偏差必须可由证据变化解释。

**NEW Acceptance Criteria**

1. 当分析计划执行到可形成结论的阶段时，系统必须输出排序后的原因列表。
2. 每个原因都必须附带至少一条用户可理解的证据摘要。
3. 在同一会话上下文下重复执行结构化归因分析时，系统应尽量保持相同的计划骨架和同类结论排序；明显偏差必须可由证据变化解释。
4. 最终结论必须可被渲染为统一结果块，至少支持原因卡、证据块以及图表或表格中的一种结构化表达。

#### Story 5.4

**补充建议**

- 持久化对象不应只包含文本结论
- 应至少覆盖：
  - execution snapshot
  - stage results
  - final conclusion blocks
  - mobile projection 所需最小字段

#### Story 8.1

**OLD 标题：** 移动端查看最近分析摘要

**NEW 标题建议：** 移动端查看最近分析摘要与同源结果投影

**补充 Acceptance Criteria**

- 移动端摘要必须来自与 PC 同源的结果 render schema 投影，而不是单独手写一套不兼容 DTO
- 移动端不支持完整编辑，但可以稳定展示结论摘要块、关键证据块和状态块

### 5.5 Epic 是否需要重构

#### 结论

**当前不需要新增 Epic。**

#### 原因

- 现有 `Epic 5` 足以承载“执行 + 流式 + 富渲染结果”
- 现有 `Epic 8` 足以承载“移动端投影消费”
- 当前真正缺的是 story 粒度与架构显式化，不是 roadmap 结构完全错误

#### 唯一的新增 Epic 条件

只有当你决定把“图形化节点画布 / 编排工作流设计器”升级为产品一级主界面，而不是分析过程的可视化呈现时，才建议在 Growth 阶段新增独立 Epic。

## 6. 实施交接建议

### 变更级别

**Moderate：需要 Product / Architecture / Story 三类工件同步修正，但不需要推翻当前代码主线。**

### 建议交接顺序

1. **Architect / PM**
   - 形成一份交互层补充架构决策
   - 明确 `Vercel AI SDK` 的边界、render schema 与 device projection 原则
2. **PO / Scrum Master**
   - 修订 `5.2 / 5.3 / 5.4 / 8.1` 的 story 文案与 acceptance criteria
   - 评估是否需要把 `5.2` 拆成两条更细 story
3. **Development**
   - 在不改动内部编排主线的前提下，实现 stream adapter 与 render blocks
4. **QA / UX**
   - 增补“流式交互不空白、富渲染块稳定、移动端投影一致”的验收标准

### 建议的下一步动作

1. 先批准本次 Sprint Change Proposal
2. 执行一次补充架构设计，聚焦交互层协议
3. 回写 `Epic 5 / 8` 相关 story
4. 然后再进入 `5.2` 开发

### 成功标准

如果本次修正成功，后续开发应满足：

- `Vercel AI SDK` 被引入，但只在交互层
- 内部 execution / orchestration 主线不被替换
- `5.2` 开始就建立统一事件与 render schema
- `5.3 / 5.4 / 8.1` 基于同一结果模型持续演进
- PC 与 mobile 的差异表现为“投影不同”，而不是“协议不同”
