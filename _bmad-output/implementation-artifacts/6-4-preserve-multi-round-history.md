# Story 6.4: 保留多轮循环历史与结论演化

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 查看不同轮次的计划、结果和结论变化,
so that 我可以理解这次分析是如何逐步收敛到最终原因的。

## Acceptance Criteria

1. 当一个分析会话经历两轮及以上分析循环时，系统必须按轮次展示每轮输入、计划和主要结论。
2. 用户必须能够区分最新结论与历史结论。
3. 当用户切换到历史轮次时，系统必须展示该轮关键证据和计划摘要，且新一轮生成不能覆盖历史记录。

## Tasks / Subtasks

- [x] 建立多轮历史与快照模型（AC: 1, 2, 3）
  - [x] 为每轮输入、计划、结论和证据摘要建立快照结构。
  - [x] 明确最新轮次与历史轮次的只读边界。
- [x] 接入历史查看与切换（AC: 1, 2, 3）
  - [x] 在会话详情中展示轮次列表与当前轮摘要。
  - [x] 切换历史轮次时读取对应快照。
- [x] 覆盖历史回放测试（AC: 1, 2, 3）
  - [x] 验证两轮以上历史保留。
  - [x] 验证切换历史轮次不被新结果覆盖。

## Dev Notes

- 不要把多轮历史压成一个巨大 session blob。
- 历史轮次应天然只读，新的追问生成新轮次，而不是改写旧轮次。
- 这一步是后续移动端“查看最近分析摘要”的重要数据基础。

### Architecture Compliance

- 历史与结论演化通过服务端 read model 组装。
- 快照仍需遵守 owner / scope 过滤。
- 新一轮写入不得覆盖旧轮次事实。

### File Structure Requirements

- 重点文件预计包括：
  - history / iteration read model 模块
  - analysis detail page 历史切换区域
  - 视需要新增 Postgres snapshots / history tables

### Testing Requirements

- 至少覆盖：
  - 两轮以上历史存在
  - 最新 / 历史结论可区分
  - 切换到历史轮次显示对应计划与证据
  - 新一轮不会覆盖旧轮次

### Previous Story Intelligence

- 5.1 到 5.3 已建立 follow-up、增量上下文和重规划模型，本故事负责把这些轮次稳定保留下来。
- 5.4 的结果持久化是多轮历史回放的前置。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.4: 保留多轮循环历史与结论演化]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm run build`
- `npm run lint`
- `node --test --test-concurrency=1 tests/story-5-4-persist-results.test.mjs`
- `node --test --test-concurrency=1 tests/story-6-1-follow-up-on-existing-conclusion.test.mjs`
- `node --test --test-concurrency=1 tests/story-6-2-add-factors-or-narrow-scope.test.mjs`
- `node --test --test-concurrency=1 tests/story-6-3-replan-after-user-correction.test.mjs`
- `node --test --test-concurrency=1 tests/story-6-4-preserve-multi-round-history.test.mjs`

### Completion Notes List

- 为 follow-up 和 execution snapshot 建立显式轮次关联：`parentFollowUpId`、`resultExecutionId`、`followUpId`。
- 新增服务端历史 read model 与页面历史面板，支持区分最新轮次与历史轮次，并按轮查看输入、计划、结论和关键证据。
- worker 在保存 follow-up execution snapshot 后会回写 `resultExecutionId`，避免提交路由回写失败时历史链断开。
- 历史回放测试覆盖了两轮以上历史保留、历史切换展示，以及新轮次不会覆盖旧轮次事实。

### File List

- drizzle/0011_follow_up_history_links.sql
- drizzle/meta/_journal.json
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/app/api/analysis/sessions/[sessionId]/execute/route.ts
- src/app/api/analysis/sessions/[sessionId]/follow-ups/route.ts
- src/application/analysis-history/use-cases.ts
- src/application/analysis-execution/persistence-ports.ts
- src/application/analysis-execution/persistence-use-cases.ts
- src/application/analysis-execution/submission-use-cases.ts
- src/application/follow-up/ports.ts
- src/application/follow-up/use-cases.ts
- src/domain/analysis-execution/models.ts
- src/domain/analysis-execution/persistence-models.ts
- src/domain/analysis-session/follow-up-models.ts
- src/domain/job-contract/models.ts
- src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store.ts
- src/infrastructure/analysis-session/postgres-analysis-session-follow-up-store.ts
- src/infrastructure/job/redis-job-queue.ts
- src/infrastructure/postgres/schema/analysis-execution-snapshots.ts
- src/infrastructure/postgres/schema/analysis-session-follow-ups.ts
- src/worker/finalize-analysis-execution.ts
- src/worker/main.ts
- tests/helpers/ensure-follow-up-history-columns.mjs
- tests/story-5-4-persist-results.test.mjs
- tests/story-6-4-preserve-multi-round-history.test.mjs
- _bmad-output/implementation-artifacts/6-4-preserve-multi-round-history.md

### Change Log

- 新增 6.4 多轮历史 read model、历史面板、数据库关联字段与回归测试。
