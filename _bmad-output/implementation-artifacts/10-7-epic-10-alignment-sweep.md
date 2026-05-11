# Story 10.7: Epic 10 Alignment Sweep

Status: done

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

- [x] 回归 Story 10.6 Review Findings 映射（AC: 1）
  - [x] 对照 `10-6 spec` 中 P1~P12 / D1~D5 / W1 / W2 逐项确认 10.1 / 10.2 / 10.6 当前实现映射
  - [x] 回写 `10-6 spec` 的 review / deferred 结果，标注 10.7 收口结论
- [x] 回归测试与交互契约收口（AC: 2, 3）
  - [x] 新增 `tests/story-10-7-alignment-sweep.test.mts`，覆盖正式 interaction parts、runtime annotation 决策、client helper 行为
  - [x] 扩展 `tests/story-10-2-renderer-registry.test.mjs`，把 `阶段说明` 提升为 `reasoning-summary` 并验证 registry 正式注册
  - [x] 回归 `tests/story-10-6-grounded-planning.test.mts` 与 Story 10.1 / 10.2 相关测试，确保 10.6 主链语义未回退
- [x] 收口 deferred-work 项（AC: 3, 4）
  - [x] 在 10.2 renderer-registry 内正式实现 `process-board` / `reasoning-summary` / `assumption-card` 三个 part
  - [x] 对 W2 做 domain 层决策：保留下划线约定，并写入 `architecture.md` 与 `ANALYSIS_PLAN_RUNTIME_ANNOTATION_FIELDS`
  - [x] 清理 `deferred-work.md` 中与 Story 7.4 D4 / Story 10.6 W1/W2 相关的悬挂条目

### Review Findings (code review 2026-05-12)

- [x] [Review][Patch] `process-board` 作为 workspace-only part，`renderer-registry.project()` 必须对 mobile 投影 fail loud，而不是静默投影到不受支持的 surface。已修复：`process-board` descriptor 收紧为 `workspace`，并在 `project()` 层新增 surface guard。 [src/application/analysis-interaction/renderer-registry.ts:97]

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

GPT-5 Codex

### Debug Log References

- 2026-05-12: 审计 Story 10.6 review findings 与 Story 10.1 / 10.2 / 10.6 当前实现，确认缺口集中在 `process-board` / `reasoning-summary` / `assumption-card` 正式化、`parseProgressText`、`_executionAssumptions` 约定。
- 2026-05-12: 新增 `tests/story-10-7-alignment-sweep.test.mts`，并扩展 `tests/story-10-2-renderer-registry.test.mjs`，先红后绿完成 alignment sweep 回归。
- 2026-05-12: 将 `AnalysisExecutionStreamPanel` 的进度展示改为消费 `buildProcessBoardPart()`，移除 `parseProgressText()` 和页面内手写进度聚合。
- 2026-05-12: 将 `AnalysisPlanPanel` / `AnalysisConclusionPanel` 的 assumptions 投影统一改为 `buildAssumptionCardPart()` + `AnalysisInteractionRenderedBlock`。
- 2026-05-12: 在 client 组件侧提炼 `buildProcessBoardStorageKey()` / `shouldCloseProcessBoardOnKeydown()` / `resolveAnalysisAutoExecuteAttempt()` / `submitAnalysisAutoExecuteForm()` 纯 helper，避免 10.7 回归继续依赖 brittle source-regex。
- 2026-05-12: Code review 追加发现并修复 `renderer-registry.project()` 对 `process-board` 的 unsupported-surface 漏检，避免 desktop-only part 被误投影到 mobile。
- 2026-05-12: 验证通过：
  - `NODE_OPTIONS=--conditions=react-server node --test --test-concurrency=1 tests/story-10-1-ai-application-runtime-layer.test.mjs tests/story-10-1-p1-foundation-parts-stable-id-strategy.test.mjs tests/story-10-1-p2-slot-lane-placement.test.mjs tests/story-10-1-p3-schema-version.test.mjs tests/story-10-2-renderer-registry.test.mjs`
  - `NODE_OPTIONS=--conditions=react-server node --import tsx --test --test-concurrency=1 tests/story-10-6-grounded-planning.test.mts tests/story-10-7-alignment-sweep.test.mts`
  - `pnpm lint`
  - `pnpm build`

### Completion Notes List

- `reasoning-summary`、`process-board`、`assumption-card` 已从 10.6 临时 UI 语义升级为正式 interaction parts，并进入默认 renderer-registry。
- 流程看板进度不再依赖 `"N/M"` 字符串解析，而是改为 execution event metadata 中的 structured `processBoardProgress`。
- `AnalysisPlanPanel` 与 `AnalysisConclusionPanel` 已统一消费 assumption-card，空 assumptions 明确 fail loud。
- `_executionAssumptions` 已纳入正式 runtime annotation 约定，domain 与 architecture 两侧一致。
- `deferred-work.md` 中与 Story 7.4 D4、Story 10.6 W1/W2 相关的悬挂项已清理完毕。
- code review 额外收紧了 `renderer-registry.project()` 的 surface guard，desktop-only `process-board` 不再能被误投影到 mobile。
- 当前自动化验证以 story regression + pure helper contract 为主，尚未额外引入浏览器级 UI harness。

### File List

- _bmad-output/implementation-artifacts/10-6-collapsible-execution-process-board-and-expert-mode.md
- _bmad-output/implementation-artifacts/10-7-epic-10-alignment-sweep.md
- _bmad-output/implementation-artifacts/deferred-work.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/planning-artifacts/architecture.md
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-auto-execute-gate.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conclusion-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-interaction-ui-renderer-registry.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-plan-panel.tsx
- src/application/analysis-execution/stream-use-cases.ts
- src/application/analysis-interaction/interaction-part-schema.ts
- src/application/analysis-interaction/renderer-registry.ts
- src/domain/analysis-plan/models.ts
- src/worker/analysis-execution-renderer.ts
- tests/story-10-2-renderer-registry.test.mjs
- tests/story-10-7-alignment-sweep.test.mts

### Change Log

- 2026-05-12: 完成 Story 10.7 alignment sweep，实现正式 renderer/domain 收口、清理 deferred-work，并将 story 状态推进到 review。
- 2026-05-12: 完成 code review patch，补齐 `renderer-registry.project()` 的 unsupported-surface fail-loud guard，并将 story 状态推进到 done。
