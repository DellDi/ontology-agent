# Story 10.3: 会话、追问与历史的 UI Message Projection 持久化与续流

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台团队,
I want 将 AI SDK UI messages 作为可持久化、可恢复、可续流的 projection，而不是作为唯一事实源,
so that 用户刷新页面、重新进入历史会话或中断后恢复时，交互层可以稳定回放与续流，同时不冲击 execution snapshots、result blocks 与 follow-up history 的 canonical truth。

## Acceptance Criteria

1. 当用户刷新页面、重新打开同一会话或从中断状态返回时，系统必须能够从已持久化的 UI message projection 或 resume 数据恢复当前交互视图。
2. 恢复后的视图必须保留上一次可见的 message / part 状态、当前执行上下文、当前轮次选择和最后已知的 stream cursor，且不能要求用户重新从零开始查看当前轮次。
3. 当 projection 缺失、过期、版本不匹配或损坏时，系统必须从 execution snapshots、result blocks 与 follow-up history 重新构建 projection，而不能把 projection 视为事实源。
4. 当用户切换 `historyRoundId` 或 `followUpId` 时，系统必须切换到对应轮次的 projection 或从该轮 canonical truth 重新构建对应视图，且不得覆盖其他轮次的历史 message 状态。
5. 当流式执行在页面中断后恢复时，系统必须支持从上一个已确认 cursor 继续续流，并且通过 message id / sequence 去重，避免重复应用同一批 UI message。
6. UI message projection 必须保持 owner / session 范围隔离，跨用户、跨会话或跨权限范围访问时必须拒绝读取，不能泄漏任何 message 内容或 resume 元数据。

## Tasks / Subtasks

- [ ] 建立 UI message projection 领域与存储契约（AC: 1, 3, 4, 6）
  - [ ] 定义独立于 AI SDK 的 projection read/write model，至少包含 session / execution / follow-up / history round 绑定、projection version、stream cursor、message tree 与恢复元数据。
  - [ ] 在 `src/domain` 与 `src/application` 中新增 projection 端口与 use case，确保 projection 只承担 UI 恢复职责，不承载业务事实。
  - [ ] 在 `src/infrastructure/postgres/schema/` 新增 projection 表与 migration，并补齐 owner/session 索引。
- [ ] 将 projection 接入会话加载与续流路径（AC: 1, 2, 4, 5）
  - [ ] 在 analysis session 页面初始加载时先读取 projection，再决定是否需要从 canonical truth 回填或继续 live stream。
  - [ ] 让 `analysis-execution-live-shell` 支持 projection hydrate + resume 流程，而不是只依赖第一次挂载时的本地 state。
  - [ ] 为 resume 场景补齐 cursor 去重逻辑，保证 reconnect 后不会重复渲染已确认 message / part。
- [ ] 将 history round switching 与 projection 绑定（AC: 2, 4）
  - [ ] 当 `historyRoundId` / `followUpId` 改变时，按轮次加载对应 projection 或重建对应 projection。
  - [ ] 保证历史轮次切换是只读的，不会把当前轮次的 UI message 状态写回到其他轮次。
- [ ] 覆盖恢复、续流与回退测试（AC: 1, 3, 5, 6）
  - [ ] 验证刷新 / 重新进入会话后可以恢复 UI message projection。
  - [ ] 验证 projection 缺失或过期时会从 canonical truth 重建，而不是静默失败。
  - [ ] 验证 resume 流不会重复应用 message / part。
  - [ ] 验证 owner-only 访问与历史轮次隔离。

## Dev Notes

### Canonical Truth Boundary

- 这项 story 的核心原则是：**projection 不是事实源**。
- 业务事实仍然只认 `execution snapshots`、`result blocks`、`follow-up history`，以及它们已经建立的 read model。
- UI message projection 只负责把这些事实还原成可恢复的交互视图，不能反向定义分析结论、步骤结果或历史轮次。
- 如果 projection 与 canonical truth 不一致，优先以 canonical truth 重建 projection，并把 projection 当作可替换缓存，而不是把错误投影当成真相继续传播。

### Resume And Round Switching

- projection 应该把恢复所需的 UI 语义显式保存下来，而不是只存一段纯文本摘要。
- 建议保存的恢复信息至少包括：
  - 当前 session / execution / follow-up / history round 绑定
  - message tree 或等价 UIMessage payload
  - 最后已确认的 stream cursor / sequence
  - projection version
  - 生成时间与最近更新时间
- 历史轮次切换必须走服务端读模型，不能让客户端本地 state 继续沿用上一轮的 message tree。
- 当前页面中的 live stream 只能在 server 侧 session / owner 范围内恢复，不能把 Redis 事件流或原始 SSE payload 直接暴露给浏览器作为恢复依据。

### Current Implementation Touchpoints

- 当前 `analysis-execution-snapshots` 已保存 `planSnapshot`、`stepResults`、`conclusionState`、`resultBlocks`、`mobileProjection` 和 `failurePoint`，但这仍然不是 UI message projection。
- 当前 `analysis-session-follow-ups` 已保存追问链、`currentPlanSnapshot` / `previousPlanSnapshot`、`currentPlanDiff` 与 `resultExecutionId`，可作为 projection 回填的历史事实来源。
- 当前 `analysis-history-panel` 已支持按轮次切换历史事实视图，但它只消费历史 read model，不负责 UI message 恢复。
- 当前 `analysis-execution-live-shell` 直接用 `EventSource` 合并 execution events，说明 projection 续流逻辑尚未抽成正式层。
- 当前 `stream` route 只负责按 `executionId` 拉取 Redis-backed 事件流并回放事件，尚未具备 projection-aware resume 能力。
- 当前 `analysis-execution-display.ts` 已有 session-scoped snapshot / job 过滤与事件合并辅助，可作为 projection hydrate/resume 逻辑的参考起点。

### Explicit Non-Goals

- 不把 projection 升级成 canonical truth。
- 不把 `mobileProjection` 扩展成完整 UIMessage 存储层。
- 不让浏览器直接读取 Redis、Postgres 或任何内部流式事实存储。
- 不重写 execution planning、follow-up 生成或 result block 的业务语义。
- 不在页面组件里拼接 projection 语义，所有恢复与校验都应走服务端应用层。

### Architecture Compliance

- 符合 `Next.js App Router` 的服务端优先模式，projection hydrate / resume 逻辑应优先在服务端完成。
- 符合架构中的 `REST + SSE` 交互模型，projection 只是应用层 read model，不改变现有执行事件总线的事实边界。
- 继续遵守平台自有 Postgres schema 承载平台态数据的原则，浏览器端不得直连 Redis / Postgres / LLM Provider。
- `Vercel AI SDK` 或等价 runtime bridge 只能出现在应用边界，不得渗透到 domain 事实层。
- 本 story 必须与 Story 5.4、6.4 保持一致：5.4 负责 execution/result 持久化，6.4 负责多轮历史事实，10.3 只负责 UI message projection 的恢复与续流。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-message-projection/` 或同等新领域目录，用于 projection 载荷、cursor、版本与 round 绑定模型
  - `src/application/analysis-message-projection/`，用于 projection hydrate / save / resume use cases
  - `src/infrastructure/postgres/schema/analysis-ui-message-projections.ts` 或同等新表定义
  - `src/infrastructure/analysis-message-projection/postgres-analysis-ui-message-projection-store.ts` 或同等 store
  - `src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx`
  - `src/app/(workspace)/workspace/analysis/[sessionId]/analysis-execution-display.ts`
  - `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx`
  - `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx`
  - `src/app/api/analysis/sessions/[sessionId]/stream/route.ts`
  - 视需要新增 projection / resume 读接口或 route handler，但不要把 projection 变成浏览器可直接操控的公开协议
  - 对应 migration 与 `drizzle/meta/_journal.json`

### Testing Requirements

- 至少覆盖：
  - 页面刷新或重新进入会话后，UI message projection 可以从服务端恢复
  - projection 缺失、过期或版本不匹配时会从 canonical truth 重建
  - 历史轮次切换不会污染其他轮次的 UI message 状态
  - 流式恢复后不会重复应用同一批 message / part
  - owner-only 读取与跨会话隔离
- 推荐使用真实 `next build + next start` 的 story 级集成测试，并保持串行执行。
- 若新增 projection 读写路径，测试里必须验证它不依赖浏览器端临时 state 作为事实来源。

### Previous Story Intelligence

- Story 5.4 已把 execution snapshot、result blocks、失败位置与最小投影字段落到 Postgres，本故事应直接复用这些稳定事实，而不是再造一套结果存储。
- Story 6.4 已把 follow-up 链与历史轮次做成只读回放结构，本故事必须尊重轮次边界，不得把多轮历史压成一个前端临时 blob。
- 当前 `analysis-history-panel` 已证明 history round switching 是服务端 read model 问题，不是纯前端切换问题。
- 当前 `analysis-execution-live-shell` 和 `stream` route 已证明 live execution 是事件流问题，不是页面本地状态拼接问题。
- Epic 10 前置的 10.1 / 10.2 已经把 runtime adapter 与 renderer registry 作为前置方向，本故事应在该 runtime 之上实现 projection persistence 与 resume，而不是回退到手工拼接消息。

### References

- [Epic 10: AI 应用运行时与多端渲染层](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#L1246)
- [architecture.md - 数据架构与 API / 前端边界](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#L197)
- [architecture.md - REST + SSE 与 App Router 边界](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#L222)
- [architecture.md - 前端服务端优先与投影边界](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#L232)
- [prd.md - MVP 范围与 PC / 移动端边界](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#L68)
- [prd.md - 用户旅程 2 / 3，强调重规划与多轮历史](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#L133)
- [sprint-change-proposal-2026-04-09-vercel-ai-sdk.md - runtime gap 与 resume projection](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09-vercel-ai-sdk.md#L18)
- [sprint-change-proposal-2026-04-09-vercel-ai-sdk.md - canonical truth 与后续风险](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09-vercel-ai-sdk.md#L128)
- [project-context.md - current facts and canonical source boundary](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/project-context.md#L111)
- [project-context.md - projection / canonical truth rule](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/project-context.md#L117)
- [Story 5.4: 保存步骤结果与最终结论](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/5-4-persist-step-results-and-final-conclusion.md#L15)
- [Story 6.4: 保留多轮循环历史与结论演化](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/6-4-preserve-multi-round-history.md#L15)
- [analysis-execution-snapshots.ts](/Users/zhouxia/Documents/open-code/ontology-agent/src/infrastructure/postgres/schema/analysis-execution-snapshots.ts#L6)
- [analysis-session-follow-ups.ts](/Users/zhouxia/Documents/open-code/ontology-agent/src/infrastructure/postgres/schema/analysis-session-follow-ups.ts#L6)
- [analysis-history-panel.tsx](/Users/zhouxia/Documents/open-code/ontology-agent/src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx#L29)
- [analysis-execution-live-shell.tsx](/Users/zhouxia/Documents/open-code/ontology-agent/src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx#L22)
- [stream/route.ts](/Users/zhouxia/Documents/open-code/ontology-agent/src/app/api/analysis/sessions/[sessionId]/stream/route.ts#L28)
- [analysis-execution-display.ts](/Users/zhouxia/Documents/open-code/ontology-agent/src/app/(workspace)/workspace/analysis/[sessionId]/analysis-execution-display.ts#L21)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story drafted from approved Epic 10 runtime decision, existing snapshot/follow-up schema, and current stream/history implementation touchpoints.

### Completion Notes List

- Story 10.3 now fixes the boundary that UI projection is resumable state, not canonical truth.
- The story explicitly covers round switching isolation, resume cursor de-duplication, owner/session isolation, and canonical-truth rebuild when projection is stale or damaged.
- Persistence, hydrate, and resume responsibilities are positioned on the server-side application boundary rather than page-local state.

### File List

- /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-3-ui-message-projection-persistence-and-resume.md
