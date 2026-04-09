# Story 5.4: 保存步骤结果与最终结论

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在分析完成后保留计划、主要步骤结果和最终结论,
so that 我之后可以回看、复盘并继续追问。

## Acceptance Criteria

1. 当分析执行完成或中断后，用户稍后重新打开会话时，系统必须恢复已保存的计划骨架、主要步骤结果和当前结论状态。
2. 用户无需重新执行即可查看上一次主要结果。
3. 当分析未能形成最终结论时，系统仍必须保留已完成步骤和失败位置，为继续执行或复盘提供上下文。
4. 持久化结果必须包含步骤结果、最终结论块和最小投影字段，不能只保留纯文本摘要。

## Tasks / Subtasks

- [x] 建立 execution / result persistence 模型（AC: 1, 2, 3, 4）
  - [x] 为计划快照、步骤结果、当前结论状态和失败位置建立可持久化结构。
  - [x] 区分“执行中断”“部分完成”“最终完成”。
  - [x] 为 render blocks 和 mobile projection 预留稳定字段边界。
- [x] 接入读取与回放路径（AC: 1, 2, 3, 4）
  - [x] 重新打开会话时从持久化层恢复主要结果。
  - [x] 保持 owner-only 读取与会话关联。
  - [x] 为 PC 全量回放和移动端摘要读取提供同源 read model 基础。
- [x] 覆盖回放与失败态测试（AC: 1, 2, 3）
  - [x] 验证成功执行后的回放。
  - [x] 验证失败或中断后保留步骤结果和失败位置。

## Dev Notes

- 持久化的是“计划、步骤结果、结论状态和结果块”，不是替换原始问题与上下文。
- 设计时要考虑后续 5.x 多轮历史演化和 7.x 移动端只读摘要复用。
- SSE 中间态不能成为唯一事实源，最终必须落到持久化存储。

### Architecture Compliance

- 持久化应落在平台自有 Postgres schema 内，与 analysis session owner 关联保持清晰。
- 读取与回放继续通过服务端应用层，不允许客户端自行拼装历史。
- 失败结果同样属于重要历史，不得静默丢弃。

### File Structure Requirements

- 重点文件预计包括：
  - `src/infrastructure/postgres/schema/` 下新增 execution / result tables
  - `src/application/analysis-execution/`
  - `src/application/analysis-results/`
  - analysis detail page read path
  - 新增对应 migration

### Testing Requirements

- 至少覆盖：
  - 重新打开会话后恢复计划与结论
  - 无需重新执行即可查看主要结果
  - 失败位置与已完成步骤被保留
  - owner-only 读取
  - render block 持久化后可被移动端摘要投影消费

### Previous Story Intelligence

- Story 2.2 的 Drizzle / Postgres 基线为本故事提供迁移与 schema 约束。
- Story 5.1 到 5.3 已建立 execution identity、流式反馈和结论模型，本故事负责把它们变成可回放事实。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.4: 保存步骤结果与最终结论]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-5-4-persist-results.test.mjs`
- `node --test --test-concurrency=1 tests/story-5-1-analysis-execution.test.mjs tests/story-5-2-execution-stream.test.mjs tests/story-5-3-ranked-conclusions.test.mjs tests/story-5-4-persist-results.test.mjs tests/story-2-6-worker-skeleton.test.mjs tests/story-3-5-analysis-plan.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 新增 execution snapshot 持久化模型、Postgres schema 和 store，保存计划快照、步骤结果、当前结论状态、失败位置与移动端最小投影。
- 会话详情页重新打开时会优先从持久化快照恢复计划骨架、阶段结果和归因结论，不需要重新执行即可回看上次分析。
- 持久化结果块现在同时覆盖最终结论块和阶段结果 render blocks，失败态仍会保留失败位置与已完成步骤。
- 为 5.x 端到端测试补充快照表保障逻辑，确保测试环境与新迁移一致，并验证成功回放与失败态持久化。

### File List

- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/5-4-persist-step-results-and-final-conclusion.md
- drizzle/0005_analysis_execution_snapshots.sql
- drizzle/meta/_journal.json
- src/application/analysis-execution/persistence-ports.ts
- src/application/analysis-execution/persistence-use-cases.ts
- src/application/analysis-planning/use-cases.ts
- src/domain/analysis-execution/persistence-models.ts
- src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store.ts
- src/infrastructure/postgres/schema/analysis-execution-snapshots.ts
- src/infrastructure/postgres/schema/index.ts
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/worker/main.ts
- tests/helpers/ensure-analysis-execution-snapshots-table.mjs
- tests/story-5-1-analysis-execution.test.mjs
- tests/story-5-2-execution-stream.test.mjs
- tests/story-5-3-ranked-conclusions.test.mjs
- tests/story-5-4-persist-results.test.mjs
