# Story 10.2: 建立 Renderer Registry 支持富分析块

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在分析工作台中看到统一风格、可扩展的富渲染分析块,
so that 我可以更高效地理解结论、证据、执行过程，以及审批态和 skills 态的状态变化。

## Acceptance Criteria

1. 当分析会话进入流式执行或结论回放阶段时，系统必须先把当前 `renderBlocks` 规范化为统一 part schema，再通过正式的 renderer registry 选择对应 UI parts，而不是在页面层直接写 `switch` / `if` 分支来硬编码渲染逻辑。
2. 当 part 类型属于以下富分析语义时，系统必须支持正式渲染路径，而不是只停留在纯文本或表格：
   - 图表 `chart`
   - 图谱 `graph`
   - 表格 `table`
   - 证据卡 `evidence-card`
   - 时间线 / 执行节点 `timeline`
   - 审批态 `approval-state`
   - skills 态 `skills-state`
   - 同时保留现有 `status` / `kv-list` / `tool-list` / `markdown` 的兼容渲染能力
3. 当同一个 part 被 PC 工作台和移动端消费时，系统必须基于同源 schema 输出不同投影：PC 端优先完整、密度更高的富信息展示，mobile 端优先轻量、可读、低负担投影；两者不得维护两套互不兼容的 DTO 或独立渲染协议。
4. 当新增一种富渲染块类型时，开发者只需要补充 schema + registry entry + renderer 组件 / 投影适配，不应再回到 `AnalysisExecutionStreamPanel`、`AnalysisConclusionPanel` 或页面路由里复制临时逻辑。
5. 当 registry 遇到未知、非法或当前 surface 不支持的 part 时，系统必须显式输出可诊断的 fallback block，保留 part 类型、来源和必要调试上下文，不能静默丢弃内容或假装渲染成功。
6. 当执行流、结论流和后续 projection 共享同一 part schema 时，现有结果读模型和持久化结构必须保持兼容，且需要有对应测试证明 PC / mobile 读取到的是同一语义来源，而不是分别拼装出来的结果。

## Tasks / Subtasks

- [ ] 建立统一 part schema 与 renderer registry 约定（AC: 1, 4, 5, 6）
  - [ ] 将当前 `renderBlocks` 正式提升为共享的 interaction part schema，明确 part `kind`、`version`、`source`、`surface hints`、`title/label`、`payload` 与诊断字段。
  - [ ] 提供 registry 接口，至少包含 `register`、`resolve`、`render`、`project` 与 `fallback` 能力，保持 Map/descriptor 风格的显式查找语义。
  - [ ] 保持 schema 验证 fail loud：非法 part 在边界层报清楚，不要吞错后返回空数组。

- [ ] 落地富分析块 renderer 实现（AC: 1, 2, 4）
  - [ ] 为 `chart`、`graph`、`table`、`evidence-card`、`timeline`、`approval-state`、`skills-state` 建立正式 renderer。
  - [ ] 保留并迁移现有 `status` / `kv-list` / `tool-list` / `markdown` 渲染能力，避免把老能力拆断。
  - [ ] 让 renderer 只关注语义渲染，不承担事件拉取、状态合并或持久化职责。

- [ ] 将现有工作台面板切换到 registry 驱动（AC: 1, 4, 5, 6）
  - [ ] 改造 `AnalysisExecutionStreamPanel`，移除页面级手写分支渲染，改为 registry 驱动的统一 block renderer。
  - [ ] 改造 `AnalysisConclusionPanel`，去掉 table-only 的重复实现，让结论区复用同一套 renderer。
  - [ ] 保持 `analysis-execution-display.ts` 的职责聚焦在事件合并、read model 组装和结论推导，不把渲染逻辑塞回去。

- [ ] 建立 PC / mobile 同源 projection 约束（AC: 3, 6）
  - [ ] 为同一个 canonical part 提供 workspace / mobile 两种 projection 变体，确保语义一致、密度不同。
  - [ ] mobile 投影只做信息裁剪和布局压缩，不重写业务语义，不引入第二套协议。
  - [ ] 与现有 `mobile_projection` 事实字段保持方向一致，为 10.3 的持久化与续流留接口，但不在本 story 中实现完整移动端页面。

- [ ] 补齐 story 级验证（AC: 1, 2, 3, 4, 5, 6）
  - [ ] 验证 registry 可以解析当前 stream / conclusion 里的基础块，并正确渲染新富块类型。
  - [ ] 验证未知 part 会落到显式 fallback，而不是 silent drop。
  - [ ] 验证 PC / mobile 从同一 canonical part 产生不同 projection，但语义一致。
  - [ ] 验证现有 execution stream、结论排序和 snapshot 数据仍可正常展示。

## Dev Notes

### Review Adjustments

- 建议在本 story 中增加“part 白名单与 maturity level”说明，避免第一版 renderer registry 一口气吃下所有 rich block：
  - Phase A：`status-banner / step-timeline / markdown / kv-list / table / evidence-card / conclusion-card`
  - Phase B：`chart / graph / ranked-causes / scope-change`
  - Phase C：`approval-state / skills-state`
- `renderer registry` 应只决定“如何渲染”，不决定“这个 part 是否应该出现”。后者应由上游 runtime / projection 层负责，避免 registry 反向侵入业务逻辑。
- 建议要求 10.2 依赖 10.1 先给出统一 ownership matrix，否则 part schema、projection schema、resume schema 很容易分别扩展，最后又回到多协议状态。

- 本 story 的核心不是“再做一组 UI 卡片”，而是把分析结果的结构语义、渲染选择与跨端投影正式化。它要解决的是“后续新增富块时，页面不再膨胀成临时 switch 大杂烩”。
- 这里的 `part schema` 是对当前 `renderBlocks` 的正规化升级。短期内可以继续兼容现有 SSE / result model 数据形态，但 UI 消费层必须走统一 registry，而不是继续直接消费原始 payload 结构。
- `10.1` 负责 AI application runtime layer 与消息生命周期，本 story 不接管 transport、SSE、EventSource、resume 或持久化编排；它只定义和消费 interaction part 的渲染与投影边界。
- `10.3` 才会处理 UI message projection 的持久化与恢复，所以本 story 只需把 projection contract 设计正确，不要提前把续流状态写死成页面私有实现。
- `10.5` 会复用同一套 schema 做移动端结果查看与轻量追问，因此本 story 必须先把 PC / mobile 的同源关系定死，避免后面再造第二套 mobile DTO。
- 从 UX 约束上，renderer registry 不只是技术注册表，还必须服从 `AI-native analysis canvas` 的阅读顺序：`status -> timeline -> evidence -> reasoning -> conclusion -> action`。不要把 rich blocks 渲染成随机卡片墙。
- 本 story 新增 part 时，必须遵守 Epic 10 UX 增补定义的 `part taxonomy` 和 `surface projection` 规则：相同 part 只允许投影不同，不允许在 `PC / mobile` 上语义不同。
- `Context Rail` 只能作为当前焦点 message 的放大镜，不能变成第二条主叙事线；`renderer` 必须围绕主 narrative lane 组织，而不是让右侧栏重新组装结论。
- 未知 part、暂不支持的 part、或当前 surface 不允许显示的 part，都必须走显式 `fallback-block`，以符合 Epic 10 的 fail-loud UX 规则。

### Current Code Reality

- `src/domain/analysis-execution/stream-models.ts` 目前只正式支持 `status`、`kv-list`、`tool-list`、`markdown`、`table` 五类 render block，而且验证逻辑是直接按类型分支。
- `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx` 现在是页面级 `if (block.type === ...)` 手写渲染，已经明显暴露出 registry 缺位。
- `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conclusion-panel.tsx` 目前还在重复实现 table 渲染，说明结论区和流式区没有共享 renderer。
- `src/domain/analysis-result/models.ts` 负责从事件里提炼结论，但同时也在拼接 `renderBlocks`，这会让“语义模型”和“展示模型”继续黏在一起，10.2 应该把展示职责收拢到 registry。
- `src/infrastructure/postgres/schema/analysis-execution-snapshots.ts` 已经有 `resultBlocks` 和 `mobileProjection` 事实字段，说明仓库并不缺投影容器，缺的是统一的 part schema 和投影生成规则。
- `src/application/tooling/use-cases.ts` 已经使用 `Map` 风格的 registry 语义，renderer registry 最好沿用这种显式、可诊断、可测试的方式，而不是再造隐式查找。

### Architecture Compliance

- 必须遵循 `domain -> application -> infrastructure -> app` 的分层方式：part schema 和校验规则放在 domain / application，registry 组装放在 application，React 组件只做消费与呈现。
- 浏览器端不能直接把原始 worker 事件当最终 UI 状态；必须消费服务端整形后的 interaction parts 和 projection 结果。
- renderer registry 只负责展示语义，不负责执行编排、工具调用、权限判断或知识治理。那些仍然属于独立平台能力。
- 该 story 要显式满足 `FR-17` 与 `AI Interaction Rendering Layer` 的方向：统一渲染块输出、同源 PC/mobile projection、为 skills / approval / memory 预留视觉语义。
- 不要为了支持富块而把运行时、持久化和页面状态硬揉成一个大对象；registry 是契约层，不是黑箱缓存层。

### Library / Framework Requirements

- 继续使用现有 `Next.js 16`、`React 19`、`TypeScript 5`、`Tailwind 4` 与项目既有 design tokens。
- 优先复用当前工作台的 `glass-panel`、`hero-panel`、`status-banner`、品牌蓝白体系与既有排版节奏，避免引入突兀的新视觉语言。
- 如果需要图表或图谱容器，优先采用轻量、可控、易测试的实现方式；不要为了一个 story 贸然引入新的重型图形库。
- 代码风格应保持纯函数、可组合、可测试，renderer 尽量无副作用，方便未来在 10.3 / 10.5 复用。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-execution/stream-models.ts`
  - `src/domain/analysis-result/models.ts`
  - `src/application/analysis-interaction/` 或等价的 registry / projection 组装层
  - `src/app/(workspace)/workspace/analysis/[sessionId]/_components/`
  - `src/app/(workspace)/workspace/analysis/[sessionId]/analysis-execution-display.ts`
  - 必要时可在 `src/infrastructure/analysis-execution/` 下补充与 snapshot / projection 对接的适配器
  - 对应 `tests/story-10-2-*.test.mjs`
- 如果要新增统一 renderer helper，优先放在 shared / application 层，不要把 registry 逻辑散进单个 page component。
- 如果需要为 mobile 预留 projection helper，建议与 workspace 的 render contract 同目录收口，避免将来拆出第二套协议实现。

### Testing Requirements

- 至少覆盖：
  - 统一 part schema 的校验与类型分派
  - renderer registry 对支持类型的解析与渲染
  - 未知 / 非法 part 的 fallback 行为
  - `AnalysisExecutionStreamPanel` 与 `AnalysisConclusionPanel` 共享同一 registry
  - PC / mobile projection 从同源 schema 产生不同结果，但语义一致
  - 现有 `status` / `kv-list` / `tool-list` / `markdown` / `table` 不回归
- 如果实现改动触碰到 App Router 客户端组件和工作台路由，交付前应跑匹配范围的 story 测试，并补 `pnpm lint` / `pnpm build` 级别验证，至少证明主工作台路径未被破坏。

### Previous Story Intelligence

- `Story 5.2` 已把执行事件里的 `renderBlocks` 作为阶段结果承载方式站稳，说明这是可沿用的 canonical 输入，而不是临时页面状态。
- `Story 5.3` 已把结论提炼成独立的 read model，但当前结论面板仍然重复 table 渲染，10.2 正好可以把这部分收口到 registry。
- `Story 5.4` 已把 `resultBlocks` 和 `mobileProjection` 写入 snapshot，说明投影与持久化是已有事实；10.2 只需要把它们的语义来源统一。
- `Story 8.1` 已明确移动端摘要必须来自同源 render schema 投影，而不是单独 DTO；10.2 需要把这个原则前置为正式 registry / projection contract。
- 当前工作台流式面板和结论面板的实现现状，恰好证明“没有 registry 时，页面会自然长出重复渲染逻辑”。

### Git Intelligence Summary

- 最近提交以文档和平台能力收口为主，说明仓库当前更适合做“正式契约补强 + 结构性收口”，而不是继续散落地补临时 UI 分支。
- 最近工作重点仍围绕 execution / history / governance 的 canonical truth 维护，因此 10.2 需要保持渲染层纯粹，不回头污染 worker、snapshot 或工具治理主线。
- 仓库里已有 registry 风格（例如 tooling），所以本 story 更像是把同类模式推广到 interaction rendering，而不是引入全新范式。

### Latest Technical Information

- `src/infrastructure/postgres/schema/analysis-execution-snapshots.ts` 已明确存在 `resultBlocks` 与 `mobileProjection` 字段，这两个字段会是后续 projection 与回放的落点，但本 story 不改数据库结构。
- `src/application/analysis-execution/persistence-use-cases.ts` 当前通过 `buildResultBlocks()` 把结论和阶段事件合并为 snapshot 结果，因此富块扩展应继续沿着这个聚合点前进，而不是让 page 自己再做一层拼装。
- `src/app/api/analysis/sessions/[sessionId]/stream/route.ts` 仍然只是 SSE transport；它不应该知道任何具体 block 的视觉细节。
- `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx` 只负责拉流与事件合并，适合作为 registry 渲染的宿主，但不应承载任何 part 业务规则。
- 当前 `stream-models.ts` 对未知 block 会直接报错，这很好，说明基础契约是 fail loud 的；10.2 需要在此基础上把“可渲染类型集合”扩大，而不是把错误隐藏起来。

### Project Structure Notes

- workspace UI 仍以 `glass-panel`、`hero-panel` 和品牌蓝白视觉为主，富块渲染也要保持这一风格，不要把分析工作台变成传统 ERP 式密集表格页。
- 这份 story 的目标是建立统一语义层，所以命名应围绕 `analysis interaction`、`renderer registry`、`projection`、`surface`，不要只围绕某一个具体页面组件命名。
- 若后续需要为 mobile 做专门 surface，应该复用这里定义的 schema 和 registry，而不是重新发明一套 `mobile analysis DTO`。
- 本 story 只负责“看见什么、如何渲染、如何投影”，不负责“内容从哪里来、如何运行、如何恢复”，这些分属 10.1 / 10.3 / 10.4。
- 推荐实现顺序应优先落 `foundation parts + evidence-card + conclusion-card + table`，再逐步放开 `chart / graph / approval-state / skills-state`，与主画布 wireframe 的分层节奏保持一致。

## References

- [Source: epics.md]({project-root}/_bmad-output/planning-artifacts/epics.md)
- [Source: architecture.md]({project-root}/_bmad-output/planning-artifacts/architecture.md)
- [Source: prd.md]({project-root}/_bmad-output/planning-artifacts/prd.md)
- [Source: ux-design-specification.md]({project-root}/_bmad-output/planning-artifacts/ux-design-specification.md)
- [Source: ux-epic-10-ai-native-interaction-addendum.md]({project-root}/_bmad-output/planning-artifacts/ux-epic-10-ai-native-interaction-addendum.md)
- [Source: ux-epic-10-main-canvas-wireframes.md]({project-root}/_bmad-output/planning-artifacts/ux-epic-10-main-canvas-wireframes.md)
- [Source: project-context.md]({project-root}/_bmad-output/project-context.md)
- [Source: Story 9.1]({project-root}/_bmad-output/implementation-artifacts/9-1-minimal-ontology-registry-and-version-model.md)
- [Source: stream-models.ts]({project-root}/src/domain/analysis-execution/stream-models.ts)
- [Source: analysis-result models]({project-root}/src/domain/analysis-result/models.ts)
- [Source: persistence use-cases]({project-root}/src/application/analysis-execution/persistence-use-cases.ts)
- [Source: stream use-cases]({project-root}/src/application/analysis-execution/stream-use-cases.ts)
- [Source: analysis-execution-display.ts]({project-root}/src/app/(workspace)/workspace/analysis/[sessionId]/analysis-execution-display.ts)
- [Source: analysis-execution-stream-panel.tsx]({project-root}/src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx)
- [Source: analysis-conclusion-panel.tsx]({project-root}/src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conclusion-panel.tsx)
- [Source: analysis-execution-live-shell.tsx]({project-root}/src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx)
- [Source: stream route]({project-root}/src/app/api/analysis/sessions/[sessionId]/stream/route.ts)
- [Source: analysis-execution-snapshots.ts]({project-root}/src/infrastructure/postgres/schema/analysis-execution-snapshots.ts)
- [Source: tooling use-cases]({project-root}/src/application/tooling/use-cases.ts)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Completion Notes List

- Story context now fixes the renderer problem into a formal `part schema + registry + projection` contract instead of page-level `switch` rendering.
- The story explicitly separates rendering concerns from runtime transport, projection persistence, and runtime capability bridging to avoid overlap with Stories 10.1, 10.3, and 10.4.
- PC/mobile same-schema projection, explicit fallback behavior, and regression guardrails are all included so future rich blocks can expand without duplicating page logic.

### File List

- {project-root}/_bmad-output/implementation-artifacts/10-2-renderer-registry-for-rich-analysis-blocks.md
