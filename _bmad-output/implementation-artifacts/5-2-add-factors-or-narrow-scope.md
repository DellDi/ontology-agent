# Story 5.2: 补充因素或缩小分析范围

Status: ready-for-dev

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

- [ ] 建立上下文增量合并与冲突检测（AC: 1, 2, 3）
  - [ ] 明确“新增条件”“继承条件”“冲突条件”的结构。
  - [ ] 复用已有 context normalization / validation，而不是新建平行规则。
- [ ] 接入会话内增量修改体验（AC: 1, 2, 3）
  - [ ] 服务端保存增量输入并生成新的当前轮次上下文。
  - [ ] 界面展示哪些条件是新增项。
- [ ] 覆盖冲突与确认测试（AC: 1, 2, 3）
  - [ ] 验证冲突条件不会被静默覆盖。
  - [ ] 验证确认后才进入后续分析。

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

- Story 5.1 已建立 follow-up / iteration 基础。
- Story 3.3 的上下文修正与版本管理应成为本故事的直接复用点。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2: 补充因素或缩小分析范围]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/project-context.md#关键实现规则]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/5-2-add-factors-or-narrow-scope.md
