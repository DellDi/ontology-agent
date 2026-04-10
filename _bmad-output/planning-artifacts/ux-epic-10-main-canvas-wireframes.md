# Epic 10 Main Canvas Wireframes And State Layering

**Author:** Codex
**Date:** 2026-04-09
**Status:** Draft for implementation alignment
**Primary UX Mode:** `Streaming-first narrative canvas`
**Base References:** [ux-design-specification.md]({project-root}/_bmad-output/planning-artifacts/ux-design-specification.md), [ux-epic-10-ai-native-interaction-addendum.md]({project-root}/_bmad-output/planning-artifacts/ux-epic-10-ai-native-interaction-addendum.md)

## Purpose

这份文档把 Epic 10 的 `AI-native analysis canvas` 从抽象原则压成更可实施的主画布骨架与状态分层草图。

目标不是交付高保真视觉稿，而是先统一：

- 主画布的空间结构
- 流式叙事的阅读顺序
- 证据区和结论区如何围绕 narrative lane 协作
- `streaming / resume / history / approval / follow-up` 等状态如何进入同一画布

## Design Decision

本次主画布采用：

`流式叙事优先`

这意味着：

- 中央主区首先是一个持续推进的分析叙事流
- 证据与结论不是分裂成两个产品，而是围绕这条叙事流出现和聚焦
- 用户阅读路径是“现在发生了什么 -> 新出现了什么证据 -> 结论如何被更新 -> 我下一步能做什么”

## Desktop Canvas Wireframe

### Primary Layout

```text
+--------------------------------------------------------------------------------------------------+
| Global Header                                                                                   |
| Breadcrumb / Session title / Org scope / Session status / Last updated / Share actions          |
+----------------------+----------------------------------------------------+----------------------+
| Left Navigation      | Main Analysis Canvas                               | Context Rail         |
|                      |                                                    |                      |
| - Workspace home     | +----------------------------------------------+   | +------------------+ |
| - Sessions           | | Session Frame                                 |   | | Current Focus    | |
| - History            | | Question / Round / Scope / Runtime status     |   | | Evidence stack   | |
| - Governance         | +----------------------------------------------+   | | Related sources   | |
| - Settings           |                                                    | | Approval summary  | |
|                      | +----------------------------------------------+   | | Tool state        | |
|                      | | Narrative Lane                                |   | +------------------+ |
|                      | |                                              |   |                      |
|                      | | [Status Banner]                              |   | +------------------+ |
|                      | | [Step Timeline]                              |   | | History Switcher  | |
|                      | | [Stage Result Message]                       |   | | Current vs past   | |
|                      | | [Evidence Card / Chart / Table / Graph]      |   | +------------------+ |
|                      | | [Reasoning Update / Ranked Causes]           |   |                      |
|                      | | [Conclusion Card]                            |   |                      |
|                      | | [Approval / Tool / Skill State if needed]    |   |                      |
|                      | | [Resume Anchor / Recovery Hint]              |   |                      |
|                      | +----------------------------------------------+   |                      |
|                      |                                                    |                      |
|                      | +----------------------------------------------+   |                      |
|                      | | Follow-up Composer                           |   |                      |
|                      | | Input / quick prompts / continue actions     |   |                      |
|                      | +----------------------------------------------+   |                      |
+----------------------+----------------------------------------------------+----------------------+
```

### Reading Rule

用户从上到下只需要理解 4 件事：

1. 我当前处于哪一轮、什么范围、什么状态
2. 系统刚刚推进到了哪里
3. 新出现的证据或判断是什么
4. 我现在可以继续问什么、确认什么、恢复什么

## State Layering Model

### Layer 0: Session Frame

始终可见，代表会话级上下文：

- session title
- current round
- scope summary
- latest status
- last updated

职责：

- 给用户稳定感
- 防止刷新、切轮次或 streaming 时失去“我在哪”的上下文

### Layer 1: Persistent Narrative Anchors

固定在主画布顶部的持续锚点：

- `status-banner`
- `step-timeline`
- 当前 focus 提示

职责：

- 把“流式”变成“有轨道的流式”
- 避免用户只看到跳动消息而缺少结构

### Layer 2: Streaming Narrative Messages

这是主画布的核心层，持续增长的 message 序列：

- stage result
- evidence card
- table/chart/graph
- reasoning update
- conclusion update

职责：

- 承载分析叙事
- 把“过程”和“结果”组织成同一条阅读路径

### Layer 3: Focused Context Rail

右侧 Context Rail 不是第二条主叙事线，而是当前焦点 message 的放大镜：

- 当前证据延展
- 关联来源
- 当前工具与审批摘要
- 历史轮次切换入口

职责：

- 提供局部深化
- 不破坏中央 narrative lane 的主阅读顺序

### Layer 4: Action And Recovery Layer

只在需要时被强调：

- follow-up composer
- approval action
- resume recovery hint
- redirect to PC / mobile hint

职责：

- 将下一步行动显式化
- 把 interruption / recovery / governance 放在受控层，而不是偷偷埋进内容块

## Main Lane Message Order

主画布中每一批新消息都应遵循以下默认顺序：

1. `status-banner` 更新
2. `step-timeline` 推进
3. `stage-result`
4. `evidence-part`
5. `reasoning-part`
6. `conclusion-part`
7. `action/recovery prompt`

如果某一轮没有结论更新，也不应强行生成 conclusion card。

## Key Wireframes By State

### 1. Live Streaming

```text
[Session Frame]
[Status Banner: 正在分析投诉增长与收费下滑的共同原因]
[Step Timeline: 2/5 正在读取收费明细与投诉趋势]

[Message]
- 系统已完成范围校验
- 新增阶段结果：投诉趋势在 3 月末明显上升

[Evidence Card]
- 来源：投诉主题聚类
- 重点：停车与维修响应相关投诉升高

[Chart]
- 月度投诉量趋势

[Composer]
- 暂不可追问 / 可停止 / 可查看历史
```

### 2. Evidence Arrival

```text
[Status Banner]
[Step Timeline]

[Message]
- 发现新的强证据，正在更新原因排序

[Table]
- 项目 / 时间 / 投诉量 / 收缴率 / 差异

[Graph]
- 投诉主题 -> 项目 -> 收缴波动的关联图

[Context Rail]
- 当前聚焦证据的来源
- 适用范围
- 是否存在缺口
```

### 3. Conclusion Locked

```text
[Session Frame]
[Status Banner: 已完成]
[Step Timeline: 5/5]

[Conclusion Card]
- 主要原因 1
- 主要原因 2
- 主要原因 3

[Ranked Causes]
- 排名变化
- 证据强度

[Action Row]
- 继续追问
- 缩小范围
- 查看历史轮次
```

### 4. Resume Recovery

```text
[Session Frame]
[Recovery Banner: 已恢复到最近一次可继续位置]
[Resume Anchor]
- 上次停留：阶段 3 完成后
- 当前轮次：Round 2

[Narrative Lane]
- 从最近确认 message 继续显示

[Composer]
- 继续追问
- 回到当前最新结论
```

### 5. Historical Replay

```text
[Session Frame: History Mode]
[History Banner: 正在查看 Round 1 历史分析]
[Step Timeline: 历史只读]

[Narrative Lane]
- 历史阶段结果
- 历史证据卡
- 历史结论卡

[Context Rail]
- 切回最新轮次
- 对比当前轮次差异
```

### 6. Approval Required

```text
[Status Banner: 需要人工确认后继续]
[Approval State]
- 目标 capability
- 原因
- 请求时间

[Narrative Lane]
- 当前分析暂停在治理门禁

[Action Layer]
- 审批
- 拒绝
- 取消继续
```

## Context Rail Wireframe

### Context Rail Priorities

右侧栏只服务 3 类内容：

1. 当前焦点 message 的证据展开
2. 当前 runtime / approval / tool 状态摘要
3. 当前轮次与历史切换

### Context Rail Must Not Become

- 独立第二主画布
- 另一个结论面板
- 杂项信息堆积区

## Composer Wireframe

### Composer Rules

- 默认理解为“延续当前会话”
- 显示当前轮次上下文
- 在需要时给出 quick prompts
- 在受限状态下明确说明为什么不能继续

### Composer Layout

```text
+----------------------------------------------------------------------------------+
| Continue this analysis...                                                        |
| [Input area.................................................................]    |
| [Quick prompt: 继续解释原因1] [缩小到某区域] [加入某因素]                         |
| Runtime hint / Scope hint / Approval hint                                       |
+----------------------------------------------------------------------------------+
```

## Mobile Derivative Wireframe

mobile 不是 desktop 缩小版，而是同源 projection 的受限消费面。

```text
+--------------------------------------+
| Session Summary                      |
| Current conclusion                   |
| Last updated                         |
+--------------------------------------+
| Status Banner                        |
+--------------------------------------+
| Key Evidence Cards                   |
+--------------------------------------+
| Resume Anchor                        |
+--------------------------------------+
| Lightweight Follow-up Composer       |
+--------------------------------------+
```

### Mobile Rules

- 不显示完整 step timeline 编辑能力
- 不显示密集 graph / table / reasoning stack
- 只显示对当前行动最有帮助的摘要与恢复入口

## Motion And Transition Guidance

### Motion Principles

- 动效用于帮助理解状态推进，不用于制造“AI 感”
- 新 message 进入时使用轻量 reveal
- conclusion 锁定时使用明显但克制的收束反馈
- resume 恢复时突出 anchor，而不是整页闪动

### Avoid

- 连续弹跳或过强 loading shimmer
- 每个 rich block 都单独抢注意力
- 批量插入内容时造成阅读断裂

## Implementation Guidance For Epic 10 Stories

### Story 10.1

- 先保证 narrative lane 的 message order 正确
- 不要求首刀就把所有 rich block 做完整

### Story 10.2

- 先实现 foundation parts、evidence-card、conclusion-card、table
- `chart / graph / approval-state / skills-state` 可分批进入 registry

### Story 10.3

- resume 与 history mode 必须共用同一画布骨架
- 只变内容和状态，不变整个空间结构

### Story 10.5

- mobile 只消费 desktop 画布的紧凑投影
- 不允许长成新的分析工作台

## Recommendations

1. 第一版开发时优先保证主画布空间秩序，不要一开始追求所有 rich block 同时上线。
2. 所有新状态都应先问一句：它属于 narrative lane、context rail，还是 action layer。
3. 如果一个 UI 元素既像内容又像控制器，默认优先把它放入 action layer，而不是混进 evidence lane。
4. 任何 mobile 设计都应先从 desktop narrative lane 做投影，而不是独立起草。

## References

- [ux-design-specification.md]({project-root}/_bmad-output/planning-artifacts/ux-design-specification.md)
- [ux-epic-10-ai-native-interaction-addendum.md]({project-root}/_bmad-output/planning-artifacts/ux-epic-10-ai-native-interaction-addendum.md)
- [architecture.md - AI Interaction Rendering Layer]({project-root}/_bmad-output/planning-artifacts/architecture.md#L367)
- [10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md]({project-root}/_bmad-output/implementation-artifacts/10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md)
- [10-2-renderer-registry-for-rich-analysis-blocks.md]({project-root}/_bmad-output/implementation-artifacts/10-2-renderer-registry-for-rich-analysis-blocks.md)
- [10-3-ui-message-projection-persistence-and-resume.md]({project-root}/_bmad-output/implementation-artifacts/10-3-ui-message-projection-persistence-and-resume.md)
- [10-5-mobile-projection-and-lightweight-follow-up-on-shared-interaction-schema.md]({project-root}/_bmad-output/implementation-artifacts/10-5-mobile-projection-and-lightweight-follow-up-on-shared-interaction-schema.md)
