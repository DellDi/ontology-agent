---
date: '2026-04-17'
project: 'ontology-agent'
workflow: 'correct-course'
mode: 'batch'
status: 'draft'
change_scope: 'moderate'
trigger: 'Epic 10 顺序倒挂 + Epic 8/10-5 职责重叠 + Epic 9 review 积压'
triggers_code: 'A+B+C'
---

# Sprint Change Proposal (2026-04-17b)

## 1. Issue Summary

Epic 7 收官之际盘点，发现三组结构性 / 执行节奏风险，均非单个 story 内可解决，需要在启动 Epic 10/8/9 下一轮开发之前统一纠偏。

### Trigger A — Epic 10 内部顺序倒挂

**事实**：`Story 10.6` 已于 2026-04-17 合入 `done`，但其依赖的 `10.1 AI runtime / Vercel AI SDK adapter` 与 `10.2 renderer-registry` 仍在 `ready-for-dev`。

**证据**：
- `_bmad-output/implementation-artifacts/10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md` Task 2 明确要求：
  > 让 `analysis-execution-live-shell.tsx` 从"手工合并事件"演进为"消费 runtime projection"
- `analysis-execution-live-shell.tsx` 当前是 10.6 的核心组件，正是"手工合并事件"的实现；这意味着 10.1 落地时一定会**推翻 10.6 刚建立的客户端合并逻辑**。
- 10.6 新增的 `reasoning-summary` / `assumption-card` 两个 UX part 已被放到 `ux-epic-10-ai-native-interaction-addendum.md`，但未实现 renderer。10.6 review 时 **D4 decision** 明确把 renderer 归属留到 10.2，也说明依赖方向颠倒。

**风险**：
- 返工：10.1/10.2 落地时大概率重写 `AnalysisExecutionLiveShell` 及其周边；10.6 的 hydration 修复、Esc 关闭、sessionStorage 级 scope 去重等细节可能在重写中被意外剥离。
- 测试层不一致：10.6 的单元测试是面向 grounding 纯函数的，UI 层行为目前靠人肉验证；10.1/10.2 落地后会有第二波 UI 验证需求。

### Trigger B — Epic 8 与 Story 10.5 职责重叠

**事实**：`Epic 8`（移动端）与 `Story 10.5`（mobile projection on shared interaction schema）有明显重叠。

**证据**：
- `8-1 移动端最近分析摘要` vs `10.5 AC-2` 移动端摘要投影。
- `8-2 移动端关键证据视图` vs `10.5 AC-2` "当前结论、关键证据精华..."。
- `8-3 移动端轻量追问` vs `10.5 AC-4` "mobile 提交轻量追问或下钻指令时附着到原会话"。
- `10.5 Dev Notes` 已写：
  > 轻量追问的语义应当和 `Story 8.3` 保持一致。
  - 即本身就承认了重叠，并指定 10.5 作为 schema 权威、8.x 作为能力目标，但当前 8.x 仍是独立 story 而非 10.5 的实现任务。

**风险**：
- 并行实现：两条路径若各自推进，会产生移动端 UI 各自拼消息协议的可能，违反 `10.5 AC-1` "PC 和 mobile 消费同一套 AI interaction schema"。
- 顺序含糊：如果先做 Epic 8，会重复造出不兼容协议；如果先做 10.5，Epic 8 变成纯 UI 消费层，story 粒度偏薄。

### Trigger C — Epic 9 review 积压

**事实**：`9-2 governance definitions` 与 `9-3 ontology grounding` 仍处于 `review` 已超过 4 天；`9-4~9-7` 均 `backlog`；本体治理链路未闭环。

**证据**：
- `9-3 ontology-grounding` 已被 `10.6` 事实上消费（`HARD_BLOCKING_ISSUE_TYPES` 与 `attemptedVersionIds` 都是对 9-3 输出的 grounding context 做分类）。
- 若 9-3 review 时发现需要改 domain 模型（如新增 issue type），10.6 的 blocking 判定与 assumption 生成会需要同步修改。
- `9-4 本体变更审批` / `9-5 governance admin console` / `9-6 bind execution to ontology version` / `9-7 bootstrap first approved ontology runtime package` 没有 story-level 依赖声明，开发顺序不清晰。

**风险**：
- review 积压越久，回传成本越高。
- 9-4~9-7 开发顺序不清，无法进入 `bmad-dev-story` 自动拾取。

## 2. Impact Analysis

### 2.1 Epic Impact

| Epic | 现状 | 纠偏后变化 |
|---|---|---|
| **Epic 10** | 6 story，10-6 done，10-1~10-5 ready | 重排内部顺序为 10.1 → 10.2 → 10.3 → 10.4 → 10.5；新增 `10-6 Alignment Retro` 作为收口检查点 |
| **Epic 8** | 3 story ready-for-dev | 合并到 `Story 10.5 的 Task/Subtask` 下执行，Epic 8 整体降级为 `observation-only` epic（或直接废弃），避免并行路径 |
| **Epic 9** | 1 done / 2 review / 4 backlog | 先强制合入 9-2/9-3；在 10.1 启动前把 9-3 合入以冻结 grounding 契约；为 9-4~9-7 增加依赖关系说明 |

### 2.2 Story Impact

**Epic 10**：
- `10.1` → 首发，必做；需在 AC 中**增补一条**："必须兼容 10.6 已落地的 `AnalysisExecutionLiveShell` 客户端行为（hydration 恢复、Esc 关闭、sessionStorage scope 去重），重写过程不得丢失这些能力"。
- `10.2` → 紧随 10.1，负责把 `reasoning-summary`/`assumption-card`/`process-board` 三个 part 从 UX addendum 落地到 renderer registry；10.6 临时使用的 `kv-list` / amber 卡片同步切换为这些 renderer。
- `10.3~10.5` → 顺序推进。`10.5` 的 Task 展开纳入原 `Epic 8` 的 3 个 story 作为子任务。
- 新增 **`10.7 Epic 10 Alignment Sweep`**（建议，替代原"10.6 retro"）：在 10.1/10.2 合入后，回归 10.6 单测 + 端到端验证，确保 hydration / side sheet / assumption 展示未被重写回退。

**Epic 8**：
- `8-1`、`8-2`、`8-3` 转为 `10.5` 内部的 3 组 task/subtask，sprint-status 对应 entry 标记 `merged-into-10.5`（或直接从 yaml 删除，取决于你偏好）。
- `epic-8` 本身从 `in-progress` 转 `deprecated` / `merged`。

**Epic 9**：
- 强制要求：**9-2 和 9-3 必须在 10.1 开工之前合入**，因为 10.1 runtime 会封装 grounding 消费路径，如果 9-3 review 改动 domain 类型会引起 10.1 与 10.6 的双重返工。
- `9-4~9-7` 补依赖序：建议执行顺序 `9-7 bootstrap → 9-4 审批流 → 9-5 admin console → 9-6 bind execution to ontology version`。`9-6` 与 10.5 耦合密切（mobile projection 也需要知道绑定哪个 ontology 版本），可放在 10.5 之前或并行。

### 2.3 Artifact Conflicts

| 工件 | 需要改动 |
|---|---|
| `epics.md` | Epic 10 story 顺序重排 + 新增 10.7；Epic 8 标 deprecated/merged；Epic 9 补依赖序 |
| `sprint-status.yaml` | Epic 8 三 story 删除或标 merged；新增 `10-7-epic-10-alignment-sweep`；9-4~9-7 顺序可选地加注释 |
| `architecture.md` | 无直接改动，10.1 本身承担运行时分层定义 |
| `ux-epic-10-ai-native-interaction-addendum.md` | 无需改动，已预留 `process-board` / `reasoning-summary` / `assumption-card` 入口 |
| `prd.md` | NFR-11 "平台边界清晰性" 不受影响，但"移动端产品能力"归属澄清一次 |

### 2.4 Technical Impact

- **代码层面**：10.1 落地时需提供一个"兼容层"而不是直接重写 `AnalysisExecutionLiveShell`；具体做法：将当前客户端合并逻辑**抽到 runtime adapter 内部**，保持外部接口与 10.6 现有 UI 一致。
- **测试层面**：`tests/story-10-6-grounded-planning.test.mts` 与 `tests/story-7-4-observability.test.mts` 保持不动；新增 `tests/story-10-1-runtime-adapter.test.mts`、`tests/story-10-2-renderer-registry.test.mts`、`tests/story-10-7-alignment-sweep.test.mts`（端到端集成）。
- **数据契约**：9-3 review 若改动 grounding domain type，10.6 的 `HARD_BLOCKING_ISSUE_TYPES` 与 `architecture.md` 的 Execution Trigger Policy 段需同步修改（当前已对齐，风险是如果 review 时扩展 issue type）。

## 3. Recommended Approach

**Selected Path：Hybrid（Direct Adjustment + MVP Focus Correction）**

- 不回滚 10.6 已完成内容（已通过双层 review）。
- 重排 Epic 10 内部顺序、把 Epic 8 合并到 10.5、先清 Epic 9 review 队列。
- 新增 10.7 作为结构性安全阀。

**Effort / Risk / Timeline**：

- Effort: Medium（3 条线平行整改，但每条都有清晰定义的切入点）
- Risk: Low-Medium（Epic 8 合并需要用户确认是否接受 Epic 编号废弃）
- Timeline：建议 1~2 天内完成本次规划层整改，真正开工仍然看后续具体 story 推进节奏

## 4. Detailed Change Proposals (Old → New)

### 4.1 `epics.md` — Epic 10 顺序重排 + 新增 10.7

**OLD 顺序**：10.1, 10.2, 10.3, 10.4, 10.5, 10.6

**NEW 顺序**：
- ~~10.6 (已 done，保留但标注 out-of-sequence)~~
- 10.1 → 10.2 → 10.3 → 10.4 → 10.5 → **10.7 (新增 Alignment Sweep)**

**10.1 AC 增补**：

```
当 runtime adapter 落地时，系统必须保留 Story 10.6 已建立的
客户端行为语义（默认收起的 side sheet 可恢复态、
Esc 关闭、sessionStorage-scope 自动执行去重、
assumption 在 ConclusionPanel 的 amber 投影），
不得通过重写 AnalysisExecutionLiveShell 导致这些能力丢失。
```

**10.7 新 Story 大纲**：

```
# Story 10.7: Epic 10 Alignment Sweep

As a 平台前端团队,
I want 在 10.1/10.2/10.3/10.4/10.5 全部落地后做一次对齐清扫,
so that Story 10.6 已提前落地的交互主链在 runtime 抽象上线后
仍然满足 AC1~AC5，且 reasoning-summary / assumption-card /
process-board 三个 UX part 已经通过 renderer-registry 正式消费。

## AC
1. 10.6 所有 Review Findings（P1~P12 + D1~D5）已映射到
   对应的 runtime / renderer 实现，不再有"临时实现"标签。
2. tests/story-10-6-grounded-planning.test.mts 与新增的
   tests/story-10-1-runtime-adapter.test.mts 均通过，
   且对应 UI 行为用 story-based integration test 覆盖。
3. _bmad-output/implementation-artifacts/deferred-work.md 中
   W1 parseProgressText 已在 Story 10.2 renderer-registry 收口。
4. `AnalysisPlan._executionAssumptions` 下划线约定问题（W2）
   已在本轮做统一决策（去下划线 OR 写入 domain 规范）。
```

### 4.2 `epics.md` — Epic 8 合并到 10.5

**OLD**：Epic 8 作为独立 epic，包含 8.1 / 8.2 / 8.3 三个 story。

**NEW**：

```
# Epic 8 (merged into 10.5)

本 Epic 的原有 3 个 story 已归并到 Story 10.5 的内部 Tasks，
避免出现 mobile projection 的两条并行实现路径。

- 原 8.1 → 10.5 Task: 移动端最近分析摘要投影
- 原 8.2 → 10.5 Task: 移动端关键证据视图
- 原 8.3 → 10.5 Task: 移动端轻量追问接入

Epic 8 的产品能力目标（移动端独立 surface）不变，
但不再作为独立 sprint 轨道推进。
```

**10.5 Tasks 增补**（现有 Task 之下追加）：

```
- [ ] 吸收原 Epic 8 story（AC: 1, 2, 4, 5）
  - [ ] 8.1 原 AC：移动端最近分析摘要投影，复用同源 render schema
  - [ ] 8.2 原 AC：移动端关键证据精华视图
  - [ ] 8.3 原 AC：移动端轻量追问附着到原会话，不生成独立协议
```

### 4.3 `epics.md` — Epic 9 依赖序补注

**NEW**（在 Epic 9 描述段末尾追加）：

```
## Execution Order

- 9.1 ✅ done → 9.2/9.3 强制在 Story 10.1 开工之前合入
  （grounding 契约冻结）。
- 9.7 → 9.4 → 9.5 → 9.6 为建议顺序：
  - 9.7 bootstrap 提供 runtime 包
  - 9.4 审批流建立变更生命周期
  - 9.5 admin console 暴露治理入口
  - 9.6 binding 把 execution/follow-up/history 绑到 ontology version
- 9.6 与 10.5 有耦合（mobile projection 也要版本绑定），
  可并行或紧邻 10.5 执行。
```

### 4.4 `sprint-status.yaml` 调整

**OLD（epic-8 段）**：

```yaml
  epic-8: in-progress
  8-1-mobile-latest-analysis-summary: ready-for-dev
  8-2-mobile-key-evidence-view: ready-for-dev
  8-3-mobile-lightweight-follow-up: ready-for-dev
  epic-8-retrospective: optional
```

**NEW**：

```yaml
  # Epic 8 已合并到 Story 10.5，详见 planning-artifacts/sprint-change-proposal-2026-04-17-b.md
  epic-8: merged-into-10-5
  8-1-mobile-latest-analysis-summary: merged-into-10-5
  8-2-mobile-key-evidence-view: merged-into-10-5
  8-3-mobile-lightweight-follow-up: merged-into-10-5
  epic-8-retrospective: optional
```

**NEW（epic-10 段末尾追加）**：

```yaml
  10-7-epic-10-alignment-sweep: backlog
```

### 4.5 新建 `10-7-epic-10-alignment-sweep.md` spec

在 `_bmad-output/implementation-artifacts/` 下新建该文件，内容骨架见 4.1 的 10.7 大纲。

### 4.6 不改动的工件

- `architecture.md`：无需改动。
- `ux-epic-10-ai-native-interaction-addendum.md`：无需改动。
- `prd.md`：无需改动（NFR-11 与移动端边界条款覆盖当前方向）。

## 5. Implementation Handoff

**Scope Classification**：**Moderate**（规划层整改 + backlog 重排）

**Handoff Recipients**：
- **PM/PO**（即你本人）：批准本提案、执行 `epics.md` / `sprint-status.yaml` 改动
- **Dev Agent**：按新顺序拾取 `9-2/9-3 review` → `10.1` → `10.2` → ...

**Success Criteria**：
1. Epic 10 story 按 `10.1 → 10.2 → 10.3 → 10.4 → 10.5 → 10.7` 顺序推进，不再跳号。
2. Epic 8 不再出现在任何 ready-for-dev 自动拾取路径上。
3. 9-2/9-3 在 10.1 开工前已 merge。
4. 10.1 AC 包含对 10.6 既有能力的兼容要求。
5. 10.7 spec 文件已创建并 `ready-for-dev`（等 10.1~10.5 完成后激活）。

## 6. Execution Checklist（本次落地清单）

批准后按以下顺序执行（都是文档/yaml 级改动，不改代码）：

- [ ] 修改 `epics.md`：Epic 10 新增 10.7、10.1 AC 增补、Epic 8 合并段、Epic 9 执行顺序段
- [ ] 修改 `sprint-status.yaml`：Epic 8 状态 + 新增 10-7 条目
- [ ] 新建 `_bmad-output/implementation-artifacts/10-7-epic-10-alignment-sweep.md`
- [ ] 本提案文件留档：`_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-17-b.md`
- [ ] commit + push

---

## 7. Approval Gate

请确认是否批准进入实施：

- `yes` / `批准` — 我按清单落地全部规划工件改动
- `仅 A` / `仅 B` / `仅 C` — 只执行对应 trigger 的改动（降低范围）
- `revise` — 指出要改的段落
