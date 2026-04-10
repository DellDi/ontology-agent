# Story 10.1: 建立 AI Application Runtime Layer 与 Vercel AI SDK Adapter

Status: ready-for-dev

## Story

As a 平台前端团队,  
I want 在 Next.js / application 边界建立 AI Application Runtime Layer，并用 `Vercel AI SDK` 承接 stream transport、UI message lifecycle、resume/projection 基础能力与 tool runtime bridge,  
so that 现有 execution events、result blocks 和 follow-up 历史可以稳定映射为统一交互消息，并为未来 memory / knowledge / skills / tools runtime 预留正式接入面，而不是继续由页面手工拼接。

## Acceptance Criteria

1. 当分析会话进入流式执行阶段时，系统必须通过正式的 runtime adapter 将现有 `AnalysisExecutionStreamEvent`、`AnalysisExecutionSnapshot`、`AnalysisConclusionReadModel` 映射为统一的 AI interaction 消息与 parts；页面层不再直接承担底层 SSE 事件合并、消息拼装和状态派生逻辑。
2. 当 `Vercel AI SDK` 被引入时，它只能位于 Next.js / application 之间的 AI application runtime layer，负责 UI message lifecycle、stream transport、tool runtime bridge、resume/projection 接线；它不得替代 execution planning、Worker orchestration、execution truth、result persistence 或 ontology governance。
3. 当用户在 PC 工作台刷新页面、重新进入会话或从历史轮次切回当前轮次时，系统必须能够从服务端已有 execution snapshot / follow-up history / result blocks 重建交互视图的 projection；重建过程不得修改 canonical truth，也不得要求页面保存独立于服务端事实的第二套协议。
4. 当 runtime layer 暴露工具能力时，系统必须提供统一的 tool runtime bridge，使后续 tool calling、tool approval、memory、knowledge resources、skills prompts 与外部工具接入能够沿同一 runtime 边界扩展；但在本 story 中不得把这些能力真正实现成新的治理系统或新的业务事实源。
5. 当现有 `stream route` 与 `live shell` 被接入 runtime layer 后，系统仍应保留现有 SSE / EventSource 传输模式与已验证的执行流行为，确保 `5.2 / 5.4 / 6.4` 已建立的执行、持久化与历史回放语义不回退。

## Tasks / Subtasks

- [ ] 建立 AI application runtime 的应用层契约与投影模型（AC: 1, 3, 4）
  - [ ] 在 `src/application/` 下新增 runtime 相关模块，定义用于消息、parts、projection、resume 和 tool bridge 的正式接口。
  - [ ] 把现有 `AnalysisExecutionStreamEvent`、`AnalysisExecutionSnapshot`、`AnalysisConclusionReadModel` 作为输入源，而不是复制成新的事实模型。
  - [ ] 明确 runtime 层只负责“映射与投影”，不负责执行编排、结果持久化或 ontology 治理。

- [ ] 建立 `Vercel AI SDK` 适配层并接入现有流式路径（AC: 1, 2, 5）
  - [ ] 在 `src/infrastructure/` 下实现 SDK adapter，将应用层 runtime contract 转成 SDK 需要的消息 / parts / stream 形态。
  - [ ] 让 `src/app/api/analysis/sessions/[sessionId]/stream/route.ts` 继续作为服务端 transport edge，但将事件到 UI 的语义转换下沉到 runtime adapter。
  - [ ] 让 `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx` 从“手工合并事件”演进为“消费 runtime projection”，避免页面继续维护底层流协议细节。

- [ ] 定义 resume / projection 边界与回放规则（AC: 3, 5）
  - [ ] 复用现有 execution snapshot、follow-up history 和 conclusion read model 作为 resume 输入。
  - [ ] 明确 projection 仅用于恢复 UI message lifecycle 与交互状态，不写回 execution truth。
  - [ ] 保留当前 SSE、事件顺序和完成态关闭策略，确保历史回放与实时续流行为一致。

- [ ] 建立统一 tool runtime bridge 的最小骨架（AC: 2, 4）
  - [ ] 提供可扩展的 tool bridge 接口，承接未来 tool invocation、approval、memory、knowledge resources、skills prompts 与外部工具接入。
  - [ ] 当前只实现最小可用转接面，不把 bridge 直接连成新的 worker 编排层。
  - [ ] 在代码和注释中标明：tool bridge 不是 ontology registry，也不是 execution orchestration。

- [ ] 补齐 story 级验证与回归保护（AC: 1, 2, 3, 5）
  - [ ] 为 runtime mapping、resume projection 和 adapter 边界新增 `tests/story-10-1-*.test.mjs`。
  - [ ] 验证 runtime adapter 能消费现有 execution events，并输出稳定的消息 / parts 投影。
  - [ ] 验证刷新、切轮次或重新进入会话时，交互层恢复的是 projection 而不是新的事实。
  - [ ] 验证引入 runtime layer 后，已有 SSE 流、快照持久化与历史回放语义不被破坏。

## Dev Notes

- Story 10.1 是 Epic 10 的基础层，目标是把“当前已经存在的执行事实”正规化为 AI application runtime layer，而不是重做执行内核。
- 当前仓库已经具备这些事实基础：
  - `stream-models.ts` 中的执行事件 envelope 与 render blocks
  - `stream route` 的 SSE 传输
  - `AnalysisExecutionLiveShell` 的 EventSource 消费模式
  - `analysis-execution` persistence / history / conclusion read model
- Story 10.1 的正确位置是 `Next.js application` 与现有执行核心之间的运行时适配层。它应该帮助页面更轻地消费消息与 parts，但不应该把 Worker、Redis、Postgres snapshot 或 ontology governance 重新包装成 UI 逻辑。
- `Vercel AI SDK` 在本项目中的定位只能是“交互层运行时”，不是系统编排底座，也不是业务真相层。
- 未来的 memory / knowledge / skills / tools runtime 只应通过这个 story 建立的统一接入面扩展。当前 story 只负责把边界画出来，不负责完成这些能力本身。
- runtime adapter 输出的 `message / part / projection` 必须与 Epic 10 UX 增补定义的交互语法一致，尤其要支撑 `Primary Narrative Lane`、`Context Rail`、`Action Layer` 这种固定空间语义，而不是只输出一组无顺序的块。
- runtime layer 需要为 `status-banner`、`step-timeline`、`evidence-card`、`conclusion-card`、`resume-anchor` 等 foundation parts 提供稳定映射顺序，这会直接决定后续 10.2/10.3/10.5 能否复用同一套语法。
- 不允许出现以下实现倾向：
  - 用 runtime layer 替代 Worker orchestration
  - 用 SDK 适配层替代 execution truth
  - 用 UI projection 替代结果持久化
  - 用交互协议替代 ontology governance
- 当前已验证的 `5.2 / 5.4 / 6.4` 语义必须保持：
  - 执行事件按序流式发布
  - 结果块和快照可持久化
  - 历史轮次和最新轮次可并存
  - 刷新或回看时不会串页

### Review Adjustments

- 建议在 story 开头增加实施前置：`9.1 ~ 9.3` 至少应完成到“canonical ontology + grounding 主路径可用”，否则 Epic 10 容易先长出一套 runtime semantic center。
- 需要补一张 ownership matrix，最少回答 4 个问题：
  - 谁生成 message / part
  - 谁持久化 projection
  - 谁负责 history round 切换
  - 谁负责 part schema 版本兼容
- `runtime message / part / projection` 必须被定义为交互协议，而不是业务语义协议；业务语义仍以上游 ontology / grounded context 为准。

### Recommended Implementation Order

1. 先冻结边界与命名，再写代码骨架。
   - 先在 `src/application/ai-runtime/` 定义 runtime contract、message/part projection、resume input 和 tool bridge interface。
   - 这一阶段不要接 SDK、不要改 UI，只先确认“输入是现有 execution facts，输出是 runtime projection”。
   - 检查点：团队能明确回答 runtime layer 不负责什么，尤其是不负责 Worker orchestration、snapshot persistence 和 ontology governance。
2. 再做纯映射层，把现有事实稳定投影成 runtime message。
   - 先实现从 `AnalysisExecutionStreamEvent`、`AnalysisExecutionSnapshot`、`AnalysisConclusionReadModel` 到统一 message/parts 的 mapper。
   - 优先处理当前已存在的事件与 block 类型，不要一开始就把未来 memory/skills/tool approval 全塞进第一版。
   - 检查点：不用接 UI，也能在测试里证明同一份 execution facts 会产出稳定 projection。
3. 然后接 `Vercel AI SDK` adapter，但只接在 infrastructure 层。
   - 在 `src/infrastructure/ai-runtime/` 把 application contract 映射到 SDK 所需结构。
   - 保持 `stream route` 仍是 transport edge，adapter 只负责语义转换，不改 Redis/SSE 事实来源。
   - 检查点：即使临时移除 UI，服务端 adapter 仍能独立工作，且没有把 SDK 反向渗透进 domain/application 事实层。
4. 接着替换 `live shell` 消费方式，而不是重写整个工作台。
   - 只把 `analysis-execution-live-shell.tsx` 从“手工合并事件”切成“消费 runtime projection”。
   - `stream route` 先保持兼容，不要同一轮同时大改 route、panel、history、mobile。
   - 检查点：当前 PC 主工作台还能流式工作，且 completed 收束、切回历史、重新进入会话都不回退。
5. 最后补 resume/projection 和最小 tool bridge 骨架。
   - resume 先只做“从已有 snapshot/history/conclusion 重建 projection”的最小闭环。
   - tool bridge 先只定义接口和最小转接面，为 10.4 预留，不提前实现完整 approval/memory/skills 系统。
   - 检查点：projection 恢复不改写 canonical truth；tool bridge 存在但不会诱导团队把 10.1 做成半套 agent framework。
6. 以 story 级回归测试收尾，再决定是否推进 10.2。
   - 先跑 `tests/story-10-1-*.test.mjs`，再补看 `5.2 / 5.4 / 6.4` 是否被 runtime 接入影响。
   - 如果 10.1 还没证明“旧事实不回退、页面负担变轻、边界更清晰”，就不要急着进入 10.2 的 rich renderer 扩展。

### First-Implementation Cut

- 第一刀建议只交付这 4 个最小结果：
  - application 层 runtime contract
  - execution facts -> runtime messages 的 mapper
  - infrastructure 层 AI SDK adapter
  - `live shell` 改为消费 runtime projection
- 这些做完，就已经能证明 Epic 10 的路线成立，同时不会过早卷入 renderer registry、projection persistence、memory bridge 或 mobile surface 的复杂度。
- 这第一刀的输出必须已经足够支撑主画布的基本叙事顺序：`status -> timeline -> evidence -> conclusion -> action`。如果 runtime 输出还不能稳定支持这条顺序，就说明 contract 还没站稳。

### Sequencing Risks To Avoid

- 不要第一步就安装 SDK 后直接在页面里接 `useChat` 或等价 hook，这会把边界重新拉回 UI 层。
- 不要把 projection persistence 提前混进 10.1 的首轮落地，否则很容易和 10.3 重叠。
- 不要在 10.1 首轮里定义过宽的 tool/memory/skills 数据模型，当前只需要 bridge interface，不需要产品化治理结构。
- 不要为了“看起来更 AI native”去改 execution truth；正确方向是先做 adapter，再让后续 stories 消费它。

### Architecture Compliance

- 必须遵守 `domain -> application -> infrastructure -> app` 分层，runtime contract 与 projection 逻辑优先放在 application 层，SDK 只做 infrastructure adapter。
- 必须保持现有 execution truth：`execution events / snapshots / follow-up history / conclusion read model` 仍然是 canonical source of truth。
- 必须把 `stream route` 视为 transport edge，而不是业务编排层。
- 必须把 `live shell` 视为 runtime consumer，而不是协议发明者。
- 必须预留未来 memory / knowledge / skills / tools runtime 接口，但不得把它们混成 ontology governance 或 worker orchestration。
- 必须保留浏览器不直连核心数据源的边界，所有 runtime 适配仍然走服务端受控边界。

### Library / Framework Requirements

- 采用 `Vercel AI SDK` 作为 AI application runtime layer 的正式交互运行时实现。
- 继续沿用现有 `Next.js 16 App Router`、`React 19`、`TypeScript 5`、`Zod 4`、`SSE`、`EventSource` 和当前 server-side auth 边界。
- 不引入 `LangChain`、`LangGraph`、`AutoGen`、Google ADK 作为本 story 的系统底座。
- 不把 `Vercel AI SDK` 升级为 execution planner、worker scheduler、knowledge governor 或 ontology registry。
- 如需模型接线，仍应复用现有服务端 `LLM Provider Adapter` 边界，而不是让客户端直接掌控 provider 细节。

### File Structure Requirements

- 预期新增或调整的重点路径：
  - `src/application/ai-runtime/`
  - `src/infrastructure/ai-runtime/`
  - `src/app/api/analysis/sessions/[sessionId]/stream/route.ts`
  - `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx`
  - `tests/story-10-1-ai-application-runtime-layer.test.mjs`
- 如果 runtime contract 需要共享类型，优先放在 `src/application/ai-runtime/`，不要直接塞进 route 或 component。
- 如果需要复用现有 execution 事实模型，请直接依赖 `src/domain/analysis-execution/stream-models.ts`、`src/domain/analysis-result/models.ts` 和 snapshot / follow-up 相关 application use cases。
- 不要在 `app` 层重新发明一套独立消息协议来绕开 canonical event / snapshot 模型。

### Testing Requirements

- 必须新增 story 级测试，至少覆盖：
  - runtime adapter 能把现有 execution events 映射为稳定的消息 / parts 投影
  - stream route 仍能完成受保护会话的 SSE 输出
  - live shell 能消费 runtime projection，并在 completed 终态正确收束
  - resume / projection 只恢复 UI 状态，不改写 canonical truth
- 需要按项目现有习惯串行执行 story 测试，优先使用 `node --test --test-concurrency=1 tests/story-10-1-*.test.mjs`。
- 交付前仍应跑与影响范围匹配的 `pnpm lint` 与 `pnpm build`，并确认现有 `5.2 / 5.4 / 6.4` 回归不被破坏。
- 若引入 SDK 适配层导致事件形态变化，必须证明 `stream route`、历史回放和持久化快照仍能读到原有事实。

### Previous Story Intelligence

- `Story 9.1` 已经把 canonical ontology registry、版本模型和治理边界站稳；Story 10.1 必须消费这些治理事实，而不是把 runtime projection 变成新的知识事实源。
- `Story 6.4` 已证明多轮历史、结论演化和轮次切换都属于服务端事实层能力；Story 10.1 只能在此基础上建立 UI/runtime projection，不能反向改写历史语义。
- `Story 5.2` 与 `Story 5.4` 已建立执行流与快照持久化的基础语义；本 story 的 runtime layer 必须延续这些语义，而不是另起一套消息或结果协议。
- 这条线的正确推进方式始终是：先站稳事实，再补 runtime，再补 projection，再补更复杂的交互接入。

### Git Intelligence Summary

- 最近提交体现出明确的工程节奏：先用正式文档和故事收敛边界，再用实现和测试把边界坐实。
- 最近 5 个提交的信号如下：
  - `ba75702403d36556ea0b2a3827765680d85ddbd1` `📝 docs: 新增 Epic 9 统一本体层与知识治理规划`
  - `617528ed22e66206dc700b6ba964c2d846e56417` `📝 docs: 完成 Epic 6 并更新项目上下文与测试基础设施`
  - `2e1d4a23501ee227bc0b93a1d441cb15790edd9b` `✅ feat: 完成 Story 6.4 多轮历史保留与结论演化功能`
  - `89e451cce7af8ae90c1fdb4afc8dc5d0b95bed3f` `📝 docs: 完成 Epic 6 追问功能核心 Stories 开发`
  - `2cbbc64b8fefb8f05ed0d9a26e8506faf448c587` `🔧 refactor: 修复追问链路承接与计划执行逻辑`
- 这些提交共同说明：本仓库偏好把交互、历史和治理边界写成正式层，再通过测试验证，不接受页面临时拼协议的做法。
- Story 10.1 应延续同样的节奏，优先定义 runtime contract 与 adapter，而不是先在 UI 里堆行为。

### Latest Technical Information

- 当前仓库尚未引入 `ai` 或 `@ai-sdk/*` 依赖；`package.json` 中目前可见的是 `openai`，说明 `Vercel AI SDK` 仍属于新增正式能力，而不是既有底座。
- 当前流式交互仍由自有 SSE 路线承载：
  - `src/app/api/analysis/sessions/[sessionId]/stream/route.ts` 负责从 Redis 事件流向 SSE 输出
  - `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx` 通过 `EventSource` 消费流并更新界面
- 当前执行事件模型已经支持：
  - `execution-status`
  - `step-lifecycle`
  - `stage-result`
  - `status / kv-list / tool-list / markdown / table` 等 render blocks
- 当前持久化语义已经支持：
  - `resultBlocks`
  - `mobileProjection`
  - `failurePoint`
  - `conclusionState`
  - 按 session / execution / owner 维度回看
- 当前测试事实已经证明：
  - `5.2` 能稳定发布和读取流式执行事件
  - `5.4` 能稳定持久化执行快照、结果块与移动端投影
  - `6.4` 能稳定保留多轮历史并区分当前轮次与历史轮次

### Project Structure Notes

- 项目仍是 `web + worker` 的模块化单体，`Epic 10` 应被放在“应用运行时层”而不是“执行内核层”。
- `app` 层目前已经承担受保护页面、Route Handlers 和流式交互入口，Story 10.1 应减少这些层的协议细节，而不是继续扩大它们的职责。
- `Epic 9` 负责 ontology / knowledge governance；`Epic 10` 负责 interaction runtime / rendering。两者必须协作，但绝不能互相替代。
- PC 工作台是主战场，移动端只是后续同源投影的消费者。Story 10.1 的 runtime contract 必须先满足 PC，再为移动端预留同源能力。
- 当前实现中最容易失控的点是把 UI 投影、消息协议和执行事实混在一起；这份 story 必须在文字层面先把这个边界写死。

## References

- [Source: Epic 10 in epics.md]({project-root}/_bmad-output/planning-artifacts/epics.md)
- [Source: Story 10.1 in epics.md]({project-root}/_bmad-output/planning-artifacts/epics.md)
- [Source: current AI SDK decision in architecture.md]({project-root}/_bmad-output/planning-artifacts/architecture.md)
- [Source: Vercel AI SDK introduction boundary in architecture.md]({project-root}/_bmad-output/planning-artifacts/architecture.md)
- [Source: AI Interaction Rendering Layer in architecture.md]({project-root}/_bmad-output/planning-artifacts/architecture.md)
- [Source: FR-17 in prd.md]({project-root}/_bmad-output/planning-artifacts/prd.md)
- [Source: sprint-change-proposal-2026-04-09-vercel-ai-sdk.md]({project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09-vercel-ai-sdk.md)
- [Source: ux-epic-10-ai-native-interaction-addendum.md]({project-root}/_bmad-output/planning-artifacts/ux-epic-10-ai-native-interaction-addendum.md)
- [Source: ux-epic-10-main-canvas-wireframes.md]({project-root}/_bmad-output/planning-artifacts/ux-epic-10-main-canvas-wireframes.md)
- [Source: project-context.md]({project-root}/_bmad-output/project-context.md)
- [Source: Story 9.1]({project-root}/_bmad-output/implementation-artifacts/9-1-minimal-ontology-registry-and-version-model.md)
- [Source: stream route]({project-root}/src/app/api/analysis/sessions/[sessionId]/stream/route.ts)
- [Source: live shell]({project-root}/src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx)
- [Source: stream models]({project-root}/src/domain/analysis-execution/stream-models.ts)
- [Source: story-5-2]({project-root}/tests/story-5-2-execution-stream.test.mjs)
- [Source: story-5-4]({project-root}/tests/story-5-4-persist-results.test.mjs)
- [Source: story-6-4]({project-root}/tests/story-6-4-preserve-multi-round-history.test.mjs)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story authored from approved Epic 10 change proposal and current runtime evidence.
- No code was modified outside the target story file.
- Implementation work is intentionally deferred; this document is the ready-for-dev handoff only.

### Completion Notes List

- 明确 Story 10.1 只负责 AI application runtime layer、Vercel AI SDK adapter、UI message lifecycle、stream transport、tool runtime bridge、resume/projection 边界。
- 明确 canonical truth 仍然是 execution events、snapshots、follow-up history、result blocks 和 ontology governance。
- 明确 future memory / knowledge / skills / tools runtime 只预留接入面，不在本 story 中落成新的治理系统。

### File List

- {project-root}/_bmad-output/implementation-artifacts/10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md
