# Story 10.4: Memory / Knowledge / Skills / Tools 的运行时接入面

Status: ready-for-dev

## Story

As a 平台架构团队,
I want 为 memory、knowledge resources、skills prompts 和工具系统建立统一 runtime 接入面,
so that 后续新增长期记忆、知识库、技能系统和工具市场时，不需要继续在页面层和 route 层重复接线，并且这些接入不会混淆 ontology registry、知识治理、权限审计和 worker orchestration 的职责边界。

## Acceptance Criteria

1. Runtime bridge 必须只在服务端边界暴露统一的 capability ports / adapters，至少覆盖 `memory`、`knowledge resources`、`skills prompts`、`tools` 四类 surface，并且每个 surface 都带有明确的 status、version、provenance 和 ownership 元数据。
2. Runtime bridge 必须能够以组合方式接入现有能力，包括 provider-defined memory tools、memory providers、custom memory tool wrappers、MCP resources / prompts、skills prompt registry 和工具系统，但这些 surface 仍然必须保持独立类型、独立审计和独立测试边界。
3. 当某个 capability 未配置、不可用、被拒绝或需要人工确认时，bridge 必须返回明确的 `disabled` / `degraded` / `unconfigured` / `requires-confirmation` 状态和可诊断原因，不得静默降级成伪成功、默认值或隐式 fallback。
4. Tool approval 与 governance 必须是 bridge 的一等能力：系统应能生成带 `correlationId`、actor、target capability、reason、decision、timestamps 的 approval envelope，并在 approval 通过之前阻断敏感 tool 执行。
5. Memory、knowledge 和 skills 的接入必须保持 server-side only，浏览器端不得直连 provider、registry、resource server 或工具端点；前端只能消费服务端整形后的 projection。
6. Runtime bridge 可以把已批准的 memory / knowledge / skill / tool 结果注入模型上下文或工具调用路径，但 canonical source of truth 仍然必须留在 execution events、result blocks、follow-up/history facts、ontology registry、knowledge governance、权限审计和 worker orchestration。
7. 该 bridge 必须为未来 agent loops、resume checkpoints 和 dynamicTool 注册预留稳定接入面，但本 story 只负责建立统一接入层和测试边界，不负责实现完整自治 agent scheduler。
8. 后续扩展 memory provider、custom skill registry、MCP connector、knowledge retrieval 和 tool approval flow 时，必须沿用版本化 port/registry contract，而不是在 page 层或 route 层发明新的私有协议。

## Tasks / Subtasks

- [ ] 定义 runtime bridge 的 domain / application contract（AC: 1, 3, 4, 6, 7, 8）
  - 明确定义 capability descriptor、status enum、provenance、ownership、version、availability reason、approval envelope、resume token 等核心类型。
  - 为 `memory`、`knowledge`、`skills`、`tools` 建立统一但不混同的 port 接口，确保每个 surface 都可以独立演进。
  - 明确 bridge 只承接“接入”和“投影”，不承接 ontology registry、知识治理、权限判定、Worker 编排或持久化真相层。

- [ ] 建立 server-side runtime composition layer（AC: 1, 2, 5, 6）
  - 在 infrastructure 层实现 bridge 组装逻辑，把现有 `prompt-registry`、`schema-guardrails`、`tool registry`、`OpenAI-compatible adapter`、`worker`、`follow-up/history` facts 接到统一 runtime 入口。
  - 为 memory provider、MCP resources / prompts、skills registry 和 knowledge retrieval 预留可替换 adapter，优先使用依赖注入和端口组合，而不是 route 内联拼装。
  - 明确每个 adapter 的输入输出契约、错误语义和权限前置条件，防止后续把临时 glue code 误当成正式能力层。

- [ ] 实现 tool approval / governance 接线（AC: 3, 4, 6, 7）
  - 设计 approval request / approval decision / audit event 的统一 envelope，包含 correlation id、actor、target tool / resource、reason、decision、timestamp、source。
  - 将 `approve`、`deny`、`require-confirmation` 设为显式状态，阻止未经批准的敏感 tool / resource 继续执行。
  - 确保 approval 只做治理门禁，不替代授权体系、ontology governance 或 worker orchestration。

- [ ] 为 memory / knowledge / skills / tools 提供可扩展接入点（AC: 1, 2, 6, 8）
  - Memory surface 支持 provider-defined tools、memory provider、custom memory tool 三种接入风格，但实现必须保持 provider-neutral。
  - Knowledge surface 优先面向只读知识资源与检索型 access pattern，可通过 MCP resources 或 read-only retrieval adapter 承接。
  - Skills surface 采用 versioned skill registry / prompt registry 思路，允许按版本和权限范围激活 prompt，但不得把 skills 当成业务事实源。
  - Tools surface 必须复用现有 tool registry 元数据、运行时状态和错误语义，不要为 bridge 再造一套平行工具目录。

- [ ] 补齐 story 级验证（AC: 1, 2, 3, 4, 5, 6, 7, 8）
  - 验证每个 capability surface 都能在未配置、配置成功、配置失效、需要确认四类情况下返回稳定且可诊断的结果。
  - 验证 approval 被拒绝后不会触发 downstream tool / resource 调用。
  - 验证 bridge 不会把 execution snapshot、follow-up history、ontology registry 或 knowledge governance 误当成可被 runtime 覆盖的临时状态。
  - 验证 server-only 边界与测试隔离，确保浏览器侧不会直接依赖 provider 实现。

## Dev Notes

### Scope Boundary

本 story 只建立“统一 runtime 接入面”，不负责真正交付一整套 memory store、知识库产品、技能市场或自治 agent 框架。

需要明确的产品边界是：

- memory / knowledge / skills / tools 可以进入 runtime bridge
- runtime bridge 可以把这些 surface 组织成可组合的 server-side contract
- runtime bridge 不能接管 ontology registry
- runtime bridge 不能接管 knowledge governance
- runtime bridge 不能接管权限审计
- runtime bridge 不能接管 Worker orchestration

如果后续要接入向量检索、长时记忆、外部知识库或技能市场，本 story 产物应该是“可扩展的接线层”，不是“把所有能力都一次性实现完”的玩具式方案。

### Architecture Compliance

- 必须继续遵循 `domain -> application -> infrastructure -> app` 分层，bridge 的能力描述放在 domain / application，具体 provider 绑定放在 infrastructure。
- 必须保持 server-side only；任何 provider、registry、resource、approval、memory 或 skills 接线都不能直接暴露给浏览器。
- `Vercel AI SDK` 只应继续作为 10.1 引入的 AI application runtime layer 的交互层能力之一，本 story 不能把它提升成系统编排底座，也不能让它覆盖业务真相层。
- `tool approval` 是治理门禁，不是授权体系本身；`knowledge resources` 是检索接入面，不是知识治理本身；`skills prompts` 是 prompt 接入面，不是 ontology 定义本身。
- 若未来引入 `dynamicTool`、agent loops 或 resume checkpoint，本 story 产物应当已经具备稳定事件/端口语义，避免后续在页面层或 route 层重建第二套协议。

### Current Implementation Intelligence

现有仓库已经有足够多的“正式边界”可复用，这个 story 应该在这些边界上做 bridge，而不是重写：

- `src/infrastructure/tooling/index.ts` 已经把真实工具、可用性、状态与元数据组合成统一服务层，并且明确依赖 `LLM`、`Cube`、`Neo4j` 和 `ERP` 读模型。
- `src/application/tooling/use-cases.ts` 已经提供工具注册、可用性读取、输入校验、输出校验、错误归一化和 `correlationId` 语义。
- `src/domain/tooling/models.ts` 已经定义工具名称、运行时归属、availability、invocation result 和 error code。
- `src/infrastructure/llm/prompt-registry.ts` 与 `src/infrastructure/llm/schema-guardrails.ts` 已经把结构化 prompt 与 schema fallback 做成集中式边界，后续 runtime bridge 应该直接复用，不要把 prompt 重新散落到页面层。
- `src/infrastructure/llm/openai-compatible-adapter.ts` 已经是 server-only provider adapter，带超时、重试、限流和错误归一化，bridge 需要直接站在这个边界上，而不是再写一层隐式 provider shim。
- `src/worker/main.ts` 与 `src/worker/finalize-analysis-execution.ts` 已经把 execution events、snapshot persistence 和 follow-up attachment 固化为运行事实，runtime bridge 不能把这些事实重新包装成临时状态。
- `src/application/follow-up/use-cases.ts` 与 `src/application/analysis-history/use-cases.ts` 已经把追问、历史轮次和结论回看做成正式读模型；bridge 只能消费这些事实，不能替换它们。

### Future Integration Strategy

#### Memory Provider

未来 memory 接入建议优先采用 provider-neutral 的 `MemoryProviderPort` 或同类端口，让不同 provider 只负责 `recall / write / summarize / list` 之类的能力，不要把 provider 细节泄漏到页面、route 或 worker handler。

如果未来 memory 采用 provider-defined tools、custom memory tool 或独立 memory provider，本 story 的 bridge 应保证：

- capability status 是显式的
- memory 结果带 provenance
- memory 结果只能作为上下文输入或受控投影
- memory 不能覆盖 canonical execution facts

#### Knowledge Retrieval

知识接入建议优先面向只读资源和检索路径，典型入口可以是 MCP resources、read-only knowledge adapters、或受控 knowledge retrieval service。

知识资源必须携带：

- source
- authority
- version
- visibility / scope
- retrieval time

这样后续即使接入外部知识库，也不会把“知识检索结果”误当成“知识真相”或“业务定义本身”。

#### Skills Prompt Registry

skills 更接近 versioned prompt / capability package，而不是业务事实源。建议把 skills 设计成可版本化、可激活、可审计的 registry surface。

技能激活必须至少具备：

- skill id
- skill version
- activation reason
- scope / permission gate
- prompt source

bridge 可以把 skills 暴露给模型上下文或 tool path，但不能让 skills 越过 ontology registry、知识治理或权限审计。

#### Tool Approval / Governance

tool approval 必须保留可审计、可回放、可拒绝的治理语义。建议把 approval flow 设计成显式事件流，而不是 UI 私有状态。

最低要求包括：

- 请求谁批准
- 为什么需要批准
- 批准了什么 capability
- 最终是允许、拒绝还是要求确认
- 该 decision 对后续 tool / resource 调用是否生效

这里要特别注意：approval 不是权限系统的替代品。权限判断仍属于受控的服务端安全边界，approval 只是在该边界上加一层治理门禁。

#### Agent Loops

后续若要支持 agent loops，bridge 应该只提供稳定的 loop surface，例如 `select -> approve -> execute -> observe -> resume` 的事件和端口语义。

本 story 不负责实现完整自治循环，但要为它预留：

- resume token
- step provenance
- approval checkpoint
- loop state projection
- error / retry envelope

这能保证后续即使接入更强的 agent runtime，也不会改写 execution history 的事实模型。

### Library / Framework Requirements

- 继续使用现有 `Zod 4` 作为统一契约边界，bridge 的输入输出、approval envelope 和 capability descriptor 都应可校验。
- 继续使用现有服务端 `OpenAI SDK` 适配链路，不要绕过 `LLM Provider Adapter` 直接在页面或 route 中发起 provider 调用。
- `MCP` 相关能力如果接入，应作为 server-side adapter / port 出现，不要变成浏览器直连的通道。
- 当前不应把 `LangGraph`、`LangChain`、`AutoGen` 或 Google ADK 当作主实现方向；如后续需要更重的执行图框架，应先单独做架构决策。

### File Structure Requirements

重点文件预计会落在以下区域，实际实现可以根据现有目录继续细化，但不要偏离分层边界：

- `src/domain/runtime/`
- `src/application/runtime/`
- `src/infrastructure/runtime/`
- `src/infrastructure/tooling/`
- `src/infrastructure/llm/`
- `src/worker/`
- `tests/story-10-4-runtime-bridge-for-memory-knowledge-skills-and-tools.test.mjs`

如果 bridge 需要复用现有 tool registry 或 prompt registry，优先扩展现有模块，不要复制一套平行 registry。

### Testing Requirements

本 story 的测试重点不是“真的连上一个完整 memory provider”，而是验证桥接层的契约、边界和失败语义。

至少需要覆盖：

- capability discovery 在 provider 缺失、provider 正常、provider 部分失败时的状态输出
- approval 请求被拒绝时，后续 tool / resource 调用不会发生
- knowledge / skills / memory 的 descriptor 进入上下文时保留 provenance 与 version
- bridge 不会静默吞掉错误，也不会把不可用 surface 伪装成成功
- server-only 边界不被打破，浏览器侧不能直接 import provider 实现
- bridge 只消费 execution events / snapshots / follow-up / ontology facts，不会修改它们的 canonical 语义

建议仍然遵守当前项目的测试习惯，采用 `node:test` 编写 story 级验证，并在影响范围内补 `pnpm lint` 和 `pnpm build` 的交付验证。

### Previous Story Intelligence

虽然这是一条新的 Epic 10 story，但它依赖的实现模式已经在前面的故事里站稳了：

- `Story 4.2` 已经把 prompt registry 与 schema guardrails 变成统一的结构化输出边界。
- `Story 4.6` 已经把工具注册、可用性、输入输出校验和错误归一化变成统一的 tool registry 语义。
- `Epic 5` 和 `Epic 6` 已经把 execution snapshots、follow-up、history 和结论回看做成 canonical runtime facts。
- `Story 9.1` 已经明确 ontology registry 与 version model 是 canonical knowledge center，不能被 runtime glue、adapter 或 UI state 替代。

这意味着 10.4 的正确做法是“在现有事实之上搭 runtime bridge”，而不是把 memory、knowledge、skills 和 tools 重新做成一套平行真相层。

### Latest Technical Information

- 现有 `tool registry` 已经有五类真实工具：`llm.structured-analysis`、`erp.read-model`、`cube.semantic-query`、`neo4j.graph-query`、`platform.capability-status`，并且具备 `availability` 元数据。
- 现有 `prompt-registry` 只集中管理分析意图、上下文、计划、工具选择和结论总结五类结构化任务；这个 story 不应该把更多杂项 prompt 散落进页面层。
- 现有 `schema-guardrails` 对结构化输出采用 `safeParse` 与 fallback envelope，bridge 的错误语义应与其一致。
- 现有 `worker` 已经把 execution completion、snapshot persistence 和 follow-up attachment 串起来了，bridge 只能在这些事实之上做投影或接线。
- 现有 `follow-up` 与 `analysis-history` 已经把多轮会话变成可回看模型，runtime bridge 不应重建一套新的历史协议。
- 现有 `openai-compatible-adapter` 已经是 server-only，并且处理超时、重试、限流、provider 不可用等问题；bridge 应该依赖它，而不是再往下渗透 provider 细节。

### Non-Goals / Out of Scope

本 story 明确不做以下内容：

- 不实现完整 memory store、向量索引或长期记忆产品
- 不实现完整知识库后台、知识治理后台或 ontology registry 改造
- 不实现完整技能市场、技能编排后台或技能发布流程
- 不重写 Worker orchestration
- 不把 browser 端变成 tool / memory / knowledge provider 的直连客户端
- 不引入新的大而全智能体框架作为系统底座

如果未来要做这些能力，本 story 提供的是“统一接入面”和“受控治理边界”，不是最终产品形态。

## References

- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#L1207-L1279]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#L286-L394]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#L303-L307]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09-vercel-ai-sdk.md#L347-L420]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/project-context.md#L21-L37]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/project-context.md#L111-L125]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/project-context.md#L135-L140]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/infrastructure/tooling/index.ts#L223-L280]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/application/tooling/use-cases.ts#L105-L200]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/domain/tooling/models.ts#L1-L95]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/infrastructure/llm/prompt-registry.ts#L62-L173]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/infrastructure/llm/schema-guardrails.ts#L26-L130]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/infrastructure/llm/openai-compatible-adapter.ts#L1-L140]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/worker/main.ts#L17-L159]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/worker/finalize-analysis-execution.ts#L59-L120]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/application/follow-up/use-cases.ts#L63-L170]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/application/analysis-history/use-cases.ts#L84-L160]
- [Source: /Users/zhouxia/Documents/open-code/ontology-agent/src/domain/analysis-session/follow-up-models.ts#L13-L198]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Completion Notes List

- Story created from approved Epic 10 / Story 10.4 change proposal and current runtime/tooling implementation facts.
- Scope intentionally limited to runtime bridge contracts, adapters, governance hooks, and tests; canonical ontology / knowledge governance / worker orchestration remain separate systems of record.

### File List
- /Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-4-runtime-bridge-for-memory-knowledge-skills-and-tools.md
