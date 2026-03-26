# Story 6.3: 根据纠正结果重生成分析计划

Status: ready-for-dev

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

- [ ] 建立计划版本与差异模型（AC: 1, 2, 3）
  - [ ] 为计划 identity、version、diff 建立稳定结构。
  - [ ] 区分复用步骤、失效步骤和新增步骤。
- [ ] 接入重规划流程（AC: 1, 2, 3）
  - [ ] 基于当前确认上下文生成新计划。
  - [ ] 在界面上展示与上一轮的变化。
- [ ] 覆盖重规划与复用测试（AC: 1, 2, 3）
  - [ ] 验证上下文变化触发新版本计划。
  - [ ] 验证有效结果被保守复用。

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

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/6-3-replan-after-user-correction.md
