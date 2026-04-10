# Epic 10 AI-Native Interaction UX Addendum

**Author:** Codex
**Date:** 2026-04-09
**Status:** Draft for Epic 10 implementation alignment
**Base UX Reference:** [ux-design-specification.md]({project-root}/_bmad-output/planning-artifacts/ux-design-specification.md)

## Purpose

本增补文档不重写现有品牌与整体工作台 UX，而是专门补齐 `Epic 10` 需要的 `AI-native interaction grammar`。

它解决的不是“界面要不要高级、要不要好看”，而是：

- 同一份分析事实如何稳定进入 UI
- 流式过程、阶段结果、证据、结论、审批态、技能态如何拥有统一视觉语义
- `PC / mobile` 如何消费同源 interaction schema，而不是各写各的 DTO
- 后续引入 `memory / knowledge / skills / tools` 时，UI 如何扩展而不失控

## Relationship To Existing UX

现有 [ux-design-specification.md]({project-root}/_bmad-output/planning-artifacts/ux-design-specification.md#L79) 已经定义：

- 产品气质与品牌语言
- `PC` 为深度分析主战场、`mobile` 为轻量延展
- “问题驱动的分析协作”作为定义性交互
- 三栏工作台、蓝白清透、高可信、解释优先的总体验原则

本增补文档只新增以下层：

- interaction `message / part / projection` 语法
- renderer registry 的 UX 语义边界
- streaming / resume / approval / tool state 的状态表达
- rich blocks 在 `PC / mobile` 的投影规则

## Scope And Non-Goals

### In Scope

- `AI-native analysis canvas` 的信息层级
- `message / part / projection` 的界面语义
- rich blocks 的类型、阅读职责和降级规则
- `resume / historical replay / approval / tool execution` 的状态表达
- `PC / mobile` 同源投影规则

### Out Of Scope

- 不重做品牌、色板、排版系统
- 不定义新的业务事实模型
- 不把 runtime / renderer 设计成页面自由发挥的实现细节
- 不替代 ontology governance、knowledge governance、权限审计和 Worker orchestration
- 不在本阶段定义完整的 mobile 页面 IA 或完整设计稿

## UX Outcomes For Epic 10

Epic 10 的 UX 目标不是把现有工作台“聊天化”，而是把它升级成一块正式的 `AI-native analysis canvas`：

1. 用户能持续知道系统正在做什么，而不是只看到滚动文本。
2. 用户能在执行轨、证据、结论之间自然切换，而不是在多个面板里来回找信息。
3. UI 可以承接 `chart / graph / table / evidence / timeline / approval / skills` 等不同语义，而不是每次新增类型都改页面分支。
4. `PC / mobile` 阅读的是同一份事实的不同投影，而不是两套结果定义。
5. 后续引入 `memory / knowledge / skills / tools` 时，用户看到的是新语义块进入既有画布，而不是一批突兀的新弹窗和旁路协议。

## Canonical Interaction Grammar

### Mental Model

用户不应理解为“我在消费原始 SSE 事件”，而应理解为：

`一次分析会话 = 一条持续演化的分析叙事流`

这条叙事流由五层构成：

1. `Fact`
   服务端 canonical truth，例如 execution events、snapshots、result blocks、follow-up history。
2. `Message`
   面向用户阅读的交互单元，代表“系统刚刚推进了一个判断片段”。
3. `Part`
   message 内部的可渲染组成块，代表证据、图表、图谱、状态、审批等语义片段。
4. `Projection`
   面向具体 surface 的可阅读投影，例如 workspace projection、history projection、mobile projection。
5. `Surface`
   最终显示位置，例如 PC 主画布、右侧证据区、移动端摘要页、历史轮次回放。

### UX Rule

- 浏览器不直接理解 `Fact`
- 页面不直接拼接原始事件
- `Message` 负责阅读顺序
- `Part` 负责语义表达
- `Projection` 负责跨 surface 的密度差异

## Analysis Canvas Structure

### PC Workspace Canvas

`PC` 主工作台继续沿用现有三段结构，但语义上升级为：

1. `Session Header`
   展示问题、当前轮次、范围、最新状态、最后更新时间。
2. `Primary Narrative Lane`
   中央主画布，承载流式 message 序列。
3. `Context And Evidence Rail`
   右侧证据区，承接当前焦点 message 的延展信息，而不是独立生成另一套结论。
4. `Composer And Follow-up Entry`
   底部输入区，始终被理解为“延续当前分析”，不是重开一个 chat room。

### Reading Priority In The Main Lane

主画布遵循固定顺序：

1. 当前状态
2. 当前阶段推进
3. 阶段结果 / 证据块
4. 临时结论或排序变化
5. 最终结论
6. 下一步行动或追问入口

这样用户阅读的是“推理推进”，而不是随机拼接的卡片墙。

## Part Taxonomy

### Foundation Parts

- `status-banner`
  显示当前阶段、执行状态、重要风险、恢复提示。
- `step-timeline`
  显示计划执行轨与阶段推进，不承担最终结论表达。
- `markdown`
  承接必要的自然语言解释，但不能吞并结构化结果。
- `kv-list`
  用于轻量事实陈列。

### Evidence Parts

- `evidence-card`
  Epic 10 的核心部件。必须能表达证据摘要、来源、可信度、适用范围、与结论的关系。
- `table`
  用于对比、分组和明细阅读，不作为默认万能容器。
- `chart`
  用于趋势、占比、变化对比，优先服务“解释变化”。
- `graph`
  用于关系、路径、影响链或本体关联，不作为装饰图。

### Reasoning Parts

- `conclusion-card`
  表达当前最重要判断、结论强度和关键支撑证据。
- `ranked-causes`
  表达主要原因的排序变化，强调“为什么是这些，而不是别的”。
- `scope-change`
  表达用户缩小范围、补因素或重规划带来的语义变化。

### Runtime State Parts

- `approval-state`
  表达待批准、已批准、被拒绝、需要人工确认等治理门禁状态。
- `tool-state`
  表达工具已选择、运行中、已完成、不可用、被阻断等状态。
- `skills-state`
  表达 skill 被激活、待激活、被拒绝或降级使用的状态。
- `memory-state`
  表达 recall 命中、无命中、需确认、来源不可信等状态。

### Projection-Only Parts

- `summary-card`
  给 mobile 或历史摘要使用，不替代完整结论块。
- `resume-anchor`
  表达用户恢复时应该回到哪里，不作为业务事实。
- `fallback-block`
  当 renderer 未支持某 part 时显式展示诊断信息，而不是静默丢弃。

## Renderer Registry UX Contract

renderer registry 在 UX 层必须满足以下规则：

1. 新 part 类型的接入应表现为“新增语义块”，而不是“修改页面逻辑”。
2. 相同 part 在不同 surface 上只允许 `projection` 不同，不允许语义不同。
3. 未知 part 必须进入显式 fallback。
4. renderer 组件只负责呈现，不直接负责数据获取、权限判断或执行编排。
5. 所有 rich block 都必须定义：
   - 主要阅读目标
   - 推荐显示位置
   - 紧凑投影规则
   - 错误 / 空态 / 降级策略

## Streaming, Resume And Historical Replay Semantics

### Streaming

流式体验不应只表现为“不断追加新文字”，而应表现为：

- 状态先行
- 关键阶段有锚点
- 新 evidence / conclusion 进入时具有明确的层级切换
- 完成态要明显收束，而不是静默停止

### Resume

恢复语义应是：

- 回到最近可继续理解的位置
- 保留最后已知的状态和当前轮次
- 让用户感觉“工作没丢”，而不是“页面刷新后重新拼出来一个相似界面”

### Historical Replay

历史模式必须是只读回放 surface：

- 明确区分“当前轮次”与“历史轮次”
- 历史 message 不应与当前 live stream 混在一起
- 历史视图重点在理解当时发生了什么，而不是继续编辑那个历史状态

## Approval, Tool, Skill, Memory, Knowledge UX States

这部分是为未来扩展预留的统一语法，不要求 Epic 10 第一阶段全部落地，但必须先统一语义。

### Approval

`approval-state` 应显式区分：

- `pending-review`
- `approved`
- `denied`
- `requires-confirmation`
- `expired`

审批态必须看起来像治理门禁，而不是普通 toast。

### Tool

`tool-state` 应显式区分：

- 可用但未调用
- 已选择待执行
- 执行中
- 执行完成
- 不可用
- 被权限或审批阻断

### Skill

`skills-state` 应表达：

- 当前是否被激活
- 激活原因
- 使用范围
- 版本或来源提示

### Memory / Knowledge

memory 与 knowledge 在 UI 中不该表现为神秘“模型知道了什么”，而应表现为：

- 检索到了什么
- 来源是什么
- 可信边界是什么
- 是否只是补充上下文，而非业务真相

## PC / Mobile Projection Rules

### Shared Rule

`PC` 与 `mobile` 共享同一份 interaction schema，但阅读密度不同。

### PC Projection

- 保留更完整的 narrative lane
- 保留 timeline、evidence detail、tool state、approval state
- 支持高密度阅读与深度追问

### Mobile Projection

- 只保留 summary、key evidence、status、last updated、minimal history、lightweight follow-up
- 不承载完整计划编辑
- 不承载复杂多栏证据比对
- 不默认透出所有 rich blocks

### Mobile Whitelist

mobile 默认白名单只包含：

- `summary-card`
- `status-banner`
- `evidence-card` 的紧凑版
- `conclusion-card` 的紧凑版
- `resume-anchor`
- 必要的 `approval-state` 或 `tool-state` 摘要

## Fallback, Failure And Diagnostic UX

Epic 10 的 UX 必须坚持 `fail loud`，尤其在 AI-native 交互层：

- 未识别 part：显示 `fallback-block`
- projection 失真：显示可恢复提示和诊断上下文
- resume 失败：明确说明无法恢复，而不是伪造成功
- tool / approval 被阻断：明确说出原因和下一步

对用户来说，“我知道为什么现在看不到/做不了” 比“界面像没事一样但结果不对”更重要。

## Visual Language Constraints

本增补文档沿用现有 `Skyline Intelligence` 方向，不引入新的视觉主张：

- 继续使用蓝白清透、高可信、高结构化的主气质
- rich blocks 的高级感来自结构、比例和留白，不来自夸张动效
- `graph / chart / timeline / evidence` 应该被看作精密分析组件，而不是 BI 模板控件
- approval、skills、memory 等新状态必须与主品牌语言协调，不能长得像插件浮层

## Story Mapping

### Story 10.1

负责把 canonical facts 转成统一 interaction messages 与 parts。

### Story 10.2

负责把本增补文档中的 `part taxonomy + renderer registry UX contract` 落成正式渲染系统。

### Story 10.3

负责把本增补文档中的 `resume / historical replay / projection` 语义落成持久化与恢复系统。

### Story 10.4

负责把 `approval / tool / skill / memory / knowledge` 的服务端 runtime 接入带进同一交互语法。

### Story 10.5

负责把本增补文档中的 `PC / mobile projection rules` 落成受限移动端消费面。

## Recommendations

1. 在进入 `10.2` 实现前，先以本增补文档为准冻结第一版 part taxonomy。
2. 不要在 `10.1` 首刀里把所有 future parts 一次做完，先落 foundation parts 与 evidence/conclusion 主路径。
3. `mobile` 永远只做同源 projection 消费者，不做协议拥有者。
4. future `memory / knowledge / skills / tools` 的 UI 接入必须复用同一 grammar，不要长成一批旁路组件。

## References

- [ux-design-specification.md]({project-root}/_bmad-output/planning-artifacts/ux-design-specification.md)
- [ux-epic-10-main-canvas-wireframes.md]({project-root}/_bmad-output/planning-artifacts/ux-epic-10-main-canvas-wireframes.md)
- [architecture.md - AI Interaction Rendering Layer]({project-root}/_bmad-output/planning-artifacts/architecture.md#L367)
- [prd.md - FR-17]({project-root}/_bmad-output/planning-artifacts/prd.md#L305)
- [sprint-change-proposal-2026-04-09-vercel-ai-sdk.md]({project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09-vercel-ai-sdk.md#L325)
- [10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md]({project-root}/_bmad-output/implementation-artifacts/10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md)
- [10-2-renderer-registry-for-rich-analysis-blocks.md]({project-root}/_bmad-output/implementation-artifacts/10-2-renderer-registry-for-rich-analysis-blocks.md)
- [10-3-ui-message-projection-persistence-and-resume.md]({project-root}/_bmad-output/implementation-artifacts/10-3-ui-message-projection-persistence-and-resume.md)
- [10-4-runtime-bridge-for-memory-knowledge-skills-and-tools.md]({project-root}/_bmad-output/implementation-artifacts/10-4-runtime-bridge-for-memory-knowledge-skills-and-tools.md)
- [10-5-mobile-projection-and-lightweight-follow-up-on-shared-interaction-schema.md]({project-root}/_bmad-output/implementation-artifacts/10-5-mobile-projection-and-lightweight-follow-up-on-shared-interaction-schema.md)
