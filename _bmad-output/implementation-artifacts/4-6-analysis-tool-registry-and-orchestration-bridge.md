# Story 4.6: 分析工具注册表与编排桥接

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 把 LLM、ERP、Cube、Neo4j 以统一工具方式挂入应用服务和 worker,
so that 执行类 stories 可以基于真实能力稳定编排，而不是在单个 route 中临时拼装调用链。

## Acceptance Criteria

1. 分析计划进入执行或重规划阶段时，系统必须通过统一 tool registry / orchestration bridge 选择并调用相应工具。
2. LLM、ERP、Cube、Neo4j 的输入输出必须符合受控契约，不允许把 provider SDK、ERP 表结构或 Cube / Neo4j 原始响应直接暴露给执行故事。
3. 当单个工具失败、超时或权限校验不通过时，编排层必须返回稳定失败状态与可记录错误上下文，而不是破坏整个会话状态机。

## Tasks / Subtasks

- [x] 建立统一 tool definition 与 registry（AC: 1, 2, 3）
  - [x] 为 LLM、ERP、Cube、Neo4j 定义工具标识、输入输出 schema、错误类型和可用性元数据。
  - [x] 建立统一注册表，不让各执行步骤自己拼工具清单。
- [x] 建立 orchestration bridge（AC: 1, 2, 3）
  - [x] 将 tool registry 接入 application service / worker 调度边界。
  - [x] 为计划步骤到工具调用建立稳定映射，不在页面层做临时编排。
- [x] 建立错误与审计上下文（AC: 3）
  - [x] 为超时、权限失败、provider 故障、空结果等场景建立统一错误 envelope。
  - [x] 为后续 Story 7.2 审计与 Story 7.4 观测保留 correlation / tool event 上下文。
- [x] 覆盖编排桥接测试（AC: 1, 2, 3）
  - [x] 验证执行层通过 registry 调用真实工具。
  - [x] 验证单工具失败时会话状态机稳定。
  - [x] 验证输入输出契约不会泄漏底层原始结构。

## Dev Notes

- 这是新 Epic 4 的收口故事，目标是把前五条 story 变成后续 `5.1` 可直接消费的真实执行底座。
- 你的业务数据真正“进入产品功能”之后，不会直接被页面或单个 route 使用，而是先变成 ERP / Cube / Neo4j 受控工具，再由这里统一编排。
- 做完 4.6，再进入执行 Epic，团队才能明确回答“这一步究竟用了哪种真实能力”。

### Architecture Compliance

- 必须遵循架构中的 `Tool Registry + Orchestration Bridge` 边界。
- 工具编排在服务端应用层和 worker 中完成，不在浏览器端进行。
- 错误上下文和工具调用元数据必须为审计与观测留出稳定接口。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/tooling/`
  - `src/application/analysis-execution/`
  - `src/infrastructure/tooling/`
  - 视需要扩展 worker 侧 dispatcher / executor

### Testing Requirements

- 至少覆盖：
  - tool registry 存在
  - orchestration bridge 调用真实工具
  - 单工具失败兜底
  - 契约不泄漏底层原始结构

### Previous Story Intelligence

- Story 4.1 到 4.5 已分别建立真实模型、结构化 guardrail、ERP 读边界、Cube 语义层和 Neo4j 图谱边界。
- Story 5.1 提交执行将直接以这里的 orchestration bridge 为真实执行入口，而不是重新发明一套工具调用路径。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.6: 分析工具注册表与编排桥接]
- [Source: _bmad-output/planning-artifacts/prd.md#AI 原生分析平台要求]
- [Source: _bmad-output/planning-artifacts/architecture.md#API 与通信模式]
- [Source: _bmad-output/planning-artifacts/architecture.md#决策影响分析]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test tests/story-4-6-tool-registry.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 新增 `src/domain/tooling/models.ts`，统一定义四类真实分析工具、运行时边界、错误代码和编排结果结构。
- 新增 `src/application/tooling/`，建立工具输入输出 schema 与统一 registry use cases，不再让执行步骤自行拼装工具清单。
- 新增 `src/application/analysis-execution/use-cases.ts`，把 `tool-selection` 结果、步骤级回退映射、顺序执行和稳定失败 envelope 收到一个 orchestration bridge 中。
- 新增 `src/infrastructure/tooling/index.ts`，将 `LLM / ERP / Cube / Neo4j` 的现有 use cases 组装为真实工具，并在输出层去掉 `raw` 等底层泄漏字段。
- `orchestration bridge` 现已为后续 `5.1` 提交执行和 worker 编排准备好统一入口：可以先选工具，再按顺序执行，并在单工具失败时返回稳定错误上下文而不是抛出异常。
- 故事级测试已覆盖：工具注册表存在、四类真实工具元数据、真实工具封装不泄漏底层结构、单工具失败的稳定 envelope、以及 tool-selection 未命中时的步骤级回退策略。
- 后续收口中新增了 `platform.capability-status` 工具，用于汇总 `LLM / ERP / Cube / Neo4j` 的配置与健康状态，作为执行前的简单必备能力检查入口。
- `tool registry` 的 `availability` 不再是静态常量，而是会按真实配置降级标注 `ready / degraded`，避免配置未就绪时仍误报为可用。
- `tool-selection` 现在会显式接收 `stepId / stepTitle / stepObjective`，减少不同计划步骤反复选中同一组工具的风险。
- `llmStructuredAnalysisInputSchema` 与 `erpReadToolInputSchema` 的关键字段现已改成真实运行时校验，不再依赖空断言的 `z.custom(...)`。

### File List

- _bmad-output/implementation-artifacts/4-6-analysis-tool-registry-and-orchestration-bridge.md
- src/domain/tooling/models.ts
- src/application/tooling/models.ts
- src/application/tooling/use-cases.ts
- src/application/analysis-execution/use-cases.ts
- src/infrastructure/tooling/index.ts
- tests/story-4-6-tool-registry.test.mjs

## Change Log

- 2026-04-03：完成 Story 4.6，建立统一分析工具注册表、编排桥接、稳定错误 envelope 与故事级测试，并将故事状态推进到 `review`。
