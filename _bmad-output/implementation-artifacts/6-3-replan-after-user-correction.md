# Story 6.3: 根据纠正结果重生成分析计划

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在发现分析方向偏差后重生成后续计划,
so that 系统的下一轮执行能真正反映我纠正后的分析思路。

## Acceptance Criteria

1. 当用户已纠正目标指标、范围或候选因素后，系统重新规划时必须基于更新后的上下文生成新计划。
2. 新计划必须明确标识与上一轮计划相比发生的变化。
3. 当上一轮已有部分结果可复用时，系统可以复用仍然有效的结果，但不能要求整条链路无条件从零开始。

## Tasks / Subtasks

- [x] 建立计划版本与差异模型（AC: 1, 2, 3）
  - [x] 为计划 identity、version、diff 建立稳定结构。
  - [x] 区分复用步骤、失效步骤和新增步骤。
- [x] 接入重规划流程（AC: 1, 2, 3）
  - [x] 基于当前确认上下文生成新计划。
  - [x] 在界面上展示与上一轮的变化。
- [x] 覆盖重规划与复用测试（AC: 1, 2, 3）
  - [x] 验证上下文变化触发新版本计划。
  - [x] 验证有效结果被保守复用。

### Review Findings

- [x] [Review][Patch] 重规划结果没有接入真实执行入口，页面执行按钮和 `/execute` route 仍然只基于 session 级 context 重新生成计划，6.3 的新计划不会成为下一轮执行输入 [src/app/api/analysis/sessions/[sessionId]/execute/route.ts:49]
- [x] [Review][Patch] 同一个 follow-up 第二次重规划时会丢失原 execution 的可复用完成步骤，因为 route 在已有 `currentPlanSnapshot` 后不再读取 base snapshot，`reusableCompletedStepIds` 退化为空 [src/app/api/analysis/sessions/[sessionId]/follow-ups/[followUpId]/replan/route.ts:71]
- [x] [Review][Patch] follow-up 已经重规划后，如果用户继续修改范围或候选因素，持久化层不会清空旧的 `currentPlanSnapshot/currentPlanDiff`，页面和 `/execute` 仍会把过期计划当成当前计划继续展示和执行 [src/application/follow-up/use-cases.ts:225]

## Dev Notes

- 重规划不是简单“覆盖旧计划”，而是生成可追溯的新计划版本。
- 复用逻辑要谨慎，不能因为实现简化把所有旧结果都当可复用。
- 6.4 的历史演化展示会直接消费这里的 plan version / diff。

### Architecture Compliance

- 计划版本化与差异计算应位于 application / domain 层。
- 不得在页面内临时计算 diff 作为唯一事实。
- 必须继续通过服务端校验 owner / scope。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-plan/`
  - `src/application/analysis-planning/`
  - execution planner 或 plan diff 逻辑
  - 会话计划差异展示组件

### Testing Requirements

- 至少覆盖：
  - 上下文变更触发新计划版本
  - 差异字段可读
  - 有效步骤复用 / 无效步骤失效
  - owner-only 访问

### Previous Story Intelligence

- Story 3.5 首次定义 plan model，本故事是在其之上引入 version / diff。
- Story 6.2 的增量上下文与冲突确认结果会直接影响重规划输入。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.3: 根据纠正结果重生成分析计划]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#应用通信与执行模型]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-6-3-replan-after-user-correction.test.mjs`
- `node --test --test-concurrency=1 tests/story-6-1-follow-up-on-existing-conclusion.test.mjs tests/story-6-2-add-factors-or-narrow-scope.test.mjs tests/story-6-3-replan-after-user-correction.test.mjs`
- `npm run lint`
- `npm run build`

### Completion Notes List

- 为 follow-up 引入正式的计划版本与差异结构，服务端持久化 `current/previous plan snapshot` 与 `plan diff`，避免页面临时推导成为唯一事实源。
- 新增 follow-up 重规划接口，基于纠正后的 merged context、候选因素扩展结果和上一轮 execution snapshot 生成新计划，并保守复用仍有效的已完成步骤。
- 会话页新增 follow-up 计划重生成功反馈、重规划入口，以及 `可复用步骤 / 失效步骤 / 新增步骤` 的差异展示。
- 增加 owner-only 与计划重算回归测试，验证上下文纠正会触发新版本计划，并且旧结果只在依赖链仍有效时复用。

### File List

- _bmad-output/implementation-artifacts/6-3-replan-after-user-correction.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- drizzle/0009_follow_up_plan_versions.sql
- drizzle/meta/_journal.json
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-follow-up-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/app/api/analysis/sessions/[sessionId]/follow-ups/[followUpId]/replan/route.ts
- src/application/analysis-planning/use-cases.ts
- src/application/follow-up/ports.ts
- src/application/follow-up/use-cases.ts
- src/domain/analysis-plan/models.ts
- src/domain/analysis-session/follow-up-models.ts
- src/infrastructure/analysis-session/postgres-analysis-session-follow-up-store.ts
- src/infrastructure/postgres/schema/analysis-session-follow-ups.ts
- tests/story-6-3-replan-after-user-correction.test.mjs
