# Story 7.3: 移动端发起轻量追问

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 移动端业务负责人,
I want 在查看结果后提交一条简短追问或下钻指令,
so that 我可以推动既有分析继续深入而不需要重建会话。

## Acceptance Criteria

1. 当用户在移动端查看已有分析会话并提交简短追问或下钻指令时，系统必须将输入并入原有会话上下文。
2. 不能创建脱离原分析记录的新会话。
3. 当追问超出移动端轻量能力边界时，系统必须提示该类操作需要在 PC 工作台完成，同时仍允许用户提交适合移动端的简短追问。

## Tasks / Subtasks

- [ ] 建立移动端轻量追问边界（AC: 1, 2, 3）
  - [ ] 复用现有 follow-up / iteration 模型。
  - [ ] 定义哪些输入属于轻量追问，哪些必须引导到 PC。
- [ ] 新增移动端追问提交入口（AC: 1, 2, 3）
  - [ ] 将追问附着到原 session，而不是新建 session。
  - [ ] 保持服务端身份与权限校验。
- [ ] 覆盖边界与权限测试（AC: 1, 2, 3）
  - [ ] 验证轻量追问写回原会话。
  - [ ] 验证复杂编辑类请求被引导到 PC。

## Dev Notes

- 移动端追问必须建立在既有会话内多轮模型之上，不应重造一套会话体系。
- 若后续执行通过 worker / SSE 返回状态，这里应复用同一分析链路，而不是单独起新协议。
- 能力边界要明确，否则移动端会快速滑向“弱化版 PC 工作台”。

### Architecture Compliance

- 继续使用服务端会话、权限和 scope 边界。
- 追问写入与能力判断位于服务端 application 层。
- 移动端只增加轻量输入，不承担复杂计划编辑与编排。

### File Structure Requirements

- 重点文件预计包括：
  - 移动端结果页轻量追问组件
  - follow-up route 或轻量提交入口
  - `src/application/follow-up/`
  - 视需要扩展 analysis session / iteration schema

### Testing Requirements

- 至少覆盖：
  - 轻量追问附着到原会话
  - 不创建新 session
  - 复杂编辑类输入被引导到 PC
  - 权限与 scope 校验生效

### Previous Story Intelligence

- Story 5.1 已建立基于既有结论发起追问的会话内模型。
- Story 7.1 / 7.2 已建立移动端只读摘要与证据视图；7.3 在其上增加轻量写入口。
- Story 6.1 的服务端权限校验必须先覆盖移动端入口，避免新旁路。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.3: 移动端发起轻量追问]
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

- _bmad-output/implementation-artifacts/7-3-mobile-lightweight-follow-up.md
