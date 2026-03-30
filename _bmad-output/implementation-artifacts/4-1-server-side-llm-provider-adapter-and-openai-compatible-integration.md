# Story 4.1: 服务端 LLM Provider 适配层与 OpenAI 兼容接入

Status: done

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

- [x] 建立 LLM provider port 与配置模型（AC: 1, 2, 3）
  - [x] 在 `src/application` 或 `src/infrastructure` 中定义统一的模型调用 port、provider 配置与错误类型。
  - [x] 明确环境变量、模型标识、超时、重试、速率限制和健康检查约定。
- [x] 实现服务端 OpenAI-compatible adapter（AC: 1, 2, 3）
  - [x] 新增仅服务端可用的 provider adapter，不让浏览器 bundle 接触密钥。
  - [x] 支持标准 chat / responses 风格调用所需的最小能力边界，由上层通过统一 port 使用。
- [x] 接入限流、超时与健康检查（AC: 2）
  - [x] 复用 Redis 或同层基础设施做“按用户 + 按组织”的限流。
  - [x] 为 provider 不可用、超时、429、结构错误建立稳定错误结果。
- [x] 覆盖服务端接线测试（AC: 1, 2, 3）
  - [x] 验证浏览器端无 provider 密钥暴露。
  - [x] 验证应用层只能通过统一 adapter 入口调模型。
  - [x] 验证超时 / 限流 / provider 故障的稳定兜底。

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

- `node --test tests/story-4-1-llm-provider-adapter.test.mjs`（先失败，后通过）
- `NODE_OPTIONS=--conditions=react-server npx tsx --test tests/story-4-1-bailian-smoke.test.mts`
- `pnpm test:smoke:bailian`
- `pnpm lint`
- `pnpm build`
- `node --test --test-concurrency=1 tests/*.test.mjs`

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- 已新增 `src/application/llm/`，定义统一的 `LlmProviderPort`、调用上下文、provider 配置模型与 `createLlmUseCases()`，为后续 application / worker 复用统一入口。
- 已新增 `src/infrastructure/llm/`，实现仅服务端可用的 OpenAI-compatible adapter，基于 `openai` Node SDK 调用百炼兼容接口，并保留 `/responses`、`/chat/completions` 与 `/models` 健康检查对应能力。
- 本次已将 Story 4.1 的底层 transport 从 `fetch` 版升级为 `openai` SDK 版，但对上层继续保持相同的 provider port 和调用接口，不影响后续 4.x / 5.x 故事接线。
- adapter 统一处理超时、429、provider 不可用和结构错误，避免把原始 provider 报错直接暴露给上层；SDK 内建重试已关闭，仍由本项目自己的 fallback / retry 策略负责控制。
- 已根据 code review 收口 4 个运行时边界问题：Redis 限流键改为原子更新、Redis 连接增加显式超时保护、常见 4xx 模型错误纳入 fallback 链、健康检查从“仅目录检查”升级为“目录 + 真实模型调用能力检查”。
- 后续复核中又继续收口了 3 个残留问题：原子限流恢复为“首次请求设置 TTL”的固定窗口语义、Redis 连接超时后显式 `destroy()` 避免后台悬挂连接、`/models` 从健康检查硬依赖降级为可选探测。
- 已复用 Redis 建立模型调用限流，key 维度绑定 `userId + organizationId + purpose`，满足“按用户 + 按组织”的服务端节流边界。
- 已扩展 `.env.example` 与 `docs/local-infrastructure.md`，明确 LLM provider 的服务端环境变量、健康检查路径和安全边界。
- 当前默认 provider 配置已切到阿里云百炼兼容接口：`https://dashscope.aliyuncs.com/compatible-mode/v1`。
- 当前默认主模型为 `bailian/kimi-k2.5`；默认 fallback 链为 `bailian/qwen3.5-plus`、`bailian/MiniMax/MiniMax-M2.7`、`bailian/glm-5`。
- 发送到百炼接口前会自动把应用层模型标识规范化为 provider 实际模型名，例如 `bailian/qwen3.5-plus -> qwen3.5-plus`。
- API key 现统一从 `DASHSCOPE_API_KEY` 读取，没有把密钥写入仓库文件。
- 已新增真实百炼 smoke test：`tests/story-4-1-bailian-smoke.test.mts`。默认跳过，只有显式设置 `RUN_BAILIAN_SMOKE_TEST=1` 时才执行，并通过 `NODE_OPTIONS=--conditions=react-server` 兼容 `server-only` 标记模块。
- smoke test 当前采用“健康检查 + chat completions 最小生成”路径，优先验证真实百炼配置、OpenAI-compatible 接线和服务端 adapter 在真实 provider 下的可用性，同时避免把 `responses` 端点的账户/模型兼容差异误判成基础联通失败。
- 未把 3.x 的 intent / context / planning 逻辑强绑到真实 LLM，保留 Story 4.2 的 prompt registry / schema guardrails 继续收束上层调用契约。
- 故事级测试 `tests/story-4-1-llm-provider-adapter.test.mjs` 已升级为显式约束 `openai` SDK 接入，覆盖统一入口、OpenAI-compatible 配置、限流、错误模型、健康检查和浏览器端无密钥暴露。
- 验证通过：`node --test tests/story-4-1-llm-provider-adapter.test.mjs`、`NODE_OPTIONS=--conditions=react-server npx tsx --test tests/story-4-1-bailian-smoke.test.mts`、`pnpm test:smoke:bailian`、`pnpm lint`、`pnpm build`、`node --test --test-concurrency=1 tests/*.test.mjs`。

### File List

- _bmad-output/implementation-artifacts/4-1-server-side-llm-provider-adapter-and-openai-compatible-integration.md
- .env.example
- docs/local-infrastructure.md
- package.json
- pnpm-lock.yaml
- src/application/llm/models.ts
- src/application/llm/ports.ts
- src/application/llm/use-cases.ts
- src/infrastructure/llm/config.ts
- src/infrastructure/llm/errors.ts
- src/infrastructure/llm/index.ts
- src/infrastructure/llm/openai-compatible-adapter.ts
- src/infrastructure/llm/rate-limit.ts
- tests/story-4-1-llm-provider-adapter.test.mjs
- tests/story-4-1-bailian-smoke.test.mts

## Change Log

- 2026-03-30：完成 Story 4.1，实现服务端统一 LLM adapter、OpenAI-compatible 接口、Redis 限流、健康检查与故事级契约测试。
- 2026-03-30：将 Story 4.1 的 provider adapter 从 `fetch` transport 升级为 `openai` SDK transport，并保持上层接口不变。
- 2026-03-30：根据 code review 修复健康检查代表性、Redis 连接超时、4xx fallback 与限流原子性问题。
- 2026-03-30：根据第二轮 review 复核，修复固定窗口 TTL 语义回归、Redis 超时后连接泄漏风险，以及 `/models` 健康检查硬依赖问题。
- 2026-03-30：新增面向真实百炼配置的 smoke test，并补充 `pnpm test:smoke:bailian` 一键命令与运行说明。
