# Story 10.5: 移动端摘要投影、续流与轻量追问接入同源交互 schema

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 移动端业务负责人,
I want PC 与 mobile 消费同一套 AI interaction schema,
so that 移动端结果查看、续流和轻量追问都能沿用同源交互层，而不需要重建第二套协议。

## Acceptance Criteria

1. 当用户在 PC 和 mobile 打开同一分析会话时，系统必须从同源 `interaction schema` 生成不同的投影，而不是维护两套不兼容的消息协议或独立 DTO。
2. 当用户在 mobile 进入结果页时，系统必须展示面向手机阅读的摘要投影，至少包含当前结论、关键证据精华、分析状态、最近更新时间和必要的最小历史上下文；不得渲染完整 PC 计划编辑工作台。
3. 当用户在 mobile 重新进入一个已中断或已存在的会话时，系统必须通过共享 `resume` / projection 机制恢复到最近可继续的位置，并保持 canonical execution / follow-up truth 不变。
4. 当用户在 mobile 提交轻量追问或下钻指令时，系统必须将输入附着到原会话并继续同一 runtime；超出移动端边界的复杂计划编辑、深度编排或多步骤重构必须明确引导到 PC 工作台。
5. 当用户的权限仅覆盖部分项目、区域或组织范围时，mobile projection 必须继续遵守同一套服务端 scope 校验，只返回其有权查看的会话与结果片段。

## Tasks / Subtasks

- [ ] 建立共享 interaction schema 的移动端 projection contract（AC: 1, 2, 5）
  - [ ] 明确定义 `summaryProjection`、`resumeProjection` 和 `followUpProjection` 的最小字段集合。
  - [ ] 复用同源 render block / message part schema，不新增 mobile-only 消息协议。
  - [ ] 为 mobile projection 设定 version boundary，避免和 PC 端各自演化成两套事实源。
- [ ] 新增 mobile 结果页与 resume 入口（AC: 2, 3, 5）
  - [ ] 建立移动端专用 route 或 route group，作为受限投影消费层，而不是把 PC 页面做响应式缩小。
  - [ ] 在结果页展示摘要卡、状态、最近更新时间、最小历史上下文和可恢复入口。
  - [ ] 保持服务端权限、scope 与会话身份校验，不允许浏览器端自行拼装会话真相。
- [ ] 接入 mobile 轻量追问与边界控制（AC: 4, 5）
  - [ ] 复用既有 follow-up / iteration / resume 逻辑，将轻量输入附着到原 session。
  - [ ] 对复杂编辑、计划重组、长链路编排、工具态干预等请求做明确拦截或引导到 PC。
  - [ ] 确保移动端不会生成新的并行会话或独立消息协议分支。
- [ ] 覆盖 projection、resume 与边界回归测试（AC: 1, 2, 3, 4, 5）
  - [ ] 验证 PC 与 mobile 消费同源 schema，但输出不同投影。
  - [ ] 验证重新进入会话时能恢复到正确的可继续状态。
  - [ ] 验证轻量追问写回原会话，复杂输入被引导到 PC。
  - [ ] 验证 scope 过滤与只读边界不会被 mobile projection 旁路。

## Dev Notes

- 这是 Epic 10 的消费层故事，不是新的事实源故事。canonical truth 仍然是服务端 execution events、持久化 result blocks、follow-up / history facts，以及现有的权限与 scope 模型。
- mobile 端的目标不是复制 PC 工作台，而是提供 `summaryProjection + resumeProjection + lightweight follow-up` 的轻量入口，帮助用户在手机上快速理解现状、继续追问、重新进入中断会话。
- 共享 `interaction schema` 应该优先表达“同一份事实，不同的观察角度”，而不是“同一份 UI，不同的布局”。PC 可以保留高信息密度和完整操作面，mobile 只保留适合单手浏览和短输入的子集。
- 建议把 mobile projection 明确成受限投影层：只允许摘要卡、状态卡、关键证据精华、最近更新时间、最小历史上下文、轻量追问输入与恢复入口；不允许承载完整计划编辑器、复杂工具态、图表编排面板、深层证据树或多栏工作台。
- `resume` 的语义应当是“恢复当前会话的可继续状态”，不是“重新从客户端缓存拼一个看起来像会话的页面”。如果 projection 或 resume data 不完整，应 fail loud，并暴露明确的诊断信息，而不是静默降级成新会话。
- 轻量追问的语义应当和 Story 8.3 保持一致：它是对既有会话的延续，不是新 session，也不是 mobile-only 的另一套交互分支。只有真正短小、局部、低风险的下钻或澄清类输入才允许在 mobile 端闭环。
- 对于需要编辑计划、调整多步分析路径、处理复杂工具确认、查看密集历史轮次或做深度复盘的请求，mobile 端应保持边界清晰，给出明确的 PC 引导，而不是在手机上偷渡一个缩水版编辑器。
- 摘要投影要和 Story 8.1 / 8.2 保持信息一致：`current conclusion`、`key evidence`、`status`、`last updated`、最小历史上下文应从同一套 render schema 投影出来，避免移动端摘要和 PC 结果页出现口径漂移。
- Resume 与 history 的结合点来自 Story 6.4 的多轮历史保留能力：mobile 重新进入会话时，应能识别当前轮次、历史轮次和最新可继续轮次，不能把历史压扁成单一 blob，也不能覆盖旧轮次事实。
- 本 story 还必须服从 Epic 10 主画布投影白名单：mobile 默认只消费 `summary-card`、`status-banner`、紧凑 `evidence-card`、紧凑 `conclusion-card`、`resume-anchor` 及必要的 `approval/tool` 摘要，而不是默认透出所有 desktop rich blocks。
- mobile 页面应被视为 desktop `narrative lane` 的受限衍生 surface，而不是“另一套为手机重新设计的分析工作台”。

### Interaction Schema Boundary

- `interaction schema` 应作为跨端共享的语义契约，至少覆盖 message / part / block / status / history slice / follow-up entry / resume token 的关系。
- mobile 只消费 schema 的受限投影，不直接消费原始执行事件流，也不持有和 PC 不一致的字段语义。
- 如果 schema 以后扩展新块类型，mobile 只能在明确的投影白名单内逐步开放，而不是默认全部透出。
- mobile 投影必须优先保住“当前结论、关键证据、状态、恢复入口、下一步动作”这条最短阅读路径，而不是追求对 desktop rich layout 的全量复刻。

### Resume Semantics

- `resume` 的输入应优先来自服务端保存的 projection 或 resume state，而不是客户端临时状态。
- 恢复后应回到最近一轮可继续状态，并保留原会话的身份、权限、历史轮次和 follow-up 链接。
- 若恢复所需状态缺失，系统应给出可诊断的失败态，不应自动新建会话或伪造恢复成功。

### Lightweight Follow-up Boundary

- 轻量追问的判定应尽量服务端化，避免前端自行猜测“能不能问”。
- 允许：简短澄清、局部下钻、对当前结论做轻微补充、要求继续解释某个证据。
- 禁止：大段计划编辑、任务拆解改写、长链路编排、复杂工具审批、跨会话迁移、批量历史管理。
- 当输入超出边界时，优先引导用户去 PC 完成，而不是在 mobile 端偷偷做能力降级。

### Failure and Observability

- 不要吞掉 projection / resume / follow-up 的失败原因。
- 如果 schema 映射失败、权限过滤失败或恢复状态不一致，应输出可定位的错误语义与 trace 信息。
- 任何“看起来能用”的 fallback 都不能替代真实的 root-cause 修复。

### Architecture Compliance

- 继续遵守 `domain -> application -> infrastructure -> app` 的分层方式，mobile projection 组装应位于 application 边界，而不是 page component 里临时拼装。
- `PC` 与 `mobile` 必须共享同源 schema；mobile 只负责 projection，不负责定义第二套事实协议。
- canonical truth 仍然是服务端 execution snapshots、follow-up/history facts 和权限边界，UI message 或 projection 只能是派生视图。
- 继续使用服务端会话与 scope 校验，不允许移动端绕过授权路径或直接推导超范围数据。
- 若后续 `10.3` 已提供 UI message projection persistence / resume 能力，本故事应消费既有能力，而不是另起一套存储或恢复机制。

### File Structure Requirements

- 重点文件预计包括：
  - 移动端结果页或 route group
  - mobile projection 组装层，例如 `src/application/mobile/` 或等价模块
  - 共享 interaction schema / projection helper
  - 轻量追问入口或沿用现有 follow-up route / use case
  - resume 读取或 hydration 适配层
- 不要新增与 PC 不兼容的 mobile 专有协议目录，也不要把移动端逻辑塞进 PC 页面组件里。
- 如果需要新建测试辅助代码，应优先复用已有 story 测试模式，而不是引入一次性的临时脚本。

### Testing Requirements

- 至少覆盖：
  - PC 与 mobile 共享同源 schema，但呈现不同投影
  - mobile 结果页能够展示摘要、状态、最近更新时间和最小历史上下文
  - refresh / re-entry 后可以通过 resume 恢复到可继续状态
  - 轻量追问会写回原 session
  - 复杂输入会被明确引导到 PC
  - scope / permission 过滤在 mobile projection 中仍然生效
  - mobile 只消费白名单 projection，不会因为新 rich block 上线而意外透出 desktop-only 语义
- 测试应优先采用项目既有 story-based 集成测试风格，围绕真实路由、真实 session 与真实后端链路验证，而不是只测纯前端 mock。
- 若新增 route 或 projection 逻辑，至少补一条 story 级回归，确保 mobile projection 不会悄悄退化成 PC 缩小版。

### Previous Story Intelligence

- Story 8.1 已建立移动端最近分析摘要与同源结果投影的基础语义，本故事应在此基础上扩展到更完整的 resume 与轻量追问体验。
- Story 8.2 已明确移动端查看关键证据的只读边界，本故事应继续沿用同一套摘要与证据投影口径，避免出现多个移动端摘要版本。
- Story 8.3 已建立移动端轻量追问并附着原会话的能力，本故事应把这条写入口和 `resume` / projection 统一到同源交互层中。
- Story 6.4 已建立多轮历史保留与轮次区分能力，本故事必须尊重最新轮次、历史轮次与可恢复轮次的边界，不能覆盖旧事实。
- Story 10.3 规划的是 UI message projection 持久化与 resume，本故事应把 mobile 视为一个受限消费者：消费其成果，但不重新发明同类能力。

## References

- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#Epic 10: AI 应用运行时与多端渲染层]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#Story 10.5: 移动端摘要、续流与轻量追问统一接入同源交互层]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#FR-15 移动端结果查看]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#FR-16 移动端轻量追问]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#FR-17 统一渲染块输出]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Platform Strategy]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Experience Principles]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-epic-10-ai-native-interaction-addendum.md]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-epic-10-main-canvas-wireframes.md]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#AI Interaction Rendering Layer]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#API 与通信模式]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09-vercel-ai-sdk.md#4.4 Story 拆解与交付顺序]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09-vercel-ai-sdk.md#5.4 受影响的 Epic / Story 回写]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/project-context.md]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/8-1-mobile-latest-analysis-summary.md]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/6-4-preserve-multi-round-history.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story drafted against approved Epic 10 runtime strategy, existing mobile follow-up semantics, and current multi-round history boundaries.

### Completion Notes List

- Story 10.5 now locks mobile into a same-schema projection consumer instead of a parallel protocol owner.
- The mobile scope is intentionally limited to summary, resume, lightweight follow-up, and permission-safe viewing, with explicit PC handoff for complex planning and tool-heavy flows.
- Resume, projection, and follow-up semantics are aligned with Stories 8.1, 8.3, 6.4, and planned Story 10.3 so mobile does not drift from canonical session history.

### File List

- /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-5-mobile-projection-and-lightweight-follow-up-on-shared-interaction-schema.md
