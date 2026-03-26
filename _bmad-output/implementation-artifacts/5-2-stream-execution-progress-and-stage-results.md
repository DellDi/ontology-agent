# Story 5.2: 流式反馈执行进度与阶段结果

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在分析执行期间持续看到当前步骤和阶段结果,
so that 我不需要等到任务全部结束才知道系统正在做什么。

## Acceptance Criteria

1. 分析任务执行期间，任一步骤进入运行、完成或失败状态时，系统必须向会话界面推送最新执行状态。
2. 用户可见状态更新间隔不得超过 5 秒。
3. 当分析执行超过 10 秒时，系统必须持续展示步骤级进度或阶段性发现，不能长时间无反馈。

## Tasks / Subtasks

- [ ] 建立 SSE 或等价服务端推流入口（AC: 1, 2, 3）
  - [ ] 为 execution 建立稳定事件流模型。
  - [ ] 客户端只负责订阅和渲染，不直接订阅 Redis。
- [ ] 接入执行状态与阶段结果发布（AC: 1, 2, 3）
  - [ ] 覆盖 running / completed / failed 等状态。
  - [ ] 为超过 10 秒的执行提供持续反馈。
- [ ] 覆盖 SSE 合约与页面订阅测试（AC: 1, 2, 3）
  - [ ] 验证事件序列稳定。
  - [ ] 验证页面不会长时间无反馈。

## Dev Notes

- 本故事重点是“服务端推流 + 稳定事件语义”，不是最终归因内容。
- 若 Redis 参与状态协调，浏览器仍不能直接接入 Redis。
- 设计事件结构时要为 5.3 结论输出和 5.4 结果持久化保留阶段性结果字段。

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

### Previous Story Intelligence

- Story 5.1 已建立 execution record 和提交入口，本故事必须直接复用其 execution identity。
- Story 2.5 / 2.6 的 Redis 与 worker 基线可能为事件流协调提供支撑，但对浏览器应保持透明。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2: 流式反馈执行进度与阶段结果]
- [Source: _bmad-output/planning-artifacts/architecture.md#应用通信与执行模型]
- [Source: _bmad-output/planning-artifacts/prd.md#非功能需求]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/5-2-stream-execution-progress-and-stage-results.md
