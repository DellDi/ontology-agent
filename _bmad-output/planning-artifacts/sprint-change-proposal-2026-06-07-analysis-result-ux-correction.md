# Sprint Change Proposal - 分析结果可信呈现修复

**项目：** ontology-agent  
**日期：** 2026-06-07  
**触发人：** delldi  
**变更类型：** Moderate course correction  

## 1. 问题摘要

当前分析会话页在真实业务使用中暴露出三个严重偏差：

1. 诊断信息面板把大量工程态信息和候选因素 ID 直接展示给业务用户，候选因素长期处于“未验证”状态，用户无法理解这些卡片代表什么，也无法判断系统是否真的继续执行。
2. 多轮追问按月份展开后，主结果中出现重复的“指标结果 / 候选因素”段落，且候选因素显示为单号、关系路径或内部 ID，无法形成业务可读解释。
3. 最终结果缺少真正面向用户的指标卡、趋势图、结构化表格、证据摘要和归因报告，结论看起来像从工具结果里拼出来，难以证明不是凭空捏造。

这直接冲突于 PRD 的 `FR-07 / FR-08 / FR-13 / FR-17`：系统必须展示可理解的执行过程、中间结果、带证据的归因结论，以及统一富渲染结果块。

## 2. 影响分析

### Epic Impact

**Epic 5：执行分析并输出归因结论**

- 当前不再满足“用户可以查看中间结果，并获得带证据的归因结论”。
- `buildAnalysisConclusionReadModel()` 当前从所有 completed stage-result 推导 cause，容易把“校验范围、查询指标、候选因素扩展”都排序成原因。
- 候选因素验证步骤没有产出逐因素 `validatedFactors` metadata，导致 UI 只能诚实标记为 `not-validated`，但这对业务用户不可理解。

**Epic 6：多轮追问、纠偏与重规划**

- 多轮线程虽然按 execution 分轮，但每轮没有携带独立的 candidate factor / conclusion cause / assumptions 上下文。
- 当前展开追问轮次时容易出现旧轮结果、新轮候选因素、重复 render block 混杂。

**Epic 10：AI 应用运行时与多端渲染层**

- Renderer registry 已存在，但结果投影仍把工程 block、工具 block 和用户结果 block 混在一起。
- 现有 visualizations/metricCards 提取过于机械，缺少 stable block 去重、业务优先级和 report-ready schema。
- 诊断抽屉没有区分“业务解释”和“工程诊断”，导致专家信息泄漏到普通用户体验。

### PRD / UX Conflict

- PRD 要求用户“不需要 SQL / Excel / 后台系统手工取数”，当前却让用户读 `Execution ID`、`Project -> ServiceOrder`、`BXGD...` 这类内部信息。
- UX 要求“解释优先于结论”“一次只关注一个判断层级”，当前页面变成多面板 debug dump。
- UX 要求“主视区完成关键判断”，当前关键判断缺少图表、指标卡和可读证据。

### Architecture Conflict

- Canonical facts 应来自 execution events / snapshots / result blocks，但当前 UI projection 没有足够区分事实类型。
- Renderer registry 只负责渲染，不应决定结果是否应该出现；现在 projection 层缺少业务投影治理，导致重复和泄漏。

## 3. 推荐方案

采用 **Direct Adjustment + 新增修复 Story**，不回滚 Epic 10 runtime/renderer。

理由：

- 现有架构方向是正确的：Worker、event stream、projection、renderer registry 都已经具备。
- 问题集中在执行结果语义、投影分类、候选因素验证和 UI 信息层级，不需要推翻底座。
- 但修复范围跨 Epic 5/6/10，不能作为零散 patch；需要形成一个明确故事包和验收标准。

## 4. 具体变更提案

### Story 新增：12.6 分析结果可信呈现与候选因素验证闭环

**As a** 物业分析用户，  
**I want** 看到业务可读的指标卡、趋势图、候选因素验证状态、证据摘要和归因报告，  
**So that** 我能判断系统为什么得出这个结论，并基于结果继续追问。

**Acceptance Criteria**

1. 主阅读流不得展示 `Execution ID`、事件数、序号、原始工具名、内部 relation path、未翻译 ID；这些只能在专家诊断中出现。
2. 候选因素必须展示业务名称、业务解释、数据来源、验证状态、证据摘要、下一步动作；不能只展示 `205199` 或 `BXGD...`。
3. `validate-candidate-factors` 步骤必须产出逐因素验证 metadata，至少包含：
   - `factorKey`
   - `factorLabel`
   - `businessExplanation`
   - `status`
   - `evidence`
   - `includedInConclusion`
   - `nextAction`
4. 若候选因素未验证，页面必须解释原因，例如“当前数据不足以验证该因素”，而不是只显示“未验证”。
5. 追问轮次必须按 execution 隔离 candidate factors、assumptions、conclusion cause ids 和 render blocks，不得跨轮混用。
6. 主结果必须至少包含：
   - 一句话结论
   - 关键指标卡
   - 趋势图或表格
   - 原因排序
   - 每个原因的证据摘要
   - 可追问建议
7. 重复的 `指标结果 / 候选因素` render block 必须按 stable identity 去重，不能在同一轮主结果中重复显示。
8. 所有图表 / 表格 / 证据卡必须通过 renderer registry 消费，不允许在页面层重新硬编码一套展示逻辑。

### Story 新增：12.7 多轮追问结果投影去重与轮次事实隔离

**As a** 物业分析用户，  
**I want** 追问月份、项目或因素时看到清晰的新一轮结果，  
**So that** 我不会把上一轮结果误认为本轮分析结论。

**Acceptance Criteria**

1. `buildConversationThreadViewModel()` 的每一轮必须接收并使用该轮自己的：
   - projection
   - events
   - candidateFactors
   - conclusionCauseIds
   - planAssumptions
   - ontologyVersion
2. 折叠轮次只显示该轮摘要，不展开重复指标表。
3. 展开当前轮次时，只显示当前 execution 的结果块。
4. 如果用户选择历史轮次，页面必须明确标注“历史回放”，不与当前追问执行混在一起。
5. 对同一 execution 内重复出现的结果块，按 `{kind, title, source.eventId, payload semantic key}` 去重。

### Story 新增：12.8 归因报告 schema 与业务可读 renderer

**As a** 数据分析负责人，  
**I want** 最终结果像一份简短分析报告，而不是工具日志，  
**So that** 我可以把结论交给业务负责人继续判断。

**Acceptance Criteria**

1. Worker 收尾阶段必须输出正式 `analysis-report` 或等价 rich block。
2. 报告至少包含：
   - 分析问题
   - 分析范围
   - 核心指标
   - 趋势摘要
   - 主要原因排序
   - 证据表格
   - 数据不足或假设说明
   - 建议追问方向
3. 如果 LLM 或工具未能形成可信归因，系统必须 fail loud 为“证据不足”，不能伪造成完整结论。
4. `buildAnalysisConclusionReadModel()` 不得把所有 stage-result 都当作原因；只能消费明确的 conclusion/report 事件或 metadata。

## 5. 文档修改建议

### PRD 修改

**FR-08 追加：**

归因结论不得仅由执行步骤名称或工具摘要拼接生成。系统必须把最终原因、证据、指标变化和数据不足说明组织成业务可读结果；如果证据不足，应明确标记为“暂不能形成归因结论”。

**FR-17 追加：**

统一渲染块必须区分 `business-result`、`supporting-evidence`、`diagnostic-only` 三类展示目的。普通业务用户主阅读流不得出现诊断专用 block。

### UX 修改

在“流式分析画布”和“诊断面板”中补充：

- 主画布只展示业务结果与可读证据。
- 诊断面板默认面向专家/开发调试，必须避免用“未验证”等短标签误导业务用户。
- 候选因素应显示业务解释与验证状态，而不是内部 ID。

### Architecture 修改

在 AI Interaction Rendering Layer 中补充：

- projection 层必须先做 semantic classification，再交给 renderer registry。
- renderer registry 只负责渲染，不负责判断 block 是否进入主阅读流。
- conclusion read model 必须只从明确的 conclusion/report fact 构建，不得从所有 stage-result 推断。

## 6. 实施顺序

1. **先修事实隔离与重复问题**
   - 修改 `conversation-thread-view-model.ts`
   - 修改 page 级 threadRounds 组装
   - 增加 story test 覆盖追问轮次不串数据

2. **再修候选因素验证**
   - 修改 worker / tooling 对 `validate-candidate-factors` 的 metadata 输出
   - 修改 `candidate-validation-model.ts`
   - 修改 `analysis-diagnostics-panel.tsx` 文案和结构

3. **再修最终结果可信呈现**
   - 修改 `buildAnalysisConclusionReadModel()`
   - 增加 `analysis-report` 或等价 rich block
   - 修改 conversation projection 的 block 分类与去重

4. **最后做 UI 验收**
   - 主阅读流截图验收
   - 追问月份展开验收
   - 诊断抽屉验收
   - story-based regression + build

## 7. 验收标准

完成后，截图中的三类问题必须全部消失：

- 不再出现用户看不懂的候选因素 ID 列表和“未验证”堆叠。
- 不再出现追问后重复的指标结果和候选因素区块。
- 最终结果必须有指标卡 / 趋势图或表格 / 证据摘要 / 归因报告。

验证命令建议：

```bash
node --test --test-concurrency=1 tests/story-12-candidate-validation-diagnostics.test.mjs tests/story-12-3-conversation-view-model-v2.test.mjs tests/story-12-5-worker-stream-events.test.mjs
pnpm lint
pnpm build
```

后续应新增：

```bash
tests/story-12-6-analysis-result-trustworthy-presentation.test.mjs
tests/story-12-7-follow-up-result-dedup-and-turn-isolation.test.mjs
tests/story-12-8-attribution-report-render-block.test.mjs
```

## 8. Handoff

**变更范围：** Moderate  

**执行角色：**

- Developer agent：实现 12.6 / 12.7 / 12.8 代码与测试。
- Product / UX reviewer：用真实截图验收业务可读性。
- Architect reviewer：确认 conclusion/read-model 与 projection 分类没有污染 canonical truth。

**建议下一步：**

先实施 Story 12.7，因为它直接修复追问重复和事实错配；随后实施 12.6；最后实施 12.8，补齐最终报告能力。

