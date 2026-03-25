# Story 7.2: 移动端查看关键证据

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 移动端业务负责人,
I want 在手机上看到支持结论的关键证据摘要,
so that 我可以快速判断这次分析结论是否值得继续跟进。

## Acceptance Criteria

1. 当分析已经形成归因结论时，移动端结果详情必须展示关键证据摘要和主要原因排序。
2. 信息量必须适合移动端快速阅读。
3. 当用户尝试查看复杂计划细节时，系统必须限制为只读摘要视图，并明确提示完整分析请使用 PC 工作台。

## Tasks / Subtasks

- [ ] 建立移动端证据摘要 read model（AC: 1, 2, 3）
  - [ ] 输出主要原因排序和精简证据摘要。
  - [ ] 过滤复杂计划细节、调试信息和不适合移动端的信息量。
- [ ] 新增移动端结果详情页（AC: 1, 2, 3）
  - [ ] 作为移动端专用只读视图，不直接复用 PC 详情页结构。
  - [ ] 提供清晰的“去 PC 查看完整分析”引导。
- [ ] 覆盖移动端证据与只读限制测试（AC: 1, 2, 3）
  - [ ] 验证排序与证据摘要可见。
  - [ ] 验证复杂计划细节不会暴露。

## Dev Notes

- 这是移动端摘要化结果，不是把 PC 右侧证据面板原样搬过来。
- 若证据涉及跨项目 / 区域信息，返回前必须再次走 scope 过滤。
- 证据摘要模型最好复用 4.3 / 4.4 的结果持久化结构。

### Architecture Compliance

- 仍需通过服务端会话与权限边界输出移动端 read model。
- 只读能力边界必须明显，避免移动端变相承载复杂编辑与编排。
- 证据摘要应去敏并适合移动端快速阅读。

### File Structure Requirements

- 重点文件预计包括：
  - 移动端详情页
  - `src/application/mobile/` 下新增证据摘要组装
  - 视需要扩展结果 read model

### Testing Requirements

- 至少覆盖：
  - 主要原因排序可见
  - 关键证据摘要可见
  - 复杂计划细节被限制
  - scope 过滤生效

### Previous Story Intelligence

- Story 4.3 与 4.4 已建立归因结论和结果持久化；7.2 直接消费这些稳定结果。
- Story 7.1 的移动端最近分析入口可作为本故事详情页入口。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.2: 移动端查看关键证据]
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

- _bmad-output/implementation-artifacts/7-2-mobile-key-evidence-view.md
