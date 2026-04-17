# Story 10.6: 可隐藏的执行流程看板与自动执行优先策略

Status: review

<!-- Spec retro-created on 2026-04-17 as part of code review of commit 039e430.
     原实现先于 spec 文件存在，本文件补齐流程权威性。 -->

## Story

As a 物业分析用户,
I want 会话默认自动发起首轮执行、过程细节收纳在可隐藏的专业流程看板中,
so that 我不需要先手工补齐所有条件就能看到分析结果，同时仍能随时展开流程看板追踪步骤、工具、状态、假设与阻断原因。

## Acceptance Criteria

1. 当用户进入一个已完成基础 intent/context 提取且不存在高风险阻断项的分析会话时，系统必须默认自动提交首轮执行任务，而不把“用户手工补齐所有条件”作为前置门槛。（对应 `Story 5.1` 新增 AC-A）
2. 当上下文存在普通缺省字段（如比较基线、次要约束、时间范围模糊）时，系统必须以显式 assumptions 继续执行，并在计划面板与结论面板中明确披露这些假设。（对应 `Story 5.1` 新增 AC-B）
3. 仅当存在权限冲突、核心实体冲突、核心指标冲突、严重语义歧义或无可用 ontology 版本等高风险问题时，系统才允许阻断执行并要求用户确认；此时必须给出可诊断的原因。（对应 `NFR-12` 与 `architecture.md` Execution Trigger Policy）
4. 执行过程必须通过可隐藏的侧滑流程看板（`Process Board Side Sheet`）展示步骤轨迹、工具调用、执行状态、阶段进度、推理摘要与 assumptions；看板默认态应为收起或半展开，主画布优先展示阶段结果与结论叙事。（对应 `Story 5.2` 新增 AC + UX addendum）
5. 用户可随时隐藏/展开流程看板，切换不得中断执行流、不得遮挡主画布阅读；刷新或重进会话后，展开状态必须可恢复。
6. 追问、补充条件、重规划等增强能力不得阻断首轮自动执行主链；这些能力仅作为 second-pass enhancement 出现。（对应 `Story 6.1~6.3` 新增 AC）
7. 所有 non-blocking fallback 与多版本 grounding 尝试必须生成可审计日志或 assumption trace，满足 `diagnosable / auditable` 要求。

## Tasks / Subtasks

- [x] 主链层：实现自动执行优先策略（AC: 1, 2, 6）
  - [x] 新增 `AnalysisAutoExecuteGate` 组件，基于 `shouldAutoExecute` 服务端条件触发 `requestSubmit`
  - [x] 在 `page.tsx` 计算 `shouldAutoExecuteBase` 与 `shouldAutoExecuteAfterReplan`
  - [x] 调整 `AnalysisPlanPanel` 文案与按钮，将"开始执行分析"改为"手动执行（兜底）"

- [x] Grounding 层：区分 blocking vs non-blocking（AC: 2, 3, 7）
  - [x] `grounded-planning.ts` 新增 `HARD_BLOCKING_ISSUE_TYPES = {entity, metric, version, permission}`
  - [x] 非硬阻断时通过 `allowFallbackToFreeText` 回落并生成 assumptions
  - [x] `grounding.ts` 支持多版本候选探测（`listApprovedCandidates`）
  - [x] `OntologyGroundingError.details` 类型收紧到枚举 issue type

- [x] UI 层：侧滑流程看板（AC: 4, 5）
  - [x] `AnalysisExecutionLiveShell` 引入 `isProcessBoardOpen` 状态与 localStorage 持久化
  - [x] `AnalysisExecutionStreamPanel` 新增 `variant: 'embedded' | 'side-sheet'`
  - [x] 新增进度条 + `buildStepProgress` 聚合
  - [x] 增加"显示/隐藏流程看板"按钮与 FAB

- [x] 规划工件同步（对应提案 2026-04-17）
  - [x] `prd.md` 增补 FR-06/FR-09/NFR-01/NFR-12
  - [x] `architecture.md` 增补 Execution Trigger Policy
  - [x] `epics.md` 在 Story 5.1/5.2/6.1/6.2/6.3 追加 AC
  - [x] `ux-epic-10-ai-native-interaction-addendum.md` 增补 Process Board Side Sheet 与新 renderer

### Review Findings (from code review 2026-04-17 of commit 039e430)

#### Decision-Needed（需 PM/UX 拍板，阻塞 done）

- [ ] [Review][Decision] **D1 默认态与 UX 规范冲突** — UX addendum 要求 "默认收起或半展开"，实现默认展开；需确认最终策略（严格对齐 UX / 保留当前 / 三态）`@src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx:58-64`
- [ ] [Review][Decision] **D2 localStorage key 维度** — `analysis-process-board-open-v1` 是全局 key，跨 session 与跨用户共享；需确认是全局偏好 / 按 user / 按 user+session `@src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx:22`
- [ ] [Review][Decision] **D3 多版本容错深度** — `listApprovedCandidates(20)` 最坏导致 100 次 DB round-trip 且串行；需决策降低到 3~5 或并行预取 `@src/application/ontology/grounding.ts:324`
- [ ] [Review][Decision] **D4 reasoning-summary / assumption-card renderer 归属** — UX addendum 已新增这两个 domain-info part，但本 story 未实现 renderer；需决策归入 `Story 10.2 renderer-registry` 还是本 story 二期
- [ ] [Review][Decision] **D5 Assumption 在 ConclusionPanel 的展示位** — AC-B 要求"结果中展示 assumptions"，当前仅 PlanPanel 展示；需决策是否在 Conclusion 内也投影

#### Patch（明确可修，按严重度排序）

- [x] [Review][Patch][🔴 High] **P1 Hydration mismatch** — 已修复：`useState` 首轮统一为 `true`，挂载后在 useEffect 中从 localStorage 恢复状态，伴随 `hasRestoredOpenState` 防止首单 write 覆盖 `@src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx:55-102`
- [x] [Review][Patch][🔴 High] **P2 遮罩阻断主画布** — 已修复：移除全屏遮罩 button，aside 看板仅占右侧 540px，主画布保持可交互；同时新增 Esc 键关闭支持以提升可访问性 `@src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx:104-116, 223-234`
- [x] [Review][Patch][🔴 High] **P3 零测试覆盖** — 已补齐：新增 `tests/story-10-6-grounded-planning.test.mts`，覆盖 12 个用例（blocking 判定的 6 种 issue type 组合 + assumption 生成的4 种输入）；`isHardBlockingGroundingError` / `buildAutoExecutionAssumptions` 随之导出供测试消费 `@tests/story-10-6-grounded-planning.test.mts` + `@src/application/ontology/grounded-planning.ts:68, 80`
- [x] [Review][Patch][🔴 High] **P4 sprint-status.yaml 状态错误** — 已修复：`10-6` 由 `backlog` 更正为 `review` `@_bmad-output/implementation-artifacts/sprint-status.yaml:128`
- [ ] [Review][Patch][🟠 Med] **P5 重复 grounding 调用**：`catch` 分支再次调用 `groundAnalysisContext`，双倍 DB 往返；应改为 grounding 内部一次性返回"是否需要假设继续" `@src/application/ontology/grounded-planning.ts:114-135`
- [ ] [Review][Patch][🟠 Med] **P6 自动提交无失败保护**：POST 5xx/网络失败后 `hasSessionExecution` 仍 false，gate 会反复 auto-submit；应加 backoff + 错误 banner + 最大重试次数 `@src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-auto-execute-gate.tsx:20-27`
- [ ] [Review][Patch][🟠 Med] **P7 double-submit 可访问性**：`sr-only` form 对 screen reader / Tab 仍可访问，可能与自动 `requestSubmit` 冲突；应加 `aria-hidden` + `tabindex="-1"` 或合并为单 form `@src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-auto-execute-gate.tsx:42-52`
- [ ] [Review][Patch][🟠 Med] **P8 多版本探测无 observability**：循环尝试最多 20 个版本，失败仅抛单一 error，无"尝试过哪些版本、各自失败原因"日志；违反 `diagnosable` `@src/application/ontology/grounding.ts:325-360`
- [ ] [Review][Patch][🟠 Med] **P9 `_executionAssumptions` 下划线私有字段**：领域模型使用下划线前缀挂载运行时字段，属 anti-pattern；应重命名为正式 `assumptions: string[]` 并在 domain 文档说明 `@src/domain/analysis-plan/models.ts:24`
- [ ] [Review][Patch][🟡 Low] **P10 architecture.md 与代码不对齐**：文档 Blocking 列未包含 `version`，但代码 `HARD_BLOCKING_ISSUE_TYPES` 含之；应在 architecture.md 补齐并将"严重语义歧义"细化到 issue type `@_bmad-output/planning-artifacts/architecture.md:232-244`
- [ ] [Review][Patch][🟡 Low] **P11 `requestSubmit()` 兼容性**：Safari < 16 / iOS 旧版缺失；应做 feature-detect fallback 到 `form.submit()` 或显示手动按钮 `@src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-auto-execute-gate.tsx:26`
- [ ] [Review][Patch][🟡 Low] **P12 ConclusionPanel 未展示 assumptions**：Story 5.1 AC-B 要求"结果中展示"，但目前仅 PlanPanel 展示；需在 Conclusion 面板补充投影（与 D5 联动）`@src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-plan-panel.tsx:36-46`

#### Deferred（预存在，非本次引入）

- [x] [Review][Defer] **W1 parseProgressText 依赖 `"N/M"` 硬格式** `@src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx` — deferred, pre-existing（renderBlock schema 统一收口建议放到 `Story 10.2 renderer-registry`）

## Dev Notes

- 本 story 承接 `sprint-change-proposal-2026-04-17.md` 的纠偏主链，直接回应"页面冗余过多、先补条件再执行、缺专业流程看板"三项偏航反馈。
- 主链心智：**自动执行优先、追问纠偏后置**。实现上分三切片：
  - Slice A — 非阻断执行策略（`grounded-planning.ts` + `grounding.ts`）
  - Slice B — 主区信息降噪与可折叠高级控制（`page.tsx` + `<details>` 包裹）
  - Slice C — 侧滑流程看板与状态持久化（`analysis-execution-live-shell.tsx`）
- Blocking vs Non-blocking 的规约权威来源是 `architecture.md` 的 `Execution Trigger Policy` 段；代码实现与文档需严格一一对齐。后续若增加新的 issue type（如 `scope`、`variant`），必须同步两处。
- Assumption trace 是 `auditable` 的关键落地点，不要视为"只给 UI 看的提示文案"。它应当：
  - 在 `AnalysisPlanReadModel.assumptions` 上持久化
  - 在 `AnalysisConclusionPanel` 中显示（P12）
  - 在未来 `audit events` 上打通，供离线追溯
- 流程看板并不承担最终结论表达；结论面板与进度看板是**两种投影**而不是同一块 UI 的上下堆叠。看板默认态与切换态必须符合 UX addendum 规约。
- 多版本 grounding 候选探测是为应对"最新已发布版本治理化不完整、回退到上一版本也能跑"的健壮性场景。此能力必须配合 observability（日志/audit）落地，否则会隐藏 ontology 治理漏洞。

### Review Adjustments

- 本 story 存在**流程回溯**：commit `039e430` 先于本 spec 提交，违反 BMAD `CS → VS → DS → CR` 顺序。本次按 Option 2 补齐 spec，但后续 story 必须严格遵守 story-first 顺序。
- 建议在下一次 epic-10 retrospective 中专项复盘此次跳过 CS 的根因，避免复发。

### Completion Notes (2026-04-17, patch wave 1)

本次 review 后随即完成 4 项 🔴 高严重度 patch：

- `P1` Hydration mismatch — 首轮 SSR/CSR 统一初值 + 挂载后 localStorage 同步
- `P2` 遮罩阻断主画布 — 移除全屏遮罩，新增 Esc 关闭
- `P3` 零测试 — 新增 12 个单测用例，全部 pass
- `P4` sprint-status 状态 — `10-6` 转为 `review`

下轮 patch wave 2 待处理（按优先级）：

1. `P5` / `P6` / `P7` / `P8` / `P9`（4 项 🟠 Med + 1 项 🟠 Med）
2. `P10` / `P11` / `P12`（3 项 🟡 Low）

`D1 — D5` 等 5 项 decision-needed 仍阻塞于 PM/UX 拍板，清溅前禁止将状态推入 `done`。

验证命令：

```bash
npx tsx --tsconfig tsconfig.json --test tests/story-10-6-grounded-planning.test.mts
pnpm lint
npx tsc --noEmit
```
