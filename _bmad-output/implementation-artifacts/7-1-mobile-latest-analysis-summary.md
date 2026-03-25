# Story 7.1: 移动端查看最近分析摘要

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 移动端业务负责人,
I want 在手机上查看最近一次分析的结论摘要和当前状态,
so that 我可以在不打开 PC 工作台的情况下快速了解分析结果。

## Acceptance Criteria

1. 当用户已有可访问的分析会话结果时，在移动端打开最近一次分析时必须展示结论摘要、分析状态和最近更新时间。
2. 移动端不要求进入完整计划编辑界面。
3. 当用户仅有部分项目或区域权限时，移动端只应展示其有权查看的会话结果，并且能力边界必须明显区别于 PC 完整工作台。

## Tasks / Subtasks

- [ ] 建立移动端最近分析 read model（AC: 1, 2, 3）
  - [ ] 定义“最近一次分析”的服务端判定规则。
  - [ ] 输出适合移动端的摘要、状态和更新时间字段。
- [ ] 新增移动端只读入口（AC: 1, 2, 3）
  - [ ] 新建移动端 route 或 route group，不直接复用 PC 编辑页做响应式缩小。
  - [ ] 保持能力边界只读化。
- [ ] 覆盖权限与能力边界测试（AC: 1, 2, 3）
  - [ ] 验证仅显示本人且在 scope 内的最近会话。
  - [ ] 验证 PC 复杂编辑控件不出现在移动端。

## Dev Notes

- 这是移动端 read model，不是把 PC 工作台页面压缩成窄屏。
- “最近一次分析”建议基于当前用户可见范围内的最近更新时间，而不是全局最近。
- 移动端摘要字段应来自稳定持久化结果，而不是页面临时拼装。

### Architecture Compliance

- 移动端入口仍走服务端会话与 scope 校验。
- read model 应由服务端组装，并对敏感字段做最小化输出。
- 能力边界必须符合 NFR11，不把 PC 完整工作台搬到手机上。

### File Structure Requirements

- 重点文件预计包括：
  - 新增移动端 route group
  - `src/application/mobile/` 或等价 read model 组装层
  - `src/application/analysis-session/use-cases.ts`

### Testing Requirements

- 至少覆盖：
  - 最近分析摘要展示
  - 状态和更新时间可见
  - 仅返回有权查看的会话
  - 不出现 PC 编辑控件

### Previous Story Intelligence

- 4.4 和 5.4 的结果与历史持久化是移动端摘要的主要数据基础。
- 6.1 的服务端权限校验是移动端能力安全上线前置。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.1: 移动端查看最近分析摘要]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#安全与权限边界]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/7-1-mobile-latest-analysis-summary.md
