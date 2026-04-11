# Story 9.3: Ontology Grounding 接入上下文、计划与工具选择

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台架构团队,
I want 在 context、planner 与 tool selection 之间增加 ontology grounding,
so that 计划和工具调用建立在统一业务语义之上，而不是自由文本与局部映射。

## Acceptance Criteria

1. 当用户输入分析问题并完成 context extraction 后，系统必须先将实体、指标、因素和时间语义映射到 canonical ontology definitions，再进入 planner。
2. planner 只能消费 grounded definitions 或其受控 read model，不得继续直接依赖自由文本上下文或局部硬编码语义映射作为主路径。
3. tool selection 必须基于 `ToolCapabilityBinding` 或等价的 ontology-grounded 绑定关系决定可调用能力，而不是只靠步骤标题、字符串匹配或 prompt 隐式推断。
4. follow-up / replan 继承的上下文应优先是 ontology-grounded context，而不是仅保留自由文本修正结果；同时历史执行与结论至少要能识别 grounding 结果或其版本引用。

## Tasks / Subtasks

- [ ] 建立 ontology grounding 领域模型与应用层主链（AC: 1, 2, 4）
  - [ ] 在 `src/domain/ontology/` 或等价位置定义 grounding 结果模型，至少覆盖：
    - [ ] grounded entity
    - [ ] grounded metric
    - [ ] grounded factor
    - [ ] grounded time semantic
  - [ ] 在 `src/application/ontology/` 建立 grounding use cases，把现有 context extraction 输出映射到 canonical definitions。
  - [ ] 建立 ontology governance 的正式 bootstrap / initialize 流程，确保运行时所依赖的首批 canonical definitions 会被实际装载到 `platform` schema，而不是只存在于测试 seed。
  - [ ] bootstrap / initialize 流程必须满足：
    - [ ] 幂等
    - [ ] 不重复写入同版本 canonical definitions
    - [ ] 不覆盖已发布或已治理版本
    - [ ] 失败时给出明确诊断，不得静默跳过
  - [ ] 明确 grounding 失败、歧义、多候选命中的错误/状态语义，避免静默回退成假成功。

- [ ] 接入 context -> planner 的 grounding 边界（AC: 1, 2）
  - [ ] 调整 plan generation 主链，使 planner 优先消费 grounded context 或其受控 read model。
  - [ ] 明确哪些旧字段仍作为兼容输入保留，哪些必须由 grounding 后对象替代。
  - [ ] 对 `9.2` 已治理化的对象（至少收费类 metric variant / time semantic），逐步移除 `metric-catalog.ts`、局部 context mapping 或 prompt 约定作为默认事实源。
  - [ ] 若仍保留 legacy catalog / mapping，必须把它限制为 transitional path，并明确：
    - [ ] 哪些 metric / time semantic 已切到 governance definitions 主路径
    - [ ] 哪些对象仍暂时停留在 legacy path
    - [ ] 退出 legacy path 的条件是什么
  - [ ] 不在本 story 中大改 planner 业务策略，只把其输入源从“自由文本 + 局部映射”升级为“grounded definitions”。

- [ ] 接入 tool selection 的 ontology-bound binding（AC: 3）
  - [ ] 将 `ToolCapabilityBinding` 或等价绑定模型接入现有 tool registry / orchestration bridge。
  - [ ] 至少让常见计划步骤的工具选择建立在正式 binding 上，而不是仅靠字符串匹配。
  - [ ] 对未绑定或未 `approved` 的定义，系统应 fail loud 或给出明确诊断，不得静默伪成功。

- [ ] 把 follow-up / replan / history 的上下文基线改为 grounded context（AC: 4）
  - [ ] follow-up 创建时优先继承 grounded context，而不是只继承自由文本 merged context。
  - [ ] replan 时优先基于 grounded definitions 计算后续计划输入。
  - [ ] 为 execution / history 留出 grounding 结果或 ontology version 引用位；不要求在本 story 完成最终 version binding，那属于 `9.6`。

- [ ] 细化 LLM 工具输出契约（来自 Story 4.6 Code Review [B3]）
  - [ ] 将 `src/application/tooling/models.ts` 中 `llmStructuredAnalysisOutputSchema` 的 `value: z.unknown()` 替换为 `taskType` 区分的 discriminated union schema，至少覆盖 `conclusion-summary`（需包含 `summary / conclusion / confidence / evidence`）和 `tool-selection` 两种 taskType。
  - [ ] 确保下游 `buildToolOutputBlocks` 和 `extractStructuredConclusion` 不再需要手动 `as` 类型断言。
  - [ ] 补充对应的 schema 校验测试。

- [ ] 补齐 story 级验证（AC: 1, 2, 3, 4）
  - [ ] 验证 context extraction 结果能被 grounding 到 canonical definitions。
  - [ ] 验证 planner 读取 grounded context，而不是旧自由文本主路径。
  - [ ] 验证 tool selection 能消费正式 binding。
  - [ ] 验证 follow-up / replan 使用 grounded context 作为基线。

## Dev Notes

- `9.3` 是 Epic 9 第一次真正改运行时主链的 story。它要做的是“接线”，不是“重新发明 planner”。
- 这张 story 的核心价值是把现有系统从“语义增强”推向“本体约束驱动”。
- 如果做成只是多加一层 mapping helper，但 planner / tooling 仍然主要看自由文本，那这张 story就算没完成。
- 反过来，也不要一次把 execution、renderer、history 全部重写；本 story 只要求把主输入边界切换到 grounded context，并给后续 `9.6` 留出引用位。
- `9.2` 已经建立 governance definitions 与 transitional runtime projection，但当前首批 definitions 仍主要通过测试 seed 验证；`9.3` 必须把“运行库中如何正式装载 canonical definitions”补成受控 bootstrap，而不是继续依赖手工灌库或测试私有初始化。

### Review Adjustments

- 需要把 `grounding ambiguity` 的产品交互写成正式规则，而不是只停留在服务端错误语义：
  - `grounding success`：进入 planner
  - `grounding ambiguous`：阻断 planner，回到 workspace 让用户选择候选定义
  - `grounding failed`：阻断 planner，并显示明确的缺失原因
- 不允许在歧义场景下静默回退到自由文本主路径。若保留 transitional path，必须显式标记为 `temporary mitigation`，且默认关闭。
- `follow-up / replan` 接入 grounded context 时，建议把“自由文本 mergedContext”和“grounded context”明确并存，而不是互相覆盖。前者服务用户可读性，后者服务 planner/tooling 的正式输入。
- `metric-catalog.ts` 等 legacy runtime mapping 不应在 `9.3` 之后继续作为已治理对象的默认事实源；若某些未治理对象仍需共存，必须在 story 验证中明确列出范围，而不是长期模糊共存。

### Architecture Compliance

- 必须遵循 [ontology-governance-architecture.md]({project-root}/_bmad-output/planning-artifacts/ontology-governance-architecture.md#7.1 新的运行时主链)：
  - context extraction 后先 grounding
  - planner 只消费 grounded definitions
  - tool selection 只消费正式 binding
  - follow-up / replan 继承 grounded context
- 不要把 grounding 逻辑塞进页面、route handler 或 prompt registry；它属于正式 application / domain 边界。
- grounding 失败必须可诊断，不允许静默吞掉歧义后继续生成看似合理但其实无根的计划。
- 对 `9.2` 已治理完成的收费类口径与时间语义，`9.3` 应把 legacy catalog 降为兼容投影或逐步移除，而不是继续让 registry 与硬编码双主路径并存。

### Library / Framework Requirements

- 继续沿用现有 `Tool Registry + Orchestration Bridge`、`Worker + Redis` 主编排边界。
- 不引入 `LangGraph / LangChain / AutoGen / Google ADK` 作为解决 grounding 的方式。
- 继续沿用现有 structured output 与 Zod 风格约束，但 grounding 成功与否必须由 canonical definitions 判断，而不是由 prompt 文本自我宣称。
- bootstrap / initialize 流程可以复用当前 governance seed 定义，但必须通过正式 application / infrastructure 边界落库，不得把测试脚本直接当生产初始化方案。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-context/`
  - `src/domain/analysis-plan/`
  - `src/domain/ontology/`
  - `src/application/ontology/`
  - `src/application/analysis-planning/`
  - `src/application/analysis-execution/`
  - `src/infrastructure/tooling/index.ts`
  - `tests/story-9-3-*.test.mjs`
- 若需要扩展 execution / follow-up 模型字段，应在最小范围内改动，并明确哪些字段只是给 `9.6` 预留。

### Testing Requirements

- 至少覆盖：
  - grounding 成功路径
  - grounding 歧义/失败路径
  - planner 改为消费 grounded context
  - tool selection 改为消费 binding
  - follow-up / replan 基于 grounded context
  - canonical definitions bootstrap / initialize 的幂等与失败诊断
- 关键验证应偏 application / integration 级别，而不是只做纯函数测试。
- 对已治理对象，测试必须能证明默认运行时主路径不再优先依赖 legacy catalog；若仍存在 transitional path，测试中必须明确其启用边界。

### Previous Story Intelligence

- `9.1` 提供 canonical registry 与 version model；`9.3` 必须基于它，不得再引入第二套知识源。
- `9.2` 提供 metric / factor / time semantics / evidence type 的治理定义；`9.3` 的 grounding 与 binding 应消费这些定义，而不是重新推导一套。
- `9.2` 尚未把首批 canonical definitions 的正式装载流程做成运行时前提，因此 `9.3` 必须补齐 bootstrap / initialize，确保 grounding 依赖的 definitions 在真实开发/部署环境中存在。
- Epic 6 的 follow-up / replan 已经是真实可运行路径；这张 story 要把它们的“上下文事实源”升级为 grounded context，而不是重写多轮机制。

### Git Intelligence Summary

- 当前仓库已经具备真实 worker、tool registry、follow-up 和 history 主链。
- `9.3` 更适合通过“替换输入源和绑定方式”来演进，而不是推翻既有运行骨架。

### Latest Technical Information

- 当前 execution、follow-up、history 都已经是数据库事实，并有真实回放路径。
- 当前 tool registry 已能基于能力与健康状态选择工具，但仍缺少基于 ontology binding 的正式约束。
- 当前 context extraction / candidate factor / planner 仍然存在局部自由文本与隐式映射，这正是 `9.3` 要收敛的重点。

### Project Structure Notes

- `(admin)` 路由与治理后台仍不是本 story 范围。
- 本 story 不负责审批流和发布流程，那属于 `9.4`。
- 本 story 只需要为 `9.6` 留好 grounding 结果 / ontology version 的绑定位置，不要提前把历史体系整套重构。

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.3: Ontology Grounding 接入上下文、计划与工具选择]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#6.1 当前模块如何迁移到统一本体层]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#7. 运行时工作流如何改变]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#7.1 新的运行时主链]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#7.2 这会带来的直接收益]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#10. 建议实施顺序]
- [Source: _bmad-output/project-context.md#关键实现规则]
- [Source: _bmad-output/implementation-artifacts/9-1-minimal-ontology-registry-and-version-model.md]
- [Source: _bmad-output/implementation-artifacts/9-2-govern-metric-variant-factor-and-time-semantics.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Completion Notes List

- Story created as the runtime-connection phase of Epic 9, intentionally focused on grounding and binding rather than governance UI or approval workflow.
- Scope intentionally excludes full ontology version persistence in history records; final binding is deferred to Story 9.6.

### File List

- _bmad-output/implementation-artifacts/9-3-ontology-grounding-for-context-planning-and-tool-selection.md
