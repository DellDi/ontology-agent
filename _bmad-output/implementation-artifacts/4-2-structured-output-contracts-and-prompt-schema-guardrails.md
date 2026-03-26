# Story 4.2: 结构化输出契约与 Prompt/Schema Guardrails

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 为意图、上下文增强、计划步骤、工具选择和结论摘要建立结构化输出契约,
so that 模型输出不会以不受控的自由文本直接进入系统核心链路。

## Acceptance Criteria

1. 所有进入分析链路的模型输出都必须通过统一 schema 校验，失败时返回稳定兜底而不是直接污染会话状态。
2. prompt 与结构化输出约束必须集中管理，不得把 prompt 文本和 JSON 解析逻辑零散塞进页面组件或 route handler。
3. 至少对意图、上下文增强、计划、工具选择和结论摘要建立可测试的结构化契约。

## Tasks / Subtasks

- [ ] 建立 prompt registry 与任务分类（AC: 2, 3）
  - [ ] 明确意图识别、上下文补全、计划生成、工具选择、结论摘要等任务类型。
  - [ ] 设计集中式 prompt registry，不让 prompt 文本分散在 UI 或调用方中。
- [ ] 建立结构化输出 schema 与解析边界（AC: 1, 3）
  - [ ] 使用 `Zod` 为主要模型任务建立输入 / 输出 schema。
  - [ ] 为结构化解析失败、字段缺失、值域越界建立稳定 fallback。
- [ ] 接入 guardrail 流程（AC: 1, 2, 3）
  - [ ] 将 Story 4.1 的模型 adapter 与 schema 校验串联。
  - [ ] 为后续 3.x / 5.x 直接消费的模型结果建立统一 envelope。
- [ ] 覆盖契约测试（AC: 1, 2, 3）
  - [ ] 验证主要任务类型的 schema 存在并可复用。
  - [ ] 验证非法输出不会静默进入计划或执行链路。
  - [ ] 验证 prompt registry 更新时调用边界保持稳定。

## Dev Notes

- 这是“结构化 guardrail 层”，目标是让模型输出变成可验证系统输入，而不是靠 UI 临时容错兜底。
- 本故事不追求一次性把所有提示词做到完美，重点是先建立可演进、可审计的结构化约束边界。
- 3.x 当前已落地的理解与计划骨架，后续可逐步切换到这里的真实 schema 驱动实现。

### Architecture Compliance

- 必须遵循架构中的 `Prompt Registry + Structured Output Guardrails` 组件边界。
- 结构化 schema 与 prompt registry 应位于服务端，不得下沉到浏览器端。
- guardrail 失败结果必须是稳定应用层错误，而不是 provider 原始报错直接外泄。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/analysis-ai/`
  - `src/domain/analysis-ai/`
  - `src/infrastructure/llm/prompt-registry.ts`
  - `src/infrastructure/llm/schema-guardrails.ts`

### Testing Requirements

- 至少覆盖：
  - prompt registry 存在且集中管理
  - 主要任务类型 schema 校验
  - 非法模型输出兜底
  - guardrail 结果可供应用层稳定消费

### Previous Story Intelligence

- Story 4.1 已建立真实模型调用 adapter；4.2 负责把 provider 响应收束成可验证契约。
- Story 3.1 到 3.5 的 intent、context、candidate factors、plan skeleton 都会逐步迁移到这里的结构化输出边界。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2: 结构化输出契约与 Prompt/Schema Guardrails]
- [Source: _bmad-output/planning-artifacts/prd.md#AI 原生分析平台要求]
- [Source: _bmad-output/planning-artifacts/architecture.md#认证与安全]
- [Source: _bmad-output/planning-artifacts/architecture.md#API 与通信模式]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/4-2-structured-output-contracts-and-prompt-schema-guardrails.md
