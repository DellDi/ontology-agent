# Story 3.2: 抽取分析上下文并在会话中展示

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 看到系统从问题中抽取出的指标、实体、时间范围和约束条件,
so that 我可以判断后续分析是否建立在正确的上下文上。

## Acceptance Criteria

1. 当前分析会话必须展示抽取出的目标指标、实体对象、时间范围、比较方式和约束条件。
2. 缺失或不确定的字段必须以可辨识方式提示，不能被伪装为已确认事实。
3. 当用户问题包含多个约束时，抽取结果必须与原问题语义一致，不得凭空填入无关业务对象。

## Tasks / Subtasks

- [ ] 建立分析上下文模型与规范化逻辑（AC: 1, 2, 3）
  - [ ] 定义指标、实体、时间范围、比较方式、约束条件及其 `missing / uncertain / confirmed` 状态。
  - [ ] 抽取结果必须挂在现有 analysis session 下。
- [ ] 接入会话读模型与界面展示（AC: 1, 2）
  - [ ] 在服务端组装 context read model，不让浏览器直接拼装敏感业务上下文。
  - [ ] 在分析会话页面展示上下文并清晰区分不确定字段。
- [ ] 覆盖上下文抽取与展示测试（AC: 2, 3）
  - [ ] 验证多约束问题的抽取结果与原语义一致。
  - [ ] 验证 uncertain / missing 提示。

## Dev Notes

- 本故事是“抽取并展示”，不是“允许修改”；修正与撤销属于 Story 3.3。
- 不确定字段是产品要求，不是异常分支；模型设计时应直接支持，而不是以空字符串凑合。
- 尽量复用现有分析会话容器，不新建平行页面模型。

### Architecture Compliance

- 上下文抽取仍由服务端完成，浏览器只展示结果。
- 不得引入前端本地状态作为上下文事实源，否则后续追问与执行会失真。
- 必须继续遵守服务端会话与 scope 边界。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-context/` 下新增模型
  - `src/application/analysis-context/` 或 `src/application/analysis-session/`
  - `src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx`
  - `src/app/(workspace)/workspace/analysis/[sessionId]/_components/` 下新增展示组件

### Testing Requirements

- 至少覆盖：
  - 上下文抽取字段完整性
  - uncertain / missing 状态展示
  - 多约束语义一致性
  - owner-only 读取

### Previous Story Intelligence

- Story 3.1 已建立 intent 输出，本故事应直接消费 intent 结果。
- Story 2.4 的 analysis session 持久化为本故事提供了会话归属和回看基础。
- 后续 Story 3.3、3.4、3.5 都依赖这里的上下文模型稳定。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2: 抽取分析上下文并在会话中展示]
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

- _bmad-output/implementation-artifacts/3-2-context-extraction-display.md
