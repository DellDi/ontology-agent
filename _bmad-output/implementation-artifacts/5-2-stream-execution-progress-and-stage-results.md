# Story 5.2: 流式反馈执行进度、稳定事件协议与阶段结果

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在分析执行期间持续看到当前步骤和阶段结果,
so that 我不需要等到任务全部结束才知道系统正在做什么。

## Acceptance Criteria

1. 分析任务执行期间，任一步骤进入运行、完成或失败状态时，系统必须向会话界面推送最新执行状态。
2. 用户可见状态更新间隔不得超过 5 秒。
3. 当分析执行超过 10 秒时，系统必须持续展示步骤级进度或阶段性发现，不能长时间无反馈。
4. 服务端必须输出稳定的 execution event envelope，至少覆盖 execution status、step lifecycle、stage result 和 tool/event metadata。
5. 客户端必须基于统一 render part / block schema 渲染阶段结果，而不是直接把原始 SSE payload 当作最终 UI 结构。

## Tasks / Subtasks

- [x] 建立 SSE 或等价服务端推流入口（AC: 1, 2, 3, 4, 5）
  - [x] 定义 execution event envelope。
  - [x] 定义 render part / block schema。
  - [x] 为 execution 建立稳定事件流模型。
  - [x] 客户端只负责订阅和渲染，不直接订阅 Redis。
- [x] 接入执行状态与阶段结果发布（AC: 1, 2, 3, 4, 5）
  - [x] 覆盖 running / completed / failed 等状态。
  - [x] 为超过 10 秒的执行提供持续反馈。
  - [x] 建立 Next.js 交互层 stream adapter。
- [x] 覆盖 SSE 合约与页面订阅测试（AC: 1, 2, 3, 4, 5）
  - [x] 验证事件序列稳定。
  - [x] 验证页面不会长时间无反馈。
  - [x] 验证至少 3 种非纯文本阶段结果块的渲染。

## Dev Notes

- 本故事重点是“服务端推流 + 稳定事件语义 + render schema”，不是最终归因内容。
- 若 Redis 参与状态协调，浏览器仍不能直接接入 Redis。
- 设计事件结构时要为 5.3 结论输出、5.4 结果持久化和 8.1 移动端投影保留阶段性结果字段。
- 如引入 `Vercel AI SDK`，只应作为 Next.js 交互层 stream / part 生命周期增强，不接管 worker 编排。

### Architecture Compliance

- 符合架构中的 REST + SSE 模式。
- 状态机和事件发布逻辑位于服务端模块，不位于 client component。
- 必须满足 NFR1 / NFR2 的反馈时效要求。

### File Structure Requirements

- 重点文件预计包括：
  - `src/app/api/analysis/sessions/[sessionId]/stream/route.ts`
  - `src/application/analysis-execution/`
  - 视需要新增事件发布 abstraction
  - 分析页订阅与阶段结果展示组件

### Testing Requirements

- 至少覆盖：
  - SSE route 存在且输出稳定事件
  - `running` / `completed` / `failed` 状态流
  - 长任务持续反馈
  - 客户端订阅后正确渲染已到达事件
  - render part / block schema 稳定且不直接泄漏内部协调结构

### Previous Story Intelligence

- Story 5.1 已建立 execution record 和提交入口，本故事必须直接复用其 execution identity。
- Story 2.5 / 2.6 的 Redis 与 worker 基线可能为事件流协调提供支撑，但对浏览器应保持透明。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2: 流式反馈执行进度、稳定事件协议与阶段结果]
- [Source: _bmad-output/planning-artifacts/architecture.md#应用通信与执行模型]
- [Source: _bmad-output/planning-artifacts/prd.md#非功能需求]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-5-2-execution-stream.test.mjs`
- `node --test --test-concurrency=1 tests/story-3-5-analysis-plan.test.mjs tests/story-5-1-analysis-execution.test.mjs tests/story-5-2-execution-stream.test.mjs tests/story-2-6-worker-skeleton.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 建立了 Redis-backed execution event log、稳定 execution event envelope 和 render block schema。
- 新增 `/api/analysis/sessions/[sessionId]/stream` SSE route，支持按 executionId 回放并持续推送事件。
- worker 现在会发布 `pending / processing / stage-result / completed / failed` 等执行事件，会话页新增流式分析画布并支持首屏回放。
- 补充了 story-5-2 集成测试，验证 SSE 合约、非纯文本阶段结果块和页面回放渲染。

### File List

- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/5-2-stream-execution-progress-and-stage-results.md
- src/domain/analysis-execution/stream-models.ts
- src/application/analysis-execution/stream-ports.ts
- src/application/analysis-execution/stream-use-cases.ts
- src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts
- src/infrastructure/job/runtime.ts
- src/application/analysis-execution/submission-use-cases.ts
- src/app/api/analysis/sessions/[sessionId]/execute/route.ts
- src/worker/handlers.ts
- src/worker/main.ts
- src/app/api/analysis/sessions/[sessionId]/stream/route.ts
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- tests/story-5-2-execution-stream.test.mjs
