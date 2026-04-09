# Story 6.2: 补充因素或缩小分析范围

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在会话中补充新的候选因素或缩小分析范围,
so that 系统可以围绕我最新关心的方向继续分析。

## Acceptance Criteria

1. 当当前会话已有既定分析上下文时，用户补充新的因素、限定项目范围或追加比较条件后，系统必须将这些输入并入当前轮次上下文。
2. 界面必须清楚展示哪些条件是后续新增的。
3. 当补充条件与现有条件冲突时，系统必须提示冲突并要求确认，不能静默覆盖重要范围条件。

## Tasks / Subtasks

- [x] 建立上下文增量合并与冲突检测（AC: 1, 2, 3）
  - [x] 明确“新增条件”“继承条件”“冲突条件”的结构。
  - [x] 复用已有 context normalization / validation，而不是新建平行规则。
- [x] 接入会话内增量修改体验（AC: 1, 2, 3）
  - [x] 服务端保存增量输入并生成新的当前轮次上下文。
  - [x] 界面展示哪些条件是新增项。
- [x] 覆盖冲突与确认测试（AC: 1, 2, 3）
  - [x] 验证冲突条件不会被静默覆盖。
  - [x] 验证确认后才进入后续分析。

### Review Findings

- [x] [Review][Patch] 6.2 写入的 merged context 不会成为下一次 follow-up 的继承基线，新追问仍然从 session 基础上下文起步，导致“补充因素/缩小范围”无法跨轮延续 [src/app/api/analysis/sessions/[sessionId]/follow-ups/route.ts:64]
- [x] [Review][Patch] 界面上的“默认沿用上下文 / 当前承接结论”读取的是 session 当前状态而不是 active follow-up 已持久化状态，用户重新打开会话后会看到与本轮真实继承条件不一致的展示 [src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx:235]

## Dev Notes

- 这是 follow-up 轮次内的增量上下文更新，不应回到“重写整份上下文 blob”的粗粒度实现。
- Story 3.3 的修正 / 撤销模型最好直接复用到这里。
- 冲突提示属于业务要求，不是纯 UI 提示。

### Architecture Compliance

- 上下文整合在服务端完成，不能让客户端自由拼装后直写数据库。
- 仍需遵守 owner / scope 边界。
- 新增条件展示应建立在服务端确认后的 read model 上。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-context/`
  - `src/application/follow-up/` 或 `src/application/analysis-context/`
  - context edit route
  - 会话差异展示组件

### Testing Requirements

- 至少覆盖：
  - 增量条件并入当前轮次
  - 新增条件可辨识展示
  - 冲突检测与确认
  - owner 越权失败

### Previous Story Intelligence

- Story 6.1 已建立 follow-up / iteration 基础。
- Story 3.3 的上下文修正与版本管理应成为本故事的直接复用点。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.2: 补充因素或缩小分析范围]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/project-context.md#关键实现规则]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-6-2-add-factors-or-narrow-scope.test.mjs`
- `npm run lint`
- `npm run build`
- `node --test --test-concurrency=1 tests/story-3-3-context-correction.test.mjs tests/story-6-1-follow-up-on-existing-conclusion.test.mjs tests/story-6-2-add-factors-or-narrow-scope.test.mjs`

### Completion Notes List

- 追问轮次现在支持结构化增量条件输入，服务端会把新增因素、比较条件和范围限制并入当前 follow-up 上下文。
- 新增条件与覆盖条件通过 follow-up read model 明确展示，界面可辨识后续新增项。
- 冲突条件在服务端先被拦截并回显，只有用户显式确认后才会更新当前轮次上下文。

### File List

- _bmad-output/implementation-artifacts/6-2-add-factors-or-narrow-scope.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-follow-up-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/app/api/analysis/sessions/[sessionId]/follow-ups/[followUpId]/context/route.ts
- src/application/follow-up/ports.ts
- src/application/follow-up/use-cases.ts
- src/domain/analysis-session/follow-up-models.ts
- src/infrastructure/analysis-session/postgres-analysis-session-follow-up-store.ts
- tests/story-6-2-add-factors-or-narrow-scope.test.mjs
