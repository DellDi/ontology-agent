# Story 5.4: 保存步骤结果与最终结论

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在分析完成后保留计划、主要步骤结果和最终结论,
so that 我之后可以回看、复盘并继续追问。

## Acceptance Criteria

1. 当分析执行完成或中断后，用户稍后重新打开会话时，系统必须恢复已保存的计划骨架、主要步骤结果和当前结论状态。
2. 用户无需重新执行即可查看上一次主要结果。
3. 当分析未能形成最终结论时，系统仍必须保留已完成步骤和失败位置，为继续执行或复盘提供上下文。

## Tasks / Subtasks

- [ ] 建立 execution / result persistence 模型（AC: 1, 2, 3）
  - [ ] 为计划快照、步骤结果、当前结论状态和失败位置建立可持久化结构。
  - [ ] 区分“执行中断”“部分完成”“最终完成”。
- [ ] 接入读取与回放路径（AC: 1, 2, 3）
  - [ ] 重新打开会话时从持久化层恢复主要结果。
  - [ ] 保持 owner-only 读取与会话关联。
- [ ] 覆盖回放与失败态测试（AC: 1, 2, 3）
  - [ ] 验证成功执行后的回放。
  - [ ] 验证失败或中断后保留步骤结果和失败位置。

## Dev Notes

- 持久化的是“计划、步骤结果、结论状态”，不是替换原始问题与上下文。
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

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/5-4-persist-step-results-and-final-conclusion.md
