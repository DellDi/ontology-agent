# Story 4.1: 服务端 LLM Provider 适配层与 OpenAI 兼容接入

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 建立仅服务端可用的模型调用适配层并支持 OpenAI-compatible API,
so that 后续理解、规划、重规划与执行都能在受控边界内接入真实 LLM 能力。

## Acceptance Criteria

1. 所有模型调用都必须通过统一的服务端 LLM adapter 进入，浏览器端不得直接持有模型密钥或访问模型 provider。
2. 系统必须支持标准 OpenAI-compatible API 配置，并具备超时、重试、限流和基础健康检查能力。
3. 应用服务与 worker 必须通过统一 port 调用模型能力，而不是在 route handler、页面组件或零散模块中直接引入 provider SDK。

## Tasks / Subtasks

- [ ] 建立 LLM provider port 与配置模型（AC: 1, 2, 3）
  - [ ] 在 `src/application` 或 `src/infrastructure` 中定义统一的模型调用 port、provider 配置与错误类型。
  - [ ] 明确环境变量、模型标识、超时、重试、速率限制和健康检查约定。
- [ ] 实现服务端 OpenAI-compatible adapter（AC: 1, 2, 3）
  - [ ] 新增仅服务端可用的 provider adapter，不让浏览器 bundle 接触密钥。
  - [ ] 支持标准 chat / responses 风格调用所需的最小能力边界，由上层通过统一 port 使用。
- [ ] 接入限流、超时与健康检查（AC: 2）
  - [ ] 复用 Redis 或同层基础设施做“按用户 + 按组织”的限流。
  - [ ] 为 provider 不可用、超时、429、结构错误建立稳定错误结果。
- [ ] 覆盖服务端接线测试（AC: 1, 2, 3）
  - [ ] 验证浏览器端无 provider 密钥暴露。
  - [ ] 验证应用层只能通过统一 adapter 入口调模型。
  - [ ] 验证超时 / 限流 / provider 故障的稳定兜底。

## Dev Notes

- 这是“真实模型接线层”，不是提示词工程故事；prompt registry 与 schema guardrails 属于 Story 4.2。
- 本故事目标是把真实 provider 接入站稳，但仍保持 provider-agnostic，避免后续执行层被某家 SDK 绑死。
- 后续 3.x、4.x、5.x 中任何需要模型的地方，都应该依赖这里定义的 port，而不是各自偷偷直连 provider。

### Architecture Compliance

- 必须遵循架构中的“浏览器端不得直连 LLM Provider”边界。
- 密钥只存在于服务端，模型调用入口统一由 infrastructure adapter 承担。
- 应用服务、worker、route handler 只能依赖统一 port，不应直接依赖具体 provider SDK。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/llm/`
  - `src/infrastructure/llm/`
  - `src/infrastructure/config/`
  - 视需要扩展健康检查或管理面 route

### Testing Requirements

- 至少覆盖：
  - 服务端统一模型入口
  - OpenAI-compatible 配置加载
  - 超时 / 重试 / 限流兜底
  - 浏览器端不暴露敏感 provider 配置

### Previous Story Intelligence

- Story 2.5 已建立 Redis 基线，可为模型调用限流提供共享基础设施。
- Story 2.6 已建立 worker skeleton，后续长耗时分析的模型调用应直接复用这里的统一 adapter。
- Story 3.1 到 3.5 已经把 intent、context 和 plan skeleton 站稳；4.1 负责把这些骨架接上真实模型入口。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1: 服务端 LLM Provider 适配层与 OpenAI 兼容接入]
- [Source: _bmad-output/planning-artifacts/prd.md#AI 原生分析平台要求]
- [Source: _bmad-output/planning-artifacts/prd.md#全栈产品要求]
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

- _bmad-output/implementation-artifacts/4-1-server-side-llm-provider-adapter-and-openai-compatible-integration.md
