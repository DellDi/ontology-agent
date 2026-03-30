# Story 3.5: 生成并展示多步分析计划

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在执行前查看系统生成的多步分析计划,
so that 我可以理解系统接下来准备如何完成这次归因分析。

## Acceptance Criteria

1. 当系统为复杂问题生成分析计划时，用户必须看到由多个步骤组成的计划骨架。
2. 每个步骤至少包含目标说明和执行顺序。
3. 当计划依赖多个分析步骤时，界面必须清晰呈现步骤之间的先后关系或依赖关系，而不是黑盒式直跳最终结论。

## Tasks / Subtasks

- [x] 建立分析计划模型（AC: 1, 2, 3）
  - [x] 定义步骤、顺序、依赖关系和计划摘要字段。
  - [x] 区分计划骨架与执行结果，不在本故事引入后台执行。
- [x] 接入计划生成流程与展示（AC: 1, 2, 3）
  - [x] 基于 intent、上下文和候选因素生成多步计划或极简计划。
  - [x] 在分析页中展示可读的计划时间线或列表。
- [x] 覆盖计划生成与渲染测试（AC: 1, 2, 3）
  - [x] 验证复杂问题生成多步计划。
  - [x] 验证简单问题不被强行复杂化。
  - [x] 验证依赖关系展示清晰。

## Dev Notes

- 本故事生成的是 plan skeleton，不是执行结果。
- 计划模型需要为 Epic 4 的 execution / SSE / result persistence 预留稳定身份和顺序语义。
- 尽量保持计划生成 deterministic，便于后续满足 NFR8 的稳定性要求。

### Architecture Compliance

- 计划生成仍在服务端，浏览器只负责展示。
- 计划模型属于平台应用层能力，不应写死在页面组件或前端局部状态中。
- 本故事不得提前实现任务队列、worker 执行或结果存储。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-plan/`
  - `src/application/analysis-planning/`
  - 分析页计划展示组件
  - 视需要扩展 analysis session read model

### Testing Requirements

- 至少覆盖：
  - 多步计划生成
  - 步骤顺序与依赖关系
  - 简单问题生成极简计划
  - 分析页计划区域渲染

### Previous Story Intelligence

- 3.5 直接依赖 3.1 到 3.4 的 intent、context 和 candidate factors。
- 4.1 提交后台执行将以这里定义的计划结构为输入，因此字段命名与边界需要稳定。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.5: 生成并展示多步分析计划]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#应用通信与执行模型]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test tests/story-3-5-analysis-plan.test.mjs`
- `node --test --test-concurrency=1 tests/story-3-4-candidate-factors.test.mjs tests/story-3-5-analysis-plan.test.mjs`
- `node --test --test-concurrency=1 tests/*.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- 新增 deterministic 的 `analysis-plan` 领域模型与应用层 builder，稳定定义计划摘要、步骤顺序和依赖关系。
- 复杂归因问题现在会生成四步计划骨架，覆盖口径确认、指标校验、候选因素验证和归因判断汇总。
- 简单查询问题会降级为极简计划，只保留必要的查询口径确认与结果返回步骤，不再强行复杂化。
- 分析页新增计划面板，用户可以在执行前直接看到步骤顺序、每步目标和依赖步骤，不再是黑盒式过渡。
- 计划生成继续停留在服务端 read model 阶段，没有引入 worker、队列或执行结果持久化，保持与 Story 3.5 边界一致。
- 新增 Story 3.5 集成测试，覆盖复杂计划、极简计划和依赖关系展示。

### File List

- _bmad-output/implementation-artifacts/3-5-generate-and-display-analysis-plan.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-plan-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/application/analysis-planning/use-cases.ts
- src/domain/analysis-plan/models.ts
- src/infrastructure/analysis-planning/index.ts
- tests/story-3-5-analysis-plan.test.mjs

## Change Log

- 2026-03-27: 完成 Story 3.5，实现多步/极简分析计划生成、依赖关系展示与集成验证。
