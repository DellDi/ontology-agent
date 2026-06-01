# AI 问答产品化问题调查报告 — 多团队评审报告

> **评审方式**：14 agents 并行，5 阶段工作流（证据核验 → 架构审查 → 缺口分析 → 可行性评估 → 综合评定）
> **评审耗时**：约 8 分钟，194 次工具调用
> **评审日期**：2026-06-01
> **调查质量评分：8.5 / 10**

---

## 总体评价

报告是一份**高质量的功能问题诊断书**，但不是一份完整的**产品化交付清单**。

**优点：**
- 六个 Finding 全部通过源码精确验证，证据链完整、行号引用准确、因果关系清晰
- Finding-2（kv-list 误分类）和 Finding-5（事件逐条渲染）的链路追踪，从数据产出到最终展示形成完整闭环
- 架构方向建议整体合理，优先级排序得当

**扣分点：**
- **根因挖掘深度不均**：Finding-3（granularity 缺失）仅定位到 tool-input-builder 的组装遗漏，未深入揭示 domain 层 `AnalysisContext` 本身缺少该字段这一更根本的建模缺陷
- **非功能性缺口覆盖滞后**：对 Redis 原子性、SSE 无限轮询、LLM 调用无超时、无 rate limiting 等生产级可靠性问题完全未涉及
- **无障碍性几乎为零关注**：28 项 UX 缺口中 8 项涉及无障碍性（焦点陷阱缺失、零 ARIA、色盲不友好），初始报告毫无提及

> **一句话总结**：报告精准回答了"哪里坏了、怎么修"，但遗漏了"能不能安全上线、异常时用户怎么办"。

---

## 第一阶段：Finding 证据核验（6/6 全部确认）

### Finding 1 — 历史回放只读视图 ✅

| 维度 | 结论 |
|---|---|
| 验证结果 | ✅ 确认 |
| 证据精度 | 精确 |
| 严重程度 | low |

**源码证据：**
1. 历史面板在 drawer 中（`page.tsx:541-545`）— `AnalysisHistoryPanel` 作为 `drawerContents.history` 传入，不在主画布内联
2. 轮次切换通过 URL 参数（`analysis-history-panel.tsx:10-28`）— `buildHistoryHref` 生成 `?followUpId=...&historyRoundId=...` 格式链接
3. 面板无执行控件 — 仅含轮次列表和只读详情
4. 无专门历史 API — `src/app/api/analysis/` 目录下无 history 相关路由
5. 回放模式禁用 SSE（`analysis-execution-display.ts:168-182`）
6. 自动执行在回放期间被抑制（`page.tsx:424-436`）

**补充发现：** 自动执行的抑制是隐式的——依赖 `shouldAutoExecute` 中组合条件，而非显式的 `isHistoryReplay` 守卫。如果未来重构了判断逻辑，可能无意中破坏历史回放的只读性。建议添加显式守卫。

---

### Finding 2 — ERP kv-list 被当成业务指标卡 ✅

| 维度 | 结论 |
|---|---|
| 验证结果 | ✅ 确认 |
| 证据精度 | 精确 |
| 严重程度 | medium |

**完整因果链（4 节点闭环）：**

1. **源头产出** — `tool-event-presentation.ts L104-132`：`erp.read-model` 工具固定输出 `renderBlocks: [{ type: 'kv-list', title: 'ERP 读取结果', items: [{ label: '资源', value: output.resource }, { label: '记录数', value: output.count }] }]`
2. **分类缺失** — `conversation-view-model.ts L225-261`：`OPERATIONAL_BLOCK_TITLES` 集合包含 `'平台能力状态'` 等标题，但**不包含** `'ERP 读取结果'`。`classifyRenderedBlock()` 将其归类为 `'result'`（业务结果块）
3. **无差别指标卡提取** — `conversation-view-model.ts L519-536`：`extractMetricCards()` 对所有 kv-list 一视同仁，无按 title/source 过滤逻辑
4. **醒目展示** — `analysis-conversation-shell.tsx L434`：`<MetricCardsGrid cards={metricCards} />` 以 2xl 大字卡片网格渲染

**修复方向：**
- 在 `extractMetricCards` 中按 title 白名单/黑名单过滤
- 或将 `'ERP 读取结果'` 加入 `OPERATIONAL_BLOCK_TITLES`
- 或在 `tool-event-presentation` 中将 erp.read-model 的 kv-list 改为其他 type（如 `'tool-summary'`）

---

### Finding 3 — granularity 未进入语义查询 ✅

| 维度 | 结论 |
|---|---|
| 验证结果 | ✅ 确认 |
| 证据精度 | 精确 |
| 严重程度 | **high**（报告低估） |

**源码证据：**
1. `models.ts` 第 61 行: `granularity?: SemanticGranularity` 存在于 `MetricQueryRequest`
2. `query-builder.ts` 第 132 行: `granularity: request.granularity` 正确透传给 Cube timeDimensions
3. `tool-input-builder.ts` 第 289-299 行: `cube.semantic-query` 构造对象中**不包含** granularity
4. `follow-up-models.ts`: `AnalysisContext` 仅含 `targetMetric/entity/timeRange/comparison` 四个字段，**无 granularity**
5. `extractAnalysisContext()` 中没有任何正则规则提取"按月"/"按季度"等粒度语义
6. `analysis-follow-up-input.tsx` 第 139 行 placeholder 写着"按月份展开看看"，**引导用户输入系统无法处理的追问**

**⚠️ 报告根因定位不够深：** 报告仅指出 `tool-input-builder` 的遗漏。实际上断裂链路有两个层面：
- (a) **领域模型 `AnalysisContext` 设计时没有考虑 granularity 维度**，`extractAnalysisContext()` 无规则提取
- (b) `buildToolInputs()` 即使想传 granularity 也没有数据来源

修复需要从 **domain → application → tool-input-builder 三层联动**。Cube 适配器和 tooling schema 已完全就绪。

---

### Finding 4 — 候选因素暴露图谱原始标识 ✅

| 维度 | 结论 |
|---|---|
| 验证结果 | ✅ 确认 |
| 证据精度 | 精确 |
| 严重程度 | medium |

**源码证据：**
1. `candidate-factor-panel.tsx` 第 43-61 行：直接渲染 `factor.relationType`、`factor.direction`、`factor.source`，仅加中文前缀"关系：/方向：/来源："，**无翻译映射**
2. `use-cases.ts` 第 23-31 行 `mapGraphFactor()`：将 `GraphCandidateFactor` 的字段**原封不动**拷贝到 ReadModel
3. `domain/graph/models.ts` 定义枚举值：`GraphEdgeKind` 含 `'has-service-order'/'belongs-to'/'has-receivable'` 等；`GraphEdgeDirection` 为 `'outbound'/'inbound'/'undirected'`；`GraphEvidenceSource` 为 `'erp-master-data'/'erp-derived'/'governed-rule'`——全部英文内部标识符
4. `neo4j-graph-adapter.ts`（387 行）：Cypher 查询直接返回 `edge.kind/edge.direction/edge.source` 原始值

**根因：** 应用层 ReadModel 缺少英文标识符到中文描述的翻译映射表（如 `'has-service-order'` → `'工单关联'`、`'outbound'` → `'外向'`、`'erp-derived'` → `'ERP派生'`）。

---

### Finding 5 — 执行/诊断状态逐条展示未归并 ✅

| 维度 | 结论 |
|---|---|
| 验证结果 | ✅ 确认 |
| 证据精度 | 精确 |
| 严重程度 | **high** |

**源码证据：**
1. `handlers.ts` 第 123-290 行：每个 step 依次发布 `step-started → step-lifecycle → tool-* → step-completed → stage-result`，至少 4-8 个事件描述同一步骤
2. `analysis-execution-stream-panel.tsx` 第 79 行：`events.map((event) => ...)` 直接逐条渲染，**无按 step.id 分组或归并逻辑**
3. 同文件第 17-27 行：`getEventStatusLabel` 默认回退为"执行中"，导致已完成的 `tool-completed/tool-failed` 事件（其 `step.status` 仍为 running）始终显示"执行中"
4. `stream-models.ts` 第 3-12 行：8 种 `EXECUTION_EVENT_KINDS`，加剧同一语义的多种事件表达
5. `buildProcessBoardPart` 内部 `buildStepProgressItems` 虽有 step.id Map 归并（`interaction-part-schema.ts` 第 241-275 行），但该归并**仅用于顶部看板卡片**，`events.map` 的逐条渲染完全独立于归并逻辑

**核心问题两层：**
- (A) Worker 对同一步骤发布多种语义重叠的事件（事件设计冗余）
- (B) Stream Panel 的 `events.map` 是原始事件的 1:1 渲染，没有 reduce 逻辑

---

### Finding 6 — 历史抽屉 viewport 断点 ✅

| 维度 | 结论 |
|---|---|
| 验证结果 | ✅ 确认 |
| 证据精度 | 精确 |
| 严重程度 | medium |

**源码证据：**
1. `analysis-conversation-shell.tsx:662` — 抽屉容器 `fixed inset-y-0 right-0 z-40 w-full max-w-[560px]`
2. `analysis-history-panel.tsx:55` — 网格布局 `xl:grid-cols-[320px_minmax(0,1fr)]` 在视口 ≥1280px 时切换为双列
3. 全项目 `src/` **无任何 container query**（`@container` / `container-type` / `container-name`）声明
4. 实际推演：抽屉内容区 ≈480px，触发双列后右列仅剩 **≈144px**（480 - 320 - 16 gap），严重挤压

**修复方案：** 移除 `xl:grid-cols` 双列改为单列堆叠，或改用 Tailwind v4 容器查询（在 drawer `<aside>` 上设置 `container-type: inline-size`）。

---

## 第二阶段：架构审查

### Workstream A — 线性多轮主画布

| 维度 | 结论 |
|---|---|
| 架构对齐度 | ✅ 完全对齐 |
| 层违规 | 无 |
| 耦合风险 | 低 |

**建议的最小改动路径：**
1. application 层新增 `conversation-thread-view-model.ts`，定义 `ConversationThreadViewModel = { turns: AnalysisConversationViewModel[]; activeTurnId }`
2. 用组合函数 `buildConversationThreadViewModel` 对 rounds 数组逐轮调用既有 `buildConversationViewModel`（单轮函数不变）
3. app 层 `AnalysisExecutionLiveShell` 改为接收 `rounds + projectionsByExecutionId + eventsByExecutionId`
4. `AnalysisConversationShell` props 改为 `ConversationThreadViewModel`，内部 `.map(turns)` 顺序渲染

> 注意：所有 projection 构建逻辑必须留在 application 层纯函数中，不要在 UI 组件内写映射代码。

---

### Workstream B — 追问语义与按月展开

| 维度 | 结论 |
|---|---|
| 架构对齐度 | ⚠️ 部分对齐 |
| 层违规 | **潜在违规**：若跳过 domain 直接在 tool-input-builder 做正则提取 |
| 耦合风险 | 中（comparison × granularity 语义交叉） |

**⚠️ 关键约束：必须从 domain 层起步**

如果在 `tool-input-builder.ts` 用正则从 `questionText` 提取粒度，将违反项目规范「新增领域概念按 `domain → application → infrastructure → app` 顺序实现」。

**推荐四步实施：**
1. `domain/analysis-context/models.ts` 的 `AnalysisContext` 新增 `granularity?: SemanticGranularity`，`extractAnalysisContext()` 增加粒度提取规则
2. `domain/analysis-session/follow-up-models.ts` 的 `FollowUpContextFieldKey` 加入 granularity，处理继承覆盖
3. `application/analysis-execution/tool-input-builder.ts` 从 `context.granularity` 读取并传入 cube 输入
4. infrastructure 层无需变更

**额外发现：** `tool-input-builder.ts` 已有越权倾向——`resolveSemanticMetricKey()` 和 `resolveErpResource()` 用正则匹配 `questionText` 做领域级语义判断（L13-68, L185-195），这些逻辑本应属于 domain 层。

---

### Workstream C — 用户向结果投影

| 维度 | 结论 |
|---|---|
| 架构对齐度 | ✅ 完全对齐 |
| 层违规 | 无 |
| 耦合风险 | 低 |

`conversation-view-model.ts` 的 `classifyRenderedBlock()` 是中心化分类入口，职责清晰。注意 `OPERATIONAL_BLOCK_TITLES` 白名单与 `tool-event-presentation.ts` 的工具名 switch 存在**隐式耦合**——新增工具类型需两处同步更新。

**⚠️ B×C 交叉风险：** 方向 B 新增的按月展开数据会体现在 cube 输出中，方向 C 的过滤规则需确保多行时序数据不被误判为内部摘要。

---

### Workstream D — 候选因素产品化

| 维度 | 结论 |
|---|---|
| 架构对齐度 | ⚠️ 部分对齐 |
| 层违规 | 轻微：翻译职责应在 application 层而非 UI 层 |
| 耦合风险 | 低 |

`mapGraphFactor` 透传领域英文枚举到 ReadModel，UI 被迫展示工程术语。翻译职责应在 application 层。

---

### Workstream E — 执行/诊断状态归并

| 维度 | 结论 |
|---|---|
| 架构对齐度 | ⚠️ 部分对齐 |
| 层违规 | **明确违规**：UI 层承担了 application 层的 reduce 职责 |
| 耦合风险 | 中 |

`execution-stream-panel` 直接消费 `AnalysisExecutionStreamEvent[]` 并在 UI 层做状态判断（`getEventStatusLabel`/`getEventStatusClassName`），这是 application 层的 reduce 职责泄漏到 presentation 层。

**修复：** 在 `application/analysis-execution/` 中新增 `reduceExecutionEvents()` 纯函数，输出 `ExecutionSummaryReadModel`。

---

### Workstream F — 历史抽屉布局

| 维度 | 结论 |
|---|---|
| 架构对齐度 | ✅ 完全对齐 |
| 层违规 | 无 |
| 耦合风险 | 极低 |

纯 presentation 层布局适配问题，不触碰 application 或 domain 层。

---

## 第三阶段：缺口分析

### 技术缺口（报告完全未覆盖）

#### 🔴 Critical 级别

| # | 缺口 | 影响 | 建议 |
|---|---|---|---|
| 1 | **LLM 调用无超时** — `runTask()` 调用 `createResponse()` 无超时机制 | 单线程 worker 下一个挂起调用阻塞全部后续 job，可导致系统级瘫痪 | AbortController + 超时（30-60s）；job-level 超时熔断 |
| 2 | **Redis 事件流无 TTL** — `stream:{sessionId}` 和 `stream-sequence:{sessionId}` 永不过期 | 确定性内存泄漏，生产环境 Redis 内存持续膨胀直至 OOM | execution 完成后设置 EXPIRE（24-72h） |
| 3 | **execute 端点无 rate limiting** — `redisKeys.rate()` 存在但未使用 | 认证用户可无限次触发 LLM 调用 + 作业入队，耗尽 API 配额 | 基于 userId 的 rate limiter（5 次/分钟、20 次/小时） |

#### 🟠 High 级别

| # | 缺口 | 影响 | 建议 |
|---|---|---|---|
| 4 | **Redis append 非原子** — `INCR` + `RPUSH` 非原子操作 | 进程崩溃时序列号已消费但事件丢失，SSE 客户端逻辑异常 | Redis MULTI/EXEC 或 Lua 脚本原子化 |
| 5 | **SSR 12+ 次串行数据库查询** — 大部分无依赖关系却串行执行 | 首屏加载延迟可达数秒 | `Promise.all()` 并行化无依赖查询 |
| 6 | **Redis 数据隔离不当** — 按 sessionId 而非 executionId 隔离 | 新执行的大量事件会裁剪旧执行事件 | 改为 `dip3:stream:{executionId}` 粒度 |
| 7 | **SSE 轮询全量拉取** — 每 500ms 获取 session 全部事件（最多 200 条） | CPU 和网络开销线性增长 | 改用 Redis Stream XRANGE 增量拉取 |
| 8 | **Snapshot 无乐观锁** — `onConflictDoUpdate` 无版本号条件 | job 重试时旧 snapshot 被无条件覆盖 | 添加 updatedAt 条件或 version 字段 |

#### 🟡 Medium 级别

| # | 缺口 | 建议 |
|---|---|---|
| 9 | SSE 流无 max-duration 超时 | 添加绝对超时（5 分钟）和最大空轮询次数 |
| 10 | followUpConflict 通过 URL 参数编码，可能静默截断 | 改用 POST body 或服务端 session 存储 |
| 11 | Worker 单一 while-loop 串行消费 | 支持多 worker 实例并发消费 |
| 12 | execute 路由中 LLM 上下文抽取同步执行 | 添加独立超时或改为异步 |
| 13 | 工具执行部分失败时 step status=failed | 区分 partial-success 和 complete-failure |
| 14 | API route 模块顶层创建实例，热重载时连接池可能耗尽 | 使用 globalThis 缓存单例 |

---

### 产品/UX 缺口

#### 🔴 Critical 级别

| # | 缺口 | 建议 |
|---|---|---|
| 1 | **`AnalysisPendingRefreshGate` 轮询期间 return null** — 用户等待时无任何反馈 | 渲染带 `aria-live` 的加载提示 |
| 2 | **分析失败无重试按钮** — `status === 'failed'` 仅显示文案 | 添加"重新执行分析"按钮 |
| 3 | **PC 工作台无数据截止时间展示** | 添加"数据截止：{timestamp}"标签 |
| 4 | **抽屉组件缺少焦点陷阱** — Tab 可逃逸到背后页面元素 | 添加 focus trap 逻辑 |
| 5 | **移动端页面零 ARIA 属性** | 添加 landmark roles、aria-labels |

#### 🟠 High 级别

| # | 缺口 | 建议 |
|---|---|---|
| 6 | 无总体进度预估（无"第 3/7 步"指示） | timeline 头部添加步骤进度指示器 |
| 7 | 轮询耗尽无兜底提示 | 展示"分析仍在后台执行"提示 + 手动刷新按钮 |
| 8 | disconnected 断流状态缺乏操作入口 | 添加"重新连接"按钮 |
| 9 | 追问表单提交失败无客户端反馈 | 改为客户端提交，添加 loading 和错误提示 |
| 10 | 追问输入框不展示继承上下文信息 | 添加可折叠的上下文摘要行 |
| 11 | 移动端无实时执行进度 | 添加轻量级客户端轮询 |
| 12 | 无数据源时效声明 | 添加数据源说明（如"ERP 数据延迟 T+1"） |
| 13 | 状态指示器仅靠颜色传达信息 | 添加 `aria-label` 文本替代 |
| 14 | 可展开按钮缺少 `aria-expanded` | 添加 `aria-expanded={isOpen}` 和 `aria-controls` |
| 15 | 抽屉缺少 `role="dialog"` 和 `aria-modal` | 添加 ARIA dialog 属性 |
| 16 | 表单错误提示未与输入框关联 | 使用 `aria-describedby` 关联 |

#### 🟡 Medium 级别

| # | 缺口 | 建议 |
|---|---|---|
| 17 | "已开始分析"提示仅 3 秒 | 执行期间保持持续状态指示器 |
| 18 | 上下文信息默认折叠在面板底部 | 提到追问表单上方并默认展开 |
| 19 | 多轮追问历史无父子关系可视化 | 添加缩进或连接线 |
| 20 | mobile lastUpdatedAt 无语义标注 | 使用 `<time>` 标签并标注"数据截止时间" |
| 21 | 结论无版本/时间戳关联 | 添加生成时间和数据快照版本 |
| 22 | 移动端追问无实时反馈 | 添加提交 loading 状态 |
| 23 | PC 和移动端无自动设备检测 | middleware 添加 UA 检测自动重定向 |
| 24 | 移动端无离线/弱网降级 | Service Worker 缓存最后结果 |
| 25 | 展开箭头按钮 aria-hidden 但缺 aria-label | 移除 aria-hidden，添加描述性 aria-label |
| 26 | PendingRefreshGate 轮询期间无 aria-live | 添加 `aria-live="polite"` |

---

## 第四阶段：可行性评估

### 各 Workstream 实施复杂度与风险

| Workstream | 复杂度 | 优先级 | 是否同意 | 关键依赖 | 主要风险 |
|---|---|---|---|---|---|
| **A** 线性多轮主画布 | medium | P0 | ✅ 同意 | 事件模型需增加 turnIndex；滚动锚定重设计 | 轮次边界判定逻辑不存在；多轮 DOM 性能 |
| **B** 追问按月展开 | low | P0 | ✅ 同意 | cube 工具已支持 granularity | buildToolInputs 当前无状态，追问上下文传递机制需新建 |
| **C** 用户向结果投影 | **low** | P0 | ✅ 同意 | OPERATIONAL_BLOCK_TITLES 扩展 | 过度过滤可能丢失用户需要的信息 |
| **D** 候选因素产品化 | low | P1 | ✅ 同意 | 翻译映射表 | Neo4j 返回的 relationType 可能是动态值 |
| **E** 执行状态归并 | medium | P1 | ✅ 同意 | 新增 application 层 reduce 纯函数 | 归并后丢失中间事件详情 |
| **F** 历史抽屉布局 | **low** | P2 | ✅ 同意 | 无 | 风险极低 |

**建议的实施策略：**
- **C 建议作为第一个实施项**（纯函数层改动、风险最低、立竿见影）
- **A 依赖 B 和 C 的就绪**，是最复杂的集成工作，放最后
- 方向 C 中被过滤块应**降级到详细信息抽屉而非丢弃**

---

### 测试策略评估

**验证计划覆盖度：** 覆盖了 7 个 acceptance criteria 中的 6 个（AC1-AC6），AC7 仅依赖手动截图。

**缺失的测试场景：**
1. 端到端会话流测试：初始问题→执行事件→追问→执行事件→完整多轮 view model 输出
2. 追问上下文继承：追问必须继承上一轮 metric/entity/timeRange 并附加新意图
3. Fail-loud 错误路径：Cube 返回 0 行或错误时必须说明真实原因
4. 多轮会话持久化恢复：页面刷新后多轮消息仍按序完整展示
5. ERP kv-list 分类契约：erp.read-model 产生的 resource/count 标记为 diagnostic
6. 候选因素聚合去重：多条同方向英文 edge 聚合成一条中文业务方向
7. 历史抽屉布局自动化断言：源码静态验证不使用 `xl:grid` 做容器内布局
8. 执行完成后状态幂等：execution completed 后所有 running 状态被终态覆盖

**建议：** 测试文件从 6 个扩展为 **8 个**：
1. `story-ai-qa-multithread-canvas.test` — AC1
2. `story-ai-qa-monthly-drilldown.test` — AC2（含上下文三元组继承验证）
3. `story-ai-qa-result-projection.test` — AC3（含 ERP kv-list 分类契约）
4. `story-ai-qa-factor-presentation.test` — AC4（含聚合去重）
5. `story-ai-qa-execution-stage-reducer.test` — AC5
6. `story-ai-qa-diagnostic-conclusion.test` — AC6（从 AC5 拆分）
7. `story-ai-qa-drawer-layout.test` — AC7（含源码静态断言）
8. `story-ai-qa-e2e-conversation-flow.test` — 端到端集成测试（**新增**）

每个文件必须包含至少一个负面/边界路径测试。

---

## 第五阶段：综合评定

### 推荐实施路线

```
Phase 0 — 生产安全加固（前置条件，1-2 周）
├── 0a. Redis 事件键添加 TTL（资源泄漏）
├── 0b. Redis append 原子化（MULTI/EXEC 或 Lua 脚本）
├── 0c. execute 端点 rate limiting
├── 0d. LLM 调用添加 AbortController + 超时
└── 0e. SSE 轮询添加 max-duration 和 max-empty-polls

Phase 1 — 快速收口（第 1-2 周，与 Phase 0 可并行）
├── 1a. 方向 C：用户向结果投影（纯函数层改动，风险最低，立竿见影）
├── 1b. 方向 D：候选因素中文化（独立模块，无阻塞）
└── 1c. 方向 F：历史抽屉布局修复（纯 CSS，极低风险）

Phase 2 — 核心体验升级（第 3-4 周）
├── 2a. 方向 B：追问语义与按月展开（domain → app → builder 三层联动）
├── 2b. 方向 E：执行/诊断状态归并（新增 application 层 reduce 纯函数）
└── 2c. UX 无障碍性基线修复（焦点陷阱 + ARIA landmarks + aria-expanded）

Phase 3 — 多轮对话闭环（第 5-6 周）
└── 3a. 方向 A：线性多轮主画布（依赖 B/C 就绪，最复杂集成）
```

### 依赖关系

```
        C ──────────┐
        │            │
  B ────┼────────────┼──→ A（多轮主画布）
        │            │
  D     E            │
  │     │            │
  F     └────────────┘

  Phase 0（安全加固）贯穿始终
```

### 需要补充的前置工作

1. **cube.semantic-query 工具的 granularity 支持确认** — `query-builder.ts:132` 已有透传，但需确认 Cube.js 服务端 schema 是否已配置 timeDimension 的 granularities
2. **Redis 键结构迁移方案** — 将 `dip3:stream:{sessionId}` 改为 `dip3:stream:{executionId}` 粒度隔离需评估线上存量数据
3. **Worker 并发模型评估** — 添加 LLM 超时后，需评估是否立即引入多 worker 实例

### 风险缓解策略

| 风险 | 缓解措施 |
|---|---|
| 方向 A 多轮 DOM 性能 | 历史轮使用虚拟滚动或折叠渲染，轮次超过 5 时自动折叠早期轮次 |
| 方向 B × C 交叉误伤 | 在 `tool-event-presentation.ts` 的 `cube.semantic-query` 分支中显式标记 `audience: 'user-facing'` |
| 方向 C 过度过滤 | 被过滤块降级到详细信息抽屉而非丢弃；上线前用现有 78 个测试文件做回归 |
| Redis 原子性引入回归 | 使用 Lua 脚本（EVALSHA）替代 MULTI/EXEC；先在测试环境验证序列号连续性 |
| 无障碍性修复范围大 | 按 critical → high → medium 分批实施 |

### 需要补充的验收标准

| 编号 | 补充项 | 理由 |
|---|---|---|
| **AC-8** | 所有抽屉组件具备焦点陷阱，`aria-modal="true"` | 无障碍性 critical 缺口 |
| **AC-9** | 分析失败提供"重新执行"按钮；断流提供"重新连接"按钮 | 错误恢复 critical 缺口 |
| **AC-10** | 分析结果区域展示数据截止时间戳 | 数据时效性 critical 缺口 |
| **AC-11** | `AnalysisPendingRefreshGate` 轮询期间渲染加载提示，耗尽后展示兜底文案 | 用户预期管理 critical 缺口 |

### 需要修正的验收标准

| 编号 | 修正建议 |
|---|---|
| **AC-7** | 补充源码静态断言：`readFile + regex` 验证抽屉内容组件不使用 `xl:grid-cols` 做容器内布局 |
| **AC-5** | 补充负面路径测试：空事件列表、执行失败、部分工具成功部分失败 |

---

## 最终结论

**报告可以作为功能层修复的依据，但不足以作为完整的产品化收口方案。**

报告在功能正确性维度的诊断是精确且可信的——6 个 Finding 全部经源码确认，架构审查识别了关键的层序违规和耦合风险，可行性评估的实施路径合理。方向 A-F 的修复方案可以据此启动。

**但在启动修复前，必须补充三个维度**，否则存在"修好了功能、系统却上不了线"的风险：

1. **生产安全基线（Phase 0）**：Redis TTL、LLM 超时、rate limiting、Redis 原子性——确定性的生产环境故障源
2. **无障碍性基线**：焦点陷阱和 ARIA landmarks 是法律和合规要求，4 项 critical 应与功能修复同等优先级
3. **错误恢复闭环**：分析失败无重试、断流无重连、轮询耗尽无兜底——决定了用户在异常路径上的体验下限
