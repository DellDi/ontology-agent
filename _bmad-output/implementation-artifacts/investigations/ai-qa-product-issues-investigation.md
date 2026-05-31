# Investigation: AI 智能问答产品化问题

## Hand-off Brief

1. **What happened.** 用户截图显示 AI 问答主结果、追问、历史、多面板诊断里暴露了内部英文标识、重复统计卡片、混乱状态和未闭合执行状态；源码确认这些主要来自 projection/UI 展示层把执行事实直接展开。
2. **Where the case stands.** Active；已确认主画布只渲染单个当前 question/answer、执行详情逐条展示 raw events、候选因素直接暴露 graph edge 字段、按月追问没有映射到 semantic query granularity。
3. **What's needed next.** 进入修复阶段：先收敛主阅读流与追问线性消息，再重做工具/候选因素/诊断的用户向投影。

## Case Info

| Field | Value |
| --- | --- |
| Ticket | N/A |
| Date opened | 2026-05-31 |
| Status | Active |
| System | Windows / PowerShell workspace, Next.js 16 project |
| Evidence sources | 用户截图与描述、项目上下文、源代码、story artifacts |

## Problem Statement

用户报告当前 AI 智能问答过程存在六类产品问题：资源记录数重复且英文难懂；追问未形成线性聊天历史且月份展开被错误拒绝；历史问答界面布局混乱；候选因素全英文且含疑似工单编号等未产品化内容；详情信息面板执行事件重复且长时间停留执行中；诊断信息阶段完成、执行中、候选验证结论混杂且没有给出真实结论。

## Evidence Inventory

| Source | Status | Notes |
| --- | --- | --- |
| 用户截图 | Available | 截图中可见重复 stats、英文 ontology id、候选因素英文关系、执行状态重复、诊断状态混杂 |
| 项目上下文 | Available | `_bmad-output/project-context.md` 明确要求 runtime projection/renderer 为同源事实投影，主阅读流展示结论/证据，过程面板可隐藏 |
| 源代码 | Available | 已定位 UI renderer、projection、follow-up/history、event stream 聚合、tool presentation 与 semantic query input builder |
| 运行数据与日志 | Missing | 尚未读取本地数据库/Redis/job ledger；无法确认具体某次执行事实是否已写错 |

## Investigation Backlog

| # | Path to Explore | Priority | Status | Notes |
| - | --- | --- | --- | --- |
| 1 | 定位重复资源卡片来源 | High | Done | `tool-event-presentation` 输出 ERP 资源/记录数 kv-list，`conversation-view-model` 把所有 kv-list 抽成 metricCards |
| 2 | 定位追问历史与当前轮结果投影 | High | Done | `page.tsx` 传给 live shell 的 questionText 固定是 session 初始问题，shell 只渲染一组 user/assistant |
| 3 | 定位月份展开失败原因 | High | Done | semantic query 支持 granularity，但 tool-input-builder 没从追问解析/传递 `granularity: month` |
| 4 | 定位候选因素英文暴露来源 | Medium | Done | Candidate panel 直接展示 relationType/direction/source，Neo4j adapter 返回英文 edge/source |
| 5 | 定位执行/诊断状态混杂来源 | High | Done | worker 同时发布 step-started、step-lifecycle、tool、step-completed、stage-result，execution panel 逐条 raw event 渲染 |
| 6 | 定位历史问答布局问题 | Medium | Done | history panel 在 drawer 内使用 viewport `xl:grid`，窄抽屉中被挤压 |

## Timeline of Events

| Time | Event | Source | Confidence |
| --- | --- | --- | --- |
| 2026-05-31 | 用户报告 AI 问答产品化问题并提供六张截图 | 当前对话 | Confirmed |

## Confirmed Findings

### Finding 1: 主对话不是线性 message list，而是单轮 view model

**Evidence:** `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx:714` 只渲染一个 `AnalysisUserMessage` 和一个 `AnalysisAssistantMessage`；`src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx:517` 传入的 `questionText` 固定为 `analysisSession.questionText`。

**Detail:** 即使 active follow-up 已经存在，主画布的用户气泡仍使用初始问题；follow-up 历史只作为 drawer 内容传入，而没有成为主阅读流中的下一组 message。

### Finding 2: 重复资源/记录数卡片来自内部工具 kv-list 被当成业务指标卡

**Evidence:** `src/shared/tooling/tool-event-presentation.ts:118` 为 `erp.read-model` 输出 `资源/记录数` kv-list；`src/application/analysis-message-projection/conversation-view-model.ts:519` 从所有 kv-list 抽取 metricCards；`src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx:433` 直接展示 metricCards。

**Detail:** ERP 工具返回的 `resource=projects/count=287` 是内部读取摘要，不是用户要看的业务指标。多个阶段或多次工具调用会生成多个同类 kv-list，于是出现重复卡片。

### Finding 3: 按月份展开不是数据层不支持，而是追问意图没有进入语义查询参数

**Evidence:** `src/application/semantic-query/models.ts:61` 已有 `granularity`；`src/infrastructure/cube/cube-semantic-query-adapter.ts:86` 会把 request granularity 传给 Cube；但 `src/application/analysis-execution/tool-input-builder.ts:289` 构造 `cube.semantic-query` 时只传 metric/scope/dateRange/groupBy/filters/limit，没有解析或传入 `granularity: 'month'`。

**Detail:** 当前追问“按照月份展开”会继承原问题年份上下文，但没有形成“按月粒度”查询。LLM 看到的工具证据仍是年度聚合结果，因而生成“当前数据不支持按月份展开”的错误业务结论。

### Finding 4: 候选因素面板直接暴露图谱边字段和原始节点标识

**Evidence:** `src/app/(workspace)/workspace/analysis/[sessionId]/_components/candidate-factor-panel.tsx:43` 直接显示 `relationType/direction/source`；`src/application/factor-expansion/use-cases.ts:23` 直接把 graph factor 字段映射到 read model；`src/infrastructure/neo4j/neo4j-graph-adapter.ts:159` 返回 `has-service-order/outbound/erp-derived` 等英文治理字段。

**Detail:** 这些字段适合审计和专家诊断，不适合直接作为客户界面的“可能原因”。工单编号类 factorLabel 也可能来自 fallback `serviceOrder.id`，没有被归并成“工单履约记录/投诉工单信号”这类业务方向。

### Finding 5: 详情/诊断状态混杂来自 raw event 逐条展示，而不是按阶段状态归并

**Evidence:** `src/worker/handlers.ts:123` 到 `src/worker/handlers.ts:280` 对每个步骤发布 step-started、step-lifecycle、tool-started/tool-completed、step-completed、stage-result；`src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx:79` 对 `events.map` 逐条渲染；`src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx:17` 对没有终态字段的事件默认显示“执行中”。

**Detail:** 同一业务步骤被多种事件表达，UI 没做 stage reduce，所以用户看到多张“确认分析口径/执行中/已完成”。这不是用户流程真实重复，而是事件协议与展示层边界没收敛。

### Finding 6: 历史问答抽屉布局使用 viewport 断点，导致窄侧栏被挤压

**Evidence:** `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx:662` drawer 最大宽度 560px；`src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx:55` 在 `xl` 断点使用 `320px + 1fr` 双列。

**Detail:** `xl` 是视口断点，不是 drawer 容器断点。大屏打开 560px 抽屉时仍可能触发双列，右侧详情列被挤成极窄空间，出现截图里的竖排/拥挤效果。

## Deduced Conclusions

### Deduction 1: 用户看到的混乱主要不是“AI 不会分析”，而是事实层、投影层、展示层责任没有切开

**Based on:** Finding 1, Finding 2, Finding 4, Finding 5。

**Reasoning:** 代码中已经有 execution events、result blocks、follow-up/history facts 和 projection，但当前 UI 同时把面向机器的 execution renderBlocks、图谱边字段、工具摘要、最终结论都放进同一阅读面。主画布没有 message list，抽屉又直接展示 raw events。

**Conclusion:** 修复重点应是新增用户向 presentation/read model，而不是继续让组件层过滤更多字符串。

### Deduction 2: “无法按月份展开”是查询参数表达缺失，不应作为用户结论

**Based on:** Finding 3。

**Reasoning:** 系统类型和 Cube adapter 都支持 granularity，只有 follow-up/context/tool input 链路没有把“按月份展开”映射进去。因此应该修链路，而不是告诉用户数据不支持。

**Conclusion:** 需要在 follow-up intent/context 中增加 granularity/drilldown 语义，并在 `cube.semantic-query` 输入中传递。

## Hypothesized Paths

### Hypothesis 1: runtime projection 把内部执行 facts 直接投到了终端用户主界面

**Status:** Open

**Theory:** 资源、ontology id、候选因素、事件状态等内部事实缺少面向用户的 presentation adapter，导致英文技术字段直接暴露。

**Supporting indicators:** 用户截图中出现 `Ontology grounded-context`、`has-service-order`、`outbound`、`erp-derived`、`Project -> ServiceOrder` 等内部字段。

**Would confirm:** renderer/projection 直接读取 raw facts 或 diagnostic metadata 并渲染。

**Would refute:** 已有中文 presentation model，但运行数据本身缺 label 或转换失败。

**Resolution:** 待源码验证。

### Hypothesis 2: event stream 聚合缺少幂等与终态归并，导致执行中/已完成重复混杂

**Status:** Open

**Theory:** worker 多次写入相同 stage/step/event，UI 按事件列表逐条展示，没有按 stage key 折叠，也没有以 snapshot/final status 覆盖旧 running 状态。

**Supporting indicators:** 截图显示相同“确认分析口径”多次出现，同时存在“执行中”和“已完成”。

**Would confirm:** execution event projection 使用 append-only list 直接渲染，缺少 event key/stage key 去重与 terminal status reduce。

**Would refute:** 数据库中确实存在多个不同 stage，但文案/时间相同造成误读。

**Resolution:** 待源码验证。

### Hypothesis 3: follow-up 主阅读流未按 round/message 建模，只把追问结论挂到历史侧栏或替换当前结果

**Status:** Open

**Theory:** 多轮历史存在，但主内容区没有渲染完整轮次消息链；追问结果被当成独立结论卡或侧边 timeline，而不是线性 conversation turns。

**Supporting indicators:** 用户看到历史面板有多轮历史，但主界面不能滚动查看第一次问题和第二次追问的完整问答。

**Would confirm:** UI 主区只渲染 latest projection/result blocks，而 history sheet 单独渲染 round list。

**Would refute:** 主区已有完整消息流，但某个 route/state resume bug 导致未加载。

**Resolution:** 待源码验证。

## Missing Evidence

| Gap | Impact | How to Obtain |
| --- | --- | --- |
| 具体 session/execution id 的数据库事实 | 区分事实写错还是投影展示错 | 读取 Postgres execution snapshots/result blocks/follow-up facts |
| Redis/job stream 实时事件 | 确认是否存在重复写事件 | 查看 worker event publisher 与 Redis stream |
| 本地复现截图对应数据 | 验证月份展开失败是否为 semantic query/tool issue | 跑相关 story 测试或复现用户 query |

## Source Code Trace

| Element | Detail |
| --- | --- |
| Error origin | 待定位 |
| Trigger | AI 问答主流程、follow-up、history side sheet、execution detail/diagnostic panels |
| Condition | 待定位 |
| Related files | 待定位 |

## Conclusion

**Confidence:** Medium

已从源码确认六类症状的主要生成机制。尚未读取截图对应的真实数据库/Redis 事件，因此不能确认某一次执行数据是否还存在额外写入错误；但当前代码路径足以解释截图中的主要产品问题。

## Recommended Next Steps

### Fix direction

1. 把主画布改成线性 conversation turns：初始问题/答案、每次追问/答案都作为同源 message list 渲染，历史抽屉只用于复盘和切换，不承担主叙事。
2. 新增用户向 result projection：只把业务指标、图表、结论、证据摘要放入主阅读流；ERP resource/count、tool strategy、ontology id、raw relation/source 进入专家诊断或审计面。
3. 为 follow-up 增加 drilldown/granularity 语义：识别“按月份展开/月度/按月看”，继承原 metric/entity/year，向 Cube 查询传 `granularity: 'month'`，并用月度表/折线图展示。
4. 把 candidate factors 做业务标签化和聚合：例如 `has-service-order/outbound/erp-derived` 不直接展示，转成“与该项目存在工单履约关联，建议查看工单量、投诉量、响应时长是否同步波动”。
5. 执行详情和诊断只展示 reduced stage summary：按 stepId/stageKey 折叠成一条最终状态，raw event list 放到专家模式，并确保 terminal snapshot/status 覆盖旧 running 事件。
6. 历史抽屉改为 drawer/container-aware 单列布局，避免在 560px 宽度里使用 `xl:grid` 双列。

### Diagnostic

补充目标测试：conversation 主画布多轮线性渲染；“按月份展开”生成 monthly Cube request；ERP kv-list 不进入 metric cards；candidate factor 不暴露英文 relation/source；execution panel 同一 step 只显示归并终态；history drawer 在 560px 宽度不触发双列挤压。

## Final Repair Target

### Ultimate Goal

把当前 AI 智能问答从“执行事件和内部工具结果的可视化页面”修复为“面向真实业务用户的线性、多轮、可解释、可追问的数据分析对话产品”。

完成后，用户在同一个会话里应能自然看到：

1. 自己提出的初始问题、每一次追问、每一轮回答，按时间顺序连续展示，可滚动复盘。
2. 每轮回答优先展示业务结论、关键指标、月度/维度展开结果、证据摘要和下一步可追问入口。
3. 内部执行事件、工具名、ontology id、graph edge、resource/count、raw event 等工程信息默认不进入主阅读流。
4. 诊断与详情面板只在需要时提供可理解的专业摘要；专家模式才展示 raw technical facts。
5. 对“按月份展开”“换个维度看”“继续追问”等问题，系统必须继承上一轮指标、实体、时间范围和 ontology version，并把新增意图转成正式查询参数，而不是重新猜测或返回不支持。
6. 所有状态展示必须有稳定终态：任务完成后不得继续显示“执行中”；同一步骤不得重复堆叠多张无意义卡片。

### Product Principles

- 主阅读流只服务业务理解，不展示内部实现细节。
- 内部事实不能丢，但必须进入诊断/审计/专家模式，而不是直接暴露给客户。
- 追问是同一会话的下一轮，不是侧边栏历史条目，也不是覆盖上一轮结果。
- 缺数据、查询失败、语义不支持必须 fail loud，并说明真实原因；不得把“参数没传对”伪装成“数据不支持”。
- 任何修复都必须沿现有 `execution facts -> runtime projection -> renderer` 链路推进，不能在页面组件里临时拼业务语义。

### Workstreams

| Stream | Goal | Primary Files / Areas | Priority |
| --- | --- | --- | --- |
| A. 线性多轮主画布 | 主区渲染完整 conversation turns，而不是单轮 current execution | `analysis-conversation-shell.tsx`, `conversation-view-model.ts`, `analysis-history/use-cases.ts`, `analysis-message-projection` | P0 |
| B. 追问语义与按月展开 | 把“按月份展开”映射为 `granularity: month` 并继承原上下文 | `follow-up-models.ts`, `tool-input-builder.ts`, `semantic-query`, Cube adapter tests | P0 |
| C. 用户向结果投影 | 过滤/重分类内部工具摘要，主结果只展示业务指标和证据 | `tool-event-presentation.ts`, `conversation-view-model.ts`, renderer registry | P0 |
| D. 候选因素产品化 | graph 字段中文化、聚合成业务候选方向，隐藏 raw edge/source | `candidate-factor-panel.tsx`, `factor-expansion/use-cases.ts`, `neo4j-graph-adapter.ts` | P1 |
| E. 执行/诊断状态归并 | 按 step/stage reduce，默认展示终态摘要，raw events 进专家模式 | `analysis-execution-stream-panel.tsx`, `analysis-diagnostics-panel.tsx`, `runtime-projection-mapper.ts` | P1 |
| F. 历史抽屉布局 | 历史面板在 560px drawer 内稳定单列，避免挤压竖排 | `analysis-history-panel.tsx`, drawer layout CSS | P2 |

### Acceptance Criteria

1. 多轮线性聊天
   - Given 用户先问“丰和园小区2026年的物业费收缴率是多少？”
   - When 用户追问“按照月份展开来看看”
   - Then 主画布按顺序展示初始问题、初始回答、追问问题、追问回答。
   - And 用户不打开历史抽屉也能看完整对话。

2. 按月份展开
   - Given 初始问题已识别为 `丰和园小区 + 2026年 + 物业费收缴率`
   - When 追问只说“按照月份展开来看看”
   - Then 系统继承原 metric/entity/year。
   - And Cube 查询请求包含 `granularity: 'month'`。
   - And 返回结果以月份表格或折线图展示。
   - And 如果确实没有月度数据，错误必须说明“查询返回 0 行 / 数据源缺字段 / Cube 返回错误”等真实原因。

3. 主结果不展示内部工具摘要
   - Given ERP 工具返回 `resource=projects,count=287`
   - Then 主阅读流不展示“资源 projects / 记录数 287”指标卡。
   - And 可在诊断/专家模式看到“已读取项目基础数据 287 条，用于项目匹配/范围校验”。

4. 候选因素可读
   - Given graph 返回 `has-service-order/outbound/erp-derived`
   - Then 用户界面展示业务语言，例如“工单履约关联”“投诉/响应/满意度可能影响收缴率，需要进一步验证”。
   - And 默认不展示英文 relation/source/direction。

5. 执行详情稳定
   - Given 同一步骤产生 step-started、tool-started、tool-completed、step-completed、stage-result
   - Then 默认详情面板只展示一条该步骤摘要和最终状态。
   - And execution completed 后不得存在可见“执行中”状态。

6. 诊断有结论
   - Given 系统进入“逐项验证候选因素”和“汇总归因判断”
   - Then 诊断面板必须说明每个候选因素的验证结果、证据、是否进入最终判断。
   - And 不得只展示阶段完成/执行中混杂状态。

7. 历史抽屉可用
   - Given 用户打开“历史问答”
   - Then 抽屉内容在当前宽度内单列或合理分区展示，不出现右侧极窄、竖排、横向滚动挤压。

### Verification Plan

必须至少补以下故事级或集成测试：

1. `story-ai-qa-linear-follow-up.test.*`：验证主画布多轮线性消息。
2. `story-ai-qa-monthly-drilldown.test.*`：验证追问“按月份展开”生成 monthly semantic query。
3. `story-ai-qa-productized-result-projection.test.*`：验证 ERP/Cube/Neo4j 内部块不会进入主结果。
4. `story-ai-qa-candidate-factor-presentation.test.*`：验证候选因素中文业务展示。
5. `story-ai-qa-execution-diagnostics-reducer.test.*`：验证执行详情按步骤归并且终态覆盖 running。
6. UI 截图/浏览器验证：主画布、候选因素抽屉、历史抽屉、诊断抽屉在桌面宽度下无布局挤压。

最终交付前至少运行：

- 相关 story tests
- `pnpm lint`
- `pnpm build`

## Reproduction Plan

使用用户输入“丰和园小区2026年的物业费收缴率是多少？”发起初始分析，再追问“按照月份展开来看看”，检查主消息流、历史面板、结果块、执行详情、诊断面板与候选因素。

## Side Findings

- 截图中的产品体验已偏离 `_bmad-output/project-context.md` 对 Epic 10 主阅读流与过程面板的要求。
- `src/application/analysis-message-projection/conversation-view-model.ts` 已有 Story 12-3 的“业务向视图字段”，但实际仍从 raw renderBlocks 抽 metricCards，缺少“哪些 kv-list 是业务指标”的契约。

## Follow-up: 2026-05-31

### New Evidence

### Additional Findings

### Updated Hypotheses

### Backlog Changes

### Updated Conclusion
