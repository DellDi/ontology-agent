# Story 10.7: Epic 10 Alignment Sweep

Status: backlog

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台前端团队,
I want 在 `Story 10.1 / 10.2 / 10.3 / 10.4 / 10.5` 全部落地后做一次对齐清扫,
so that `Story 10.6` 已提前落地的交互主链（侧滑流程看板、自动执行闸门、assumption 投影）在 runtime 抽象上线后仍然满足 AC1~AC5，且 `reasoning-summary` / `assumption-card` / `process-board` 三个 UX part 已经通过正式 renderer-registry 消费。

## Acceptance Criteria

1. 当 `10.1 / 10.2 / 10.3 / 10.4 / 10.5` 全部合入后回归 `Story 10.6` 的 Review Findings（P1~P12 + D1~D5）时，所有 findings 必须已映射到对应的 runtime / renderer 正式实现，不再有"临时实现 / 等待 10.x 落地"标签。
2. 当执行 `tests/story-10-6-grounded-planning.test.mts` 与新增的 `tests/story-10-1-*` / `tests/story-10-2-*` 时，全部通过，并且关键 UI 行为（默认收起 side sheet、Esc 关闭、自动执行 sessionStorage-scope 去重、assumption 在 ConclusionPanel 的 amber 投影）由 story-based integration test 覆盖。
3. 当 Alignment Sweep 结束时，`deferred-work.md` 中 Story 10.6 review 遗留的 W1（`parseProgressText`）必须已在 `Story 10.2 renderer-registry` 内正式收口；W2（`AnalysisPlan._executionAssumptions` 下划线约定）必须作出明确决策并已落地——二选一：
   - 去下划线改为正式 domain 字段；或
   - 将"下划线 = 运行时只读标注"写入 domain 规范。
4. 当本 story 结束时，`_bmad-output/implementation-artifacts/deferred-work.md` 中与 Story 7.4 / 10.6 相关的 defer 项已清零或转为其他 story 的明确归属，不再有悬挂条目。

## Tasks / Subtasks

- [ ] 回归 Story 10.6 Review Findings 映射（AC: 1）
  - [ ] 对照 `10-6 spec` 中 P1~P12 / D1~D5 逐项确认是否已在 10.1/10.2/10.3/10.4/10.5 落地
  - [ ] 为每项 finding 打对应 story 标签，更新 `10-6 spec` 的 Review Patches 段
- [ ] 端到端回归测试（AC: 2）
  - [ ] 新增 integration test 覆盖 side sheet 默认收起 / Esc 关闭 / hydration 恢复
  - [ ] 新增 integration test 覆盖 auto-execute gate 的 sessionStorage-scope 去重
  - [ ] 新增 integration test 覆盖 ConclusionPanel 的 assumption 投影
- [ ] 收口 deferred-work 项（AC: 3, 4）
  - [ ] 在 10.2 renderer-registry 内正式实现 `process-board` / `reasoning-summary` / `assumption-card` 三个 part
  - [ ] 对 W2 做 domain 层决策，更新 architecture.md 或相关 model 文件
  - [ ] 清理 deferred-work.md 悬挂条目

## Dev Notes

- 本 story 是收口型工作，不引入新功能，只做回归 + 对齐 + 文档清理。
- 启动前置条件：10.1 / 10.2 / 10.3 / 10.4 / 10.5 全部 done。
- 若过程中发现 10.1~10.5 任一存在偏离 10.6 既有行为的改动，应以 10.6 Review Findings 为准回传修正，而不是把"行为偏离"默认为新行为。

### Architecture Compliance

- 严格遵循 `AGENTS.md` 的 Root-Cause First Policy：发现偏离时先定位根因，不临时兼容。
- 禁止在 10.7 内新增独立的 fallback / 兼容层；如需兼容，应回归到对应 story 内部。

### File Structure Requirements

- 预期改动文件：
  - `tests/story-10-6-grounded-planning.test.mts`（新增 integration 测试）
  - 新增 `tests/story-10-7-alignment-sweep.test.mts`
  - 更新 `_bmad-output/implementation-artifacts/10-6-collapsible-execution-process-board-and-expert-mode.md` 的 Review Patches 段
  - 更新 `_bmad-output/implementation-artifacts/deferred-work.md`

### Testing Requirements

- Story 10.6 既有 12 个单测全部保留，全绿
- 新增 integration 测试覆盖 4 项关键 UI 行为
- W1 / W2 决策落地后，domain / renderer 层有对应单测

### Previous Story Intelligence

- `10.6` 在 2026-04-17 提前完成，已通过双层 code review（Wave 1 + Wave 2），但依赖的运行时抽象 10.1/10.2 尚未建立
- `10.6 review` 产生 12 项 patch + 5 项 decision + 2 项 deferred（W1 / W2），全部需要在本 story 内收口
- `7.4 review` 产生 3 项 deferred（D4 / P6 / HMR），其中 D4 与 10.7 关联（renderer 归属），应在本 story 一并清溅

### References

- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-04-17-b.md]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 10.7: Epic 10 Alignment Sweep]
- [Source: _bmad-output/implementation-artifacts/10-6-collapsible-execution-process-board-and-expert-mode.md]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md]

## Dev Agent Record

### Agent Model Used

_Pending._

### Debug Log References

_Pending during implementation._

### Completion Notes List

- _Pending._

### File List

- _Pending._
