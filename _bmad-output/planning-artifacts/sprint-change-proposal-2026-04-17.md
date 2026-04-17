---
date: '2026-04-17'
project: 'ontology-agent'
workflow: 'correct-course'
mode: 'batch'
status: 'approved'
change_scope: 'major'
trigger: 'analysis 页面交互与执行主链偏航'
approved_date: '2026-04-17'
---

# Sprint Change Proposal

## 1. Issue Summary

### 1.1 Trigger Story / Module

- 触发模块：`/workspace/analysis/[sessionId]` 会话页当前实现
- 直接关联故事：`Story 5.1`、`Story 5.2`、`Story 6.1~6.4`、`Story 10.1~10.3`
- 触发原因：当前页面行为与产品目标“智能体先自动执行、用户按需介入”明显偏离

### 1.2 Core Problem Statement

本次问题属于 **执行阶段发现的交互主链偏航**，不是单个 UI 缺陷。具体有三类：

1. 页面冗余信息过多，且默认暴露了不应成为主阅读流的信息（会话元数据、大量配置/修正入口）。
2. 执行发起逻辑仍以“先补齐上下文再执行”为中心，导致用户被频繁中断；“追问/纠偏”从增量亮点变成了主流程阻断项。
3. 缺少可隐藏的专业流程看板（执行步骤、工具态、思维链摘要、进度），当前“流式画布”仍是主区堆叠卡片，缺少侧滑流程控制与阅读分层。

### 1.3 Evidence

- 代码证据：
  - 会话页在主区默认拼接了大量信息块与多个面板（context、plan、follow-up、history），信息密度偏“运维台”而非“分析主线”：[page.tsx]({project-root}/src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx)
  - `AnalysisContextPanel` 默认大面积展示并引导手工修正，强化了“先修再跑”的心智：[analysis-context-panel.tsx]({project-root}/src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-context-panel.tsx)
  - `AnalysisPlanPanel` 在 `blockingMessage` 下直接禁用执行提交，导致“未治理化命中=无法推进”：[analysis-plan-panel.tsx]({project-root}/src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-plan-panel.tsx)
  - `execute` 路由 grounding 失败即重定向报错，主链中断：[execute/route.ts]({project-root}/src/app/api/analysis/sessions/[sessionId]/execute/route.ts)
  - 流式面板仍是主区卡片列表，缺少“可隐藏的专业流程看板”语义：[analysis-execution-stream-panel.tsx]({project-root}/src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx)
- 用户反馈证据（本次对话）：
  - “页面冗余信息太多”
  - “一直让用户补充条件，本末倒置”
  - “需要侧滑出来的专业过程看板，并且可隐藏”

## 2. Checklist Results

### Section 1: Understand Trigger and Context

- `1.1` [x] Done：触发点已定位到 `analysis session` 交互主链
- `1.2` [x] Done：问题类型为“实现偏航 + 交互主链错误”
- `1.3` [x] Done：有代码证据与用户反馈双证据

### Section 2: Epic Impact Assessment

- `2.1` [x] Done：当前受影响 epic 仍可完成，但必须纠偏后再推进
- `2.2` [x] Done：需要修改 `Epic 5 / 6 / 10` 的故事描述与 AC
- `2.3` [x] Done：后续 epic 不需重排编号，但优先级需要重排（先修交互主链）
- `2.4` [x] Done：建议新增一个 Story（见 4.6）承接侧滑流程看板收口
- `2.5` [x] Done：优先级需要调整，`Epic 10` 前置

### Section 3: Artifact Conflict and Impact Analysis

- `3.1` [x] Done：PRD 中“过程可见”目标不变，但“追问可选”需要明确
- `3.2` [x] Done：Architecture 需要补“非阻断执行策略 + 假设治理”
- `3.3` [x] Done：UX 规格与当前页面实现存在明显落差（规格是分析画布，现状是多面板堆叠）
- `3.4` [x] Done：测试策略需新增“自动执行不中断”路径验证

### Section 4: Path Forward Evaluation

- `4.1` Option 1 Direct Adjustment：**Viable**
  - Effort: Medium
  - Risk: Medium
- `4.2` Option 2 Potential Rollback：**Not viable**
  - Effort: High
  - Risk: High
  - 不建议回滚已完成执行链路与 grounding 主链
- `4.3` Option 3 PRD MVP Review：**Partially viable**
  - Effort: Low
  - Risk: Low
  - 可用于把“追问/纠偏”降级为可选能力，而非阻断主链
- `4.4` Selected Approach：**Hybrid（Option 1 + Option 3）**
  - 不回滚底层能力
  - 重排主交互优先级：自动执行优先，人工补充后置为增强

### Section 5: Proposal Components

- `5.1` [x] Done
- `5.2` [x] Done
- `5.3` [x] Done
- `5.4` [x] Done
- `5.5` [x] Done

### Section 6: Final Review and Handoff

- `6.1` [x] Done
- `6.2` [x] Done
- `6.3` [!] Action-needed：等待你批准
- `6.4` [N/A now]：批准后再改 `sprint-status.yaml`

## 3. Impact Analysis

### 3.1 Epic Impact

- `Epic 5`：执行链路不应再由“context completeness”阻断；需改为“默认自动推进 + 显式假设卡 + 高风险才中断”。
- `Epic 6`：追问与纠偏从“主链路前置条件”降级为“可选增强操作”，避免默认干扰首次执行。
- `Epic 10`：AI-native interaction 需从文档落地到真实 UI，重点是“侧滑流程看板 + 可隐藏 + 专业状态语义”。

### 3.2 Story Impact

- 必改：
  - `5.1` 提交执行入口
  - `5.2` 流式反馈与事件协议
  - `6.1`~`6.3` 追问/补充/重规划角色定位
  - `10.1`~`10.3` runtime + renderer + projection
- 新增建议：
  - `10.6`（新）侧滑流程看板与专家模式（可隐藏）

### 3.3 Artifact Conflicts

- `PRD`：需补“默认自动执行，不以用户手填为前置门槛”的要求。
- `epics.md`：需改 AC 语义，防止开发继续把“补充条件”当作必经流程。
- `architecture.md`：需明确“中断阈值策略（blocking vs non-blocking）”。
- `ux-design-specification.md` / `ux-epic-10-ai-native-interaction-addendum.md`：需新增“Progress Board = side sheet”交互规范和信息分层优先级。

### 3.4 Technical Impact

- 页面结构将从“多面板默认全开”改为“主叙事流 + 侧滑看板 + 高级控制折叠”。
- `execute` 路由增加非阻断分支：当上下文部分不确定时先自动执行最小可行链路并明确披露假设。
- 流式消息需要加入“步骤状态 / 工具态 / 推理摘要 / 假设与风险”四类标准 part。

## 4. Recommended Approach

### 4.1 Chosen Path

选择 `Hybrid（Direct Adjustment + MVP Focus Correction）`：

- 保留当前已实现的底层执行与治理能力。
- 重构交互主链，让“自动执行”回到默认路径。
- 把“追问/纠偏/补充条件”改为二级增强能力，不再默认阻断。

### 4.2 Why This Path

- 与当前用户真实预期一致（快、不中断、默认智能体先跑）。
- 不推翻已有工程资产，风险可控。
- 符合现有 PRD/UX 中“解释优先、过程可见、低负担”的目标。

### 4.3 Effort / Risk / Timeline

- Effort：High（涉及 UI 主结构和执行触发策略）
- Risk：Medium（涉及主流程行为变更）
- Timeline 影响：建议作为当前 sprint 第一优先级纠偏，先做 1 个短迭代（2-4 天）完成主链修正，再做 1 个迭代收口流程看板细节

## 5. Detailed Change Proposals (Old -> New)

### 5.1 PRD 调整提案

Artifact: `prd.md`  
Section: `FR-03 / FR-09 / FR-10 / NFR-01`

OLD:

- FR-03 强调“允许用户纠正抽取结果”（实现上易被误读为前置操作）
- FR-09/10 强调多轮追问与纠偏，但未明确“默认非阻断”

NEW:

- 增补一条执行原则（建议新 FR 或在 FR-06/07 后追加）：
  - “系统应默认在最小充分上下文下自动发起分析执行。用户纠偏/补充条件是增强路径，不应成为首轮执行的默认前置门槛。”
- NFR 增补：
  - “首轮执行发起不应被普通缺省字段阻断；仅在高风险歧义（权限、核心指标冲突、实体冲突）时中断并请求确认。”

Rationale:

- 直接消除“先补全再执行”的产品歧义。

### 5.2 Epic 5 调整提案

Artifact: `epics.md`  
Story: `5.1`, `5.2`

OLD (`5.1`):

- 用户发起执行作为显式入口，缺乏“自动发起”的 AC

NEW (`5.1`):

- 新增 AC：
  - “Given 会话刚创建且已完成基础 intent/context 提取，When 无高风险阻断项，Then 系统应自动提交首轮执行任务，无需用户手动补齐全部字段。”
  - “Given 存在非关键缺省字段，Then 系统以显式假设继续执行，并在结果中展示 assumptions。”

OLD (`5.2`):

- 强调流式反馈，但未定义“侧滑流程看板 + 可隐藏”

NEW (`5.2`):

- 新增 AC：
  - “执行过程必须在可折叠的侧滑流程看板中展示步骤、工具、状态和推理摘要。”
  - “用户可随时隐藏/展开流程看板，不影响主结果阅读流。”

Rationale:

- 把“可见过程”从卡片堆叠升级为专业流程面板。

### 5.3 Epic 6 调整提案

Artifact: `epics.md`  
Story: `6.1~6.3`

OLD:

- 语义上容易被实现成“执行前必须先追问/补充/重规划”

NEW:

- 为 `6.1~6.3` 增补边界说明：
  - “该能力属于 second-pass enhancement，不得阻断 first-pass 自动执行主链。”
  - “默认用户无需填写补充条件；系统先执行并给出可追问结论。”

Rationale:

- 保留亮点能力，但防止主流程被反客为主。

### 5.4 Epic 10 调整提案

Artifact: `epics.md`, `ux-epic-10-ai-native-interaction-addendum.md`  
Story: `10.1~10.3` + 新增 `10.6`

OLD:

- 已有 runtime/renderer/projection 抽象，但缺少明确“侧滑流程看板”的 story 落地

NEW:

- `10.1` 增补：runtime message parts 增加 `process-board` 投影通道
- `10.2` 增补：renderer registry 增加 `step-timeline`, `tool-state`, `reasoning-summary`, `assumption-card`
- `10.3` 增补：流程看板展开/收起状态持久化与恢复
- 新增 `10.6`（建议）：
  - 标题：`可隐藏的执行流程看板与专家模式`
  - 目标：把流程与思维链摘要放入 side sheet，默认精简，专家可展开

Rationale:

- 让 Epic 10 真正解决当前交互痛点，而不只是基础 runtime 接线。

### 5.5 架构调整提案

Artifact: `architecture.md`

OLD:

- 强调 fail-loud 与治理，但未区分“必须阻断”和“可带假设继续执行”

NEW:

- 增补 `Execution Trigger Policy`：
  - `Blocking`：权限冲突、核心实体冲突、核心指标冲突、严重歧义
  - `Non-blocking`：时间范围缺省、比较基线缺省、次要约束缺省
  - `Non-blocking` 情况下继续执行，并输出 assumption trace（可审计）

Rationale:

- 避免“治理化=一律阻断”的误实现。

### 5.6 UI 具体改造提案（代码层）

Artifact: `src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx`

OLD:

- 会话元信息、context、plan、follow-up、history 默认全部主区展开

NEW:

- 主区默认只保留：
  - 问题头部（简化）
  - 实时执行与结论主叙事流
  - 一键“继续追问”
- 次级能力改为折叠/抽屉：
  - Context 修正
  - 候选因素细节
  - 历史轮次

Artifact: `analysis-plan-panel.tsx`

OLD:

- `blockingMessage` 直接禁用执行按钮

NEW:

- 默认自动执行；按钮改为“重跑/手动重试”
- 当非关键缺省时显示“带假设执行”提示，不禁用
- 仅高风险阻断时禁用并给出明确冲突类型

Artifact: `analysis-execution-stream-panel.tsx` + `analysis-execution-live-shell.tsx`

OLD:

- 主区卡片流，不具备可隐藏流程看板

NEW:

- 引入 side sheet（可展开/收起）作为流程看板
- 主区聚焦结论与关键阶段发现
- 看板聚焦步骤、工具态、推理摘要、状态

## 6. Implementation Handoff

### 6.1 Scope Classification

- `Major`

### 6.2 Handoff Recipients

- `PM / Architect`：批准主链策略变更与 story 调整
- `PO / DEV`：落地 story 改写、优先级重排、实施拆解

### 6.3 Execution Responsibilities

1. 先改文档和 story AC（PRD/Epics/UX/Architecture）并冻结新主链定义。
2. 再做实现切分：
   - Slice A：自动执行与非阻断策略
   - Slice B：主区信息降噪与可折叠高级控制
   - Slice C：侧滑流程看板与状态持久化
3. 最后补测试：
   - 首轮自动执行不中断
   - 仅高风险冲突触发阻断
   - 看板可隐藏且不影响主叙事流

### 6.4 Success Criteria

- 用户进入会话后无需先手填补充条件即可开始分析。
- 首轮在 5 秒内看到执行反馈和阶段性进展。
- 追问/纠偏仍可用，但不再成为默认前置步骤。
- 执行过程拥有专业侧滑看板，可隐藏、可恢复、可审阅。

## 7. Approval Gate

请确认本提案是否批准进入实施：

- `yes`：我将按本提案继续更新受影响的规划工件（PRD/Epics/UX/Architecture）并同步 `sprint-status` 建议。
- `revise`：你指出要改的段落，我会立即重排提案。
