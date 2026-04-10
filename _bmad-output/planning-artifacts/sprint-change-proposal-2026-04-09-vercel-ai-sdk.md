---
date: '2026-04-09'
project: 'ontology-agent'
workflow: 'correct-course'
topic: 'vercel-ai-sdk-ai-application-runtime'
mode: 'batch'
status: 'approved'
change_scope: 'moderate'
approved_date: '2026-04-09'
---

# Sprint Change Proposal

## 1. 问题摘要

### 触发背景

本次变更触发点不是单一 bug，而是 `Epic 5` 与 `Epic 6` 完成后暴露出的 **AI 应用运行时层** 成熟度问题：

- `Epic 5` 已完成执行提交、流式反馈、归因结论、结果持久化
- `Epic 6` 已完成多轮追问、纠偏、重规划与历史保留
- 当前系统已经具备真实 `Worker + Redis + Postgres` 的执行与会话事实模型
- 但当前系统仍缺少一个正式的 AI application runtime 来统一承接：
  - 流式消息与 UI lifecycle
  - tool invocation / approval
  - message persistence / resume projection
  - memory / knowledge / skills / tool surface 的工程化接入

这意味着项目已经不再处于“是否需要流式 AI 交互”的阶段，而是进入了“是否继续手工维护 AI 应用运行时”的阶段。

### 问题类型

这是一次 **执行阶段后暴露出的交互层架构修正**，性质属于：

- 已有方向深化，而不是产品方向反转
- AI 应用运行时与多端渲染策略正式化，而不是单点 UI 微调
- 需要进入 backlog 的跨故事行动计划，而不是仅靠局部重构即可解决

### 核心问题陈述

当前项目已经实现了：

- 稳定的 `execution event envelope`
- `render block` 持久化
- follow-up / history / mobile projection 基础

但尚未正式引入一个成熟的 **AI 应用运行时层** 来统一处理：

- UI message / part 生命周期
- 流式消息接线
- tool invocation 结果与审批交互
- 多端一致的消息级渲染与恢复
- 记忆、知识资源、skills 与工具系统的标准化接入面

如果继续只靠现有自定义交互层推进，后续风险会持续上升：

- 流式事件协议与页面状态结构继续耦合
- 富渲染块扩展到图表 / 图谱 / 表格 / timeline 时成本更高
- PC 与 mobile 结果投影更难保持同源
- 会话、追问、历史和中间态的前端管理复杂度继续堆积在页面层
- 未来若接入长期记忆、知识库、技能系统和外部工具市场，工程入口会继续分散

### 支撑证据

- 当前仓库已存在明确的引入判断：
  - [sprint-change-proposal-2026-04-07.md]({project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-07.md#L181)
  - [architecture.md]({project-root}/_bmad-output/planning-artifacts/architecture.md#L334)
- 当前实现已经形成自定义交互协议：
  - [stream route]({project-root}/src/app/api/analysis/sessions/[sessionId]/stream/route.ts#L28)
  - [live shell]({project-root}/src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx#L22)
  - [stream-models.ts]({project-root}/src/domain/analysis-execution/stream-models.ts#L3)
- 当前仓库尚未引入 `@ai-sdk/*` 或 `ai` 依赖，说明该路线仍未正式落地
- 官方能力已经明确覆盖：
  - `useChat / UIMessage / persistence / resume streams`
  - `ToolLoopAgent`
  - `tool / dynamicTool / tool approval`
  - `MCP tools / resources / prompts / elicitation`
  - memory 接入的三种路径：provider-defined tools、memory providers、custom tool

## 2. Checklist 结果

### Section 1: Trigger and Context

- `1.1` [x] Done：触发问题来自 `Epic 5` 与 `Epic 6` 完成后暴露出的交互层复杂度，而非单一 story 缺失
- `1.2` [x] Done：问题类型属于“已完成能力需要正式交互运行时承接”，不是需求反转
- `1.3` [x] Done：现有 architecture / change proposal / 代码实现均提供了明确证据

### Section 2: Epic Impact Assessment

- `2.1` [x] Done：`Epic 5` 与 `Epic 6` 不应回滚，但其交互层实现应视为可演进的第一版
- `2.2` [x] Done：需要新增一组正式交付项承载 `AI application runtime layer + Vercel AI SDK bridge`
- `2.3` [x] Done：`Epic 8` 与后续移动端最受影响；`Epic 7` 主线仅受次级影响
- `2.4` [x] Done：建议新增独立 Epic，而不是把该路线零散塞回已完成 stories；该 Epic 不只覆盖 UI，也覆盖 memory / knowledge / skills / tools 的工程接线层
- `2.5` [x] Done：优先级建议为“`7.1 / 7.2` 继续优先，同时把该新 Epic 插入到移动端深推之前”

### Section 3: Artifact Conflict and Impact Analysis

- `3.1` [x] Done：PRD 不冲突，但 `FR-17` 应补充“统一 AI application runtime layer”的正式约束
- `3.2` [x] Done：Architecture 已有判断，但仍偏向交互层口径；应升级为“正式纳入行动计划，并补充 memory / MCP / agent runtime 边界”
- `3.3` [x] Done：UX 已定义“流式分析画布”，但缺少 renderer registry、multi-surface part lifecycle 的正式说明
- `3.4` [x] Done：受影响的次级工件包括 story 拆解、测试策略、移动端投影、前端状态管理、工具系统、知识资源接入与后续 observability

### Section 4: Path Forward Evaluation

- `4.1` [x] Viable：Direct Adjustment 可行，通过新增 Epic 和 story 组承接交互层演进
- `4.2` [ ] Not viable：不建议回滚 `Epic 5 / 6` 已完成实现
- `4.3` [ ] Not viable：无需缩减 MVP；问题不是目标过大，而是交互运行时层尚未正式化
- `4.4` [x] Done：推荐 **Hybrid：新增独立 Epic + 保持既有执行内核不变**

### Section 5: Proposal Components

- `5.1` [x] Done
- `5.2` [x] Done
- `5.3` [x] Done
- `5.4` [x] Done
- `5.5` [x] Done

### Section 6: Final Review and Handoff

- `6.1` [x] Done
- `6.2` [x] Done
- `6.3` [x] Done：用户已批准
- `6.4` [x] Done：已回写 `PRD`、`architecture`、`epics.md` 与 `sprint-status.yaml`
- `6.5` [x] Done：handoff 方向已明确

## 3. 影响分析

### Epic 5 / Epic 6 的影响

- **状态判断：** 不建议重开，不建议回滚
- **原因：**
  - 这两组 epic 已经交付了真实产品事实：执行、流式反馈、结论、追问、历史
  - 它们提供的是系统的 canonical business truth，不是必须被替换的 UI 技术细节
- **需要修正：**
  - 后续新 Epic 应把 `execution events / snapshots / follow-ups / history` 视为 source of truth
  - `Vercel AI SDK` 只消费这些事实，不能重定义它们

### Epic 7 的影响

- **状态判断：** 继续作为产品化主线
- **原因：**
  - `7.1` 服务端授权与 `7.2` 审计仍是交付底线
  - 新的交互层如果进入，会放大“工具调用审批、审计事件、跨端恢复”的需求，但不替代 Epic 7 主线

### Epic 8 的影响

- **状态判断：** 直接受益，且应在它之前完成新的交互层基线
- **原因：**
  - 移动端摘要、轻量追问、恢复与投影，本质上都需要更稳定的 message / part / projection 生命周期
  - 继续直接复用当前页面级状态拼接，会让移动端实现成本偏高

### Epic 9 的影响

- **状态判断：** 强相关，但不应混层
- **原因：**
  - `Epic 9` 解决的是 canonical ontology / governance / versioning / audit
  - 本次引入的 AI SDK 只能帮助你把 ontology 相关资源、prompt、tool surface 更工程化地接入模型与 UI
  - 它不能替代 ontology registry、自有知识治理和版本审计

### PRD 的影响

- **冲突程度：低**
- **判断：**
  - `FR-17` 已明确要求统一可渲染内容块
  - 本次不是改变产品目标，而是把 FR-17 的实现策略正式化

### Architecture 的影响

- **冲突程度：中**
- **当前问题：**
  - 文档已承认 `Vercel AI SDK` 合适，但仍属于“建议”口径
  - 需要提升为“批准纳入计划”的正式架构决策
- **需要修改：**
  - 明确 `AI SDK UI` 是交互层选型
  - 明确它不承担持久化真相、业务编排和治理职责

### UX 的影响

- **冲突程度：中**
- **当前问题：**
  - UX 已经要求“流式分析画布”
  - 但尚未把 `renderer registry / UI parts / 工具态 / 审批态 / resume state` 作为 UX 级结构
- **需要修改：**
  - 补充“AI 原生画布组件语法”和“多端消息投影原则”

## 4. 推荐路径

### 选定方案

**Hybrid：保持当前 `Worker + Redis + Tool Registry + Postgres Snapshots + Ontology/Governance` 边界不变，新增独立 Epic 引入 `Vercel AI SDK` 作为 AI application runtime layer。**

### 为什么不建议直接把 AI SDK 变成系统底座

- 当前项目的核心约束是：
  - 可追溯
  - 可审计
  - 权限边界清晰
  - 失败可诊断
- 这些能力目前已经以自有领域模型与持久化事实存在
- 如果让 `Vercel AI SDK` 反向接管：
  - 执行计划生成
  - 工具选择
  - Worker 状态协调
  - 历史与结果持久化
  - 本体 / 知识治理 / 审批发布
  会导致边界混乱，并冲击已完成的 `Epic 5 / 6`

### 为什么建议现在正式引入

- 当前复杂度已经真实出现，不是“提前设计”
- 项目后续明确要做：
  - 更丰富的流式输出
  - 图表 / 图谱 / 表格 / timeline 自定义控件
  - 多轮追问与历史承接
  - 移动端结果投影与轻量追问
  - 记忆系统
  - 知识库 / MCP resource 接入
  - skills / prompts / tool surface 的可扩展化
- 如果继续完全手工维护，会把交互复杂度持续堆在页面层

### Vercel AI SDK 在本项目中的正确定位

它**可以帮助轻量化**：

- UI message / stream runtime
- tool 调用、审批与动态工具接线
- MCP tools / resources / prompts 的模型接入
- agent loop 的通用样板
- memory provider 或 custom memory tool 的接入面

它**不能替代**：

- 业务本体与知识治理系统
- 你的长期知识库索引、权限、审计与版本管理
- 产品级会话事实、follow-up 历史与 execution snapshot
- 核心 worker orchestration

### 风险评估

- **实施工作量：中**
- **对现有业务事实返工风险：低**
- **对前端交互层调整幅度：中**
- **对长期产品收益：高**
- **最优策略：** 不回滚已完成 Epic，新增独立交付面承接交互层现代化

## 5. 详细变更提案

### 5.1 PRD 变更提案

#### 建议更新 `FR-17 统一渲染块输出`

**Section:** [prd.md]({project-root}/_bmad-output/planning-artifacts/prd.md#L303)

OLD:

```md
系统应将分析执行过程、阶段结果、关键证据和最终结论组织为统一的可渲染内容块，以支持表格、图表、证据卡、执行节点、摘要卡等多种界面呈现方式，而不是仅返回纯文本结果。
```

NEW:

```md
系统应将分析执行过程、阶段结果、关键证据和最终结论组织为统一的可渲染内容块，并通过正式的 AI application runtime layer 管理消息、parts、工具态、resume、跨端投影以及与记忆/知识资源/技能系统的工程接线，以支持表格、图表、图谱、证据卡、执行节点、摘要卡等多种界面呈现方式，而不是仅返回纯文本结果。

该 runtime layer 可以采用 `Vercel AI SDK` 或同等级能力实现，但 canonical source of truth 必须仍然是服务端 execution events、持久化 result blocks、follow-up/history facts 以及独立的 ontology / knowledge governance 模型。
```

Rationale:

- 把 FR-17 从“结果块存在”提升为“结果块有正式运行时生命周期”
- 明确 AI SDK 可以进入，但它是应用运行时层，不是业务真相层

### 5.2 Architecture 变更提案

#### 建议将 `Vercel AI SDK` 从“建议可引入”升级为“批准纳入行动计划”

**Section:** [architecture.md]({project-root}/_bmad-output/planning-artifacts/architecture.md#L334)

OLD:

```md
- 若近期需要显著增强前端流式交互与工具调用体验，优先补充 `Vercel AI SDK`，但只作为交互层能力，不取代平台内部编排。
```

NEW:

```md
- 当前项目已在 `Epic 5 / 6` 完成交互事实模型与多轮历史，正式批准引入 `Vercel AI SDK` 作为 AI application runtime layer。
- 该引入仅覆盖：
  - UI message / part 生命周期
  - streaming UI 与 resume transport
  - tool invocation / approval 的交互承接
  - renderer registry 与多端投影消费
  - ToolLoopAgent / tool / dynamicTool / MCP client 等通用运行时能力
  - memory provider、provider-defined memory tools 或 custom memory tool 的接入面
- 该引入不覆盖：
  - execution planning
  - tool selection policy
  - Worker / Redis orchestration
  - Postgres snapshots / follow-up history 作为 canonical truth 的职责
  - ontology registry、知识治理、权限审计和知识发布流程
```

Rationale:

- 让架构文档从“方向判断”升级为“正式决策”
- 扩大到正确边界：不止 UI，也包括 memory / MCP / agent runtime 的工程承接
- 同时明确不可越界区域，防止后续误用

### 5.3 UX 变更提案

#### 建议补充“流式分析画布”的交互运行时定义

**Section:** [ux-design-specification.md]({project-root}/_bmad-output/planning-artifacts/ux-design-specification.md#L289)

OLD:

```md
- 从 `Epic 5` 开始，中央主区应进一步升级为“流式分析画布”，把执行轨、阶段结果块、证据块和结论块组织成连续阅读体验，而不是只停留在静态卡片堆叠
```

NEW:

```md
- 从 `Epic 5` 后段开始，中央主区应升级为正式的“AI 原生流式分析画布”，由统一消息与 part 生命周期驱动，把执行轨、阶段结果块、工具结果、审批态、证据块、结论块与追问入口组织成连续阅读体验，而不是只停留在静态卡片堆叠。
- 画布层应支持 renderer registry，使图表、图谱、表格、证据卡、时间线和摘要投影都来自同源交互 schema。
- 交互层还应为未来的 memory recall、知识资源提示、skills 激活态与工具审批态预留统一视觉语义。
```

Rationale:

- 让 UX 不只描述“视觉结果”，还描述“交互运行时结构”

### 5.4 Epic / Story 变更提案

#### 建议新增独立 Epic 10

OLD:

```md
当前 epics 中没有专门承载 AI 交互运行时现代化的 epic。
```

NEW:

```md
### Epic 10: AI 应用运行时与多端渲染层

平台团队可以在不改变既有执行内核、历史事实模型与知识治理边界的前提下，引入正式的 AI application runtime layer，统一流式消息、工具态、富渲染块、多端投影，以及记忆/知识资源/skills/工具系统的工程接入，从而支撑 PC 工作台、历史回放、移动端摘要和未来更高级的 AI 原生界面。

**FRs covered:** FR7, FR8, FR11, FR15, FR16, FR17
```

Rationale:

- 避免回头重开 `Epic 5 / 6`
- 让这次变更有独立优先级与 backlog 入口

#### 建议新增 Story 10.1

```md
### Story 10.1: 建立 AI Application Runtime Layer 与 Vercel AI SDK Adapter

As a 平台前端团队,
I want 在 Next.js / application 边界建立 AI Application Runtime Layer，并用 `Vercel AI SDK` 承接 stream transport、UI message lifecycle 与基础 tool runtime,
So that 现有 execution events、result blocks 和 follow-up 历史可以稳定映射为统一交互消息，而不是继续由页面手工拼接。
```

#### 建议新增 Story 10.2

```md
### Story 10.2: 建立 Renderer Registry，支持图表 / 图谱 / 表格 / 证据卡 / 时间线

As a 物业分析用户,
I want 在分析工作台中看到统一风格的富渲染分析块,
So that 我可以更高效地理解结论、证据与执行过程。
```

#### 建议新增 Story 10.3

```md
### Story 10.3: 会话、追问与历史的 UI Message Projection 持久化

As a 平台团队,
I want 将 AI SDK UI messages 作为 projection 持久化或可恢复对象，而不是作为唯一事实源,
So that 交互层可以恢复和续流，同时不冲击 execution snapshots 与 follow-up history 的 canonical truth。
```

#### 建议新增 Story 10.4

```md
### Story 10.4: Memory / Knowledge / Skills / Tools 的运行时接入面

As a 平台架构团队,
I want 为 memory、knowledge resources、skills prompts 和工具系统建立统一 runtime 接入面,
So that 后续新增长期记忆、知识库、技能系统和工具市场时，不需要继续在页面层和 route 层重复接线。
```

#### 建议新增 Story 10.5

```md
### Story 10.5: 移动端摘要、续流与轻量追问统一接入同源交互层

As a 移动端业务负责人,
I want PC 与 mobile 消费同一套 AI interaction schema,
So that 移动端结果查看、轻量追问和后续更高级交互都不需要重建第二套协议。
```

### 5.5 Sprint Status 变更提案

批准后建议在 [sprint-status.yaml]({project-root}/_bmad-output/implementation-artifacts/sprint-status.yaml) 中新增：

```yaml
  epic-10: backlog
  10-1-ai-interaction-rendering-layer-and-vercel-ai-sdk-adapter: backlog
  10-2-renderer-registry-for-rich-analysis-blocks: backlog
  10-3-ui-message-projection-persistence-and-resume: backlog
  10-4-runtime-bridge-for-memory-knowledge-skills-and-tools: backlog
  10-5-mobile-projection-and-lightweight-follow-up-on-shared-interaction-schema: backlog
  epic-10-retrospective: optional
```

## 6. 实施交接建议

### 变更范围分类

**Moderate**

- 不需要推翻 PRD 主目标
- 不需要回滚已完成业务功能
- 需要新增 Epic、更新 architecture / PRD / UX / epics / sprint-status
- 需要后续 story 级拆解与实现

### 推荐交接对象

- **PO / SM**
  - 批准是否新增 `Epic 10`
  - 调整 backlog 顺序
- **Architect**
  - 固化 `Vercel AI SDK` 边界
  - 定义 interaction schema、projection、resume、memory / MCP / skills bridge 策略
- **DEV**
  - 先落 `10.1`
  - 保持现有 execution / history / persistence truth 不变
- **UX**
  - 补 renderer registry 与 AI 原生画布组件语法

### 实施顺序建议

1. 批准本次 change proposal
2. 回写 `PRD / architecture / epics / sprint-status`
3. 先创建 `10.1` story，并补架构约束
4. 再推进 `10.2 -> 10.3 -> 10.4`
5. 在 `Epic 8` 深入前完成 `10.5`

### 成功标准

- 引入 `Vercel AI SDK` 后，现有 execution 与 follow-up 持久化模型不被替换
- PC 与 mobile 开始消费同源 interaction schema
- 富渲染块扩展成本下降，不再依赖页面级临时状态堆叠
- 工具调用、审批态、续流与历史回放的 UI 生命周期得到统一
- 未来引入记忆系统、知识库、skills 与工具系统时，具备统一 runtime 接入面，而不需要再次重造一套应用层胶水代码

## 7. 审批请求

本提案建议：

- **批准将 `Vercel AI SDK` 纳入当前项目行动计划**
- **批准新增 `Epic 10: AI 交互运行时与多端渲染层`**
- **批准后再回写主工件**

当前状态：

- `6.3` 用户批准：待定
- `6.4` sprint-status 更新：待定
