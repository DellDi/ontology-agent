---
date: '2026-03-26'
project: 'ontology-agent'
workflow: 'correct-course'
mode: 'batch'
status: 'approved'
change_scope: 'major'
approved_date: '2026-03-26'
---

# Sprint Change Proposal

## 1. 问题摘要

### 触发背景

本次变更不是来自单一 story 的实现失败，而是来自当前规划与实施主线之间的一个结构性断层：

- `Story 3.1` 与 `Story 3.2` 已经开始交付“问题理解 / 上下文抽取”能力
- 当前 Epic 3 与 Epic 4 已经准备继续推进“计划生成 -> 后台执行 -> 结论输出”
- 但 PRD、架构和现有 stories 中，并没有把以下关键能力拆成可开发、可验证的实施故事：
  - 服务端 `LLM Provider` 接入
  - `OpenAI-compatible` 通用模型适配
  - 真实 `ERP` 业务数据读取与防腐层
  - `Cube` 语义层读路径
  - `Neo4j` 图谱读写与同步

### 问题类型

**原始需求已存在，但在 Sprint 实施阶段发现故事分解不完整，需要重新编排实施顺序。**

### 核心问题陈述

当前规划已经在架构层明确选择了 `Cube`、`Neo4j`、`ERP` 服务端集成与 `LLM Provider` 服务端边界，但在 Epic/Story 层没有把这些能力拆成中间层实施故事，导致后续 Epic 4 “执行分析并输出归因结论”会缺少真正可执行的数据读取与 AI 编排基础。若继续按现有故事线推进，团队只能在执行阶段临时补接真实数据源和模型提供方，风险高、返工大，也会让前面完成的 `3.x` 交互层建立在不可持续的 stub 基础上。

### 支撑证据

- [`prd.md`]({project-root}/_bmad-output/planning-artifacts/prd.md) 已明确要求：
  - “系统必须支持调用外部工具和内部能力，而不是只依赖单次模型输出”
  - “浏览器端不得直连核心数据源、核心分析服务或模型密钥”
- [`architecture.md`]({project-root}/_bmad-output/planning-artifacts/architecture.md) 已明确选择：
  - `Cube Core 1.6.x`
  - `Neo4j 5.26 LTS`
  - ERP Postgres 为事实来源
  - 浏览器端不得直连 `Cube / Neo4j / Redis / LLM Provider`
  - 实施顺序中第 8、9 步才接 `Neo4j / Cube`
- [`epics.md`]({project-root}/_bmad-output/planning-artifacts/epics.md) 当前只有：
  - `3.x` 问题理解与计划生成
  - `4.x` 执行分析与输出结果
  - 没有显式 `LLM / ERP / Cube / Neo4j` 接入 stories
- 当前 [`sprint-status.yaml`]({project-root}/_bmad-output/implementation-artifacts/sprint-status.yaml) 显示：
  - `3.1`、`3.2` 已到 `review`
  - `3.3-3.5`、`4.1-4.4` 均未真正开发
  - 现在调整顺序仍然成本可控

## 2. Checklist 结果

### Section 1: Trigger and Context

- `1.1` [x] Done：触发点为 `Story 3.1 / 3.2` 进入实施后，用户明确发现真实 AI 与真实数据接入层没有 story 化
- `1.2` [x] Done：问题性质为“原始需求已存在，但 story 分解遗漏了关键实施层”
- `1.3` [x] Done：已有 PRD、架构、epics 三方证据支撑

### Section 2: Epic Impact Assessment

- `2.1` [x] Done：Epic 3 仍可继续，但应限定为“provider-agnostic 的理解与计划骨架”
- `2.2` [x] Done：需要新增一个“真实 AI 与数据源接入”Epic
- `2.3` [x] Done：现有 Epic 4-7 均受影响
- `2.4` [x] Done：现有执行、追问、治理、移动端 Epic 不应删除，但必须整体后移
- `2.5` [x] Done：Epic 顺序需要调整

### Section 3: Artifact Conflict and Impact Analysis

- `3.1` [x] Done：PRD 核心目标不变，但需补“LLM 与真实数据接入是 MVP 的实施前置”
- `3.2` [x] Done：Architecture 缺少面向 stories 的中间层拆分，需要补 AI/data adapter 组件与实施顺序
- `3.3` [N/A] Skip：UX 交互层基本不需大改，但执行前的计划页应继续允许“尚未接真实执行”的状态
- `3.4` [x] Done：Epics、remaining stories、sprint-status、后续 create-story 全部会受影响

### Section 4: Path Forward Evaluation

- `4.1` [x] Viable：直接调整现有 backlog，新增 AI/data integration Epic，可行
- `4.2` [ ] Not viable：不建议回滚 `3.1 / 3.2`，这些骨架仍有价值
- `4.3` [ ] Not viable：不需要缩减 PRD MVP 目标，只需要把缺失的中间层补齐
- `4.4` [x] Done：推荐 **Hybrid = Direct Adjustment + Backlog Reorganization**

### Section 5: Proposal Components

- `5.1` [x] Done
- `5.2` [x] Done
- `5.3` [x] Done
- `5.4` [x] Done
- `5.5` [x] Done

### Section 6: Final Review and Handoff

- `6.1` [x] Done
- `6.2` [x] Done
- `6.3` [x] Done：用户已于 `2026-03-26` 明确批准
- `6.4` [x] Done：进入规划工件与 story 编号调整实施
- `6.5` [x] Done：已定义 handoff 角色与顺序

## 3. 影响分析

### Epic 3 的影响

- **状态判断：** 可继续，但需明确边界
- **保留内容：**
  - `3.1` 结构化分析意图
  - `3.2` 上下文抽取与展示
  - `3.3` 用户修正抽取结果
  - `3.4` 扩展候选影响因素
  - `3.5` 生成并展示多步分析计划
- **需要补充的约束：**
  - Epic 3 应只负责“理解、抽取、修正、计划”
  - 允许使用 deterministic / provider-agnostic 的实现站稳契约
  - 不要求在 Epic 3 内直接完成真实 `LLM / Cube / Neo4j / ERP` 调用

### 现有 Epic 4 的影响

- **状态判断：** 目标仍成立，但不应直接开始
- **原因：**
  - 当前 `4.1-4.4` 假定系统已经具备真实执行能力
  - 但这些执行能力依赖：
    - LLM 规划/重写/总结
    - ERP 业务数据读取
    - Cube 语义查询
    - Neo4j 关系推理
    - 工具注册与编排桥
- **处理建议：**
  - 将现有 Epic 4 整体后移为新 Epic 5

### 现有 Epic 5 / 6 / 7 的影响

- **状态判断：** 保留目标，但顺序整体后移
- **处理建议：**
  - 现 Epic 5 → 新 Epic 6
  - 现 Epic 6 → 新 Epic 7
  - 现 Epic 7 → 新 Epic 8

### Artifact 冲突与修改需求

#### PRD

- **冲突程度：中**
- **问题：** 已要求支持 AI 编排与受控数据访问，但没明确这些接入层是 MVP 主线前置
- **需要修改：**
  - 增加一条实施约束：在执行类 story 前，必须完成服务端 LLM 与真实数据接入基线

#### Architecture

- **冲突程度：中**
- **问题：** 技术选型清楚，但缺少“从选型到可开发 story”的中间层拆分
- **需要修改：**
  - 增加组件说明：
    - LLM Provider Adapter
    - Prompt / Structured Output Guardrails
    - ERP Read Anti-Corruption Layer
    - Cube Semantic Query Adapter
    - Neo4j Graph Adapter
    - Graph / Semantic ETL Sync Baseline
  - 调整实施顺序：在执行 Epic 前先接入这些适配层

#### Epics

- **冲突程度：高**
- **问题：** 缺少一个完整 Epic 来承接真实 AI 与数据能力
- **需要修改：**
  - 新增 Epic 4：真实 AI 与数据源接入基线
  - 现有 Epic 4-7 整体后移

#### UX

- **冲突程度：低**
- **判断：** 现有工作台、上下文区、计划区不需要推翻
- **需要补充：**
  - 在 Epic 3 阶段允许“计划已生成但尚未接入真实执行”的清晰状态
  - 执行故事开始后再逐步填入真实证据与结果

#### 其他实施工件

- `sprint-status.yaml` 需要增加新的 epic 与故事顺序
- 现有 `4.x` 到 `7.x` story 文件需要重新编号或重新生成
- 后续 `create-story` 与 `dev-story` 入口要切换到新的执行顺序

## 4. 推荐路径

### 选定方案

**Hybrid：直接调整 backlog + 新增真实 AI / 数据接入 Epic + 重新排序执行主线**

### 不选回滚的原因

- `3.1 / 3.2` 已经沉淀出稳定的意图与上下文交互骨架
- 这些 story 的价值在于站稳产品契约，而不是必须一步到位接真实模型
- 回滚会损失已经完成的页面、契约与测试收益

### 不选缩减 MVP 的原因

- 你的产品明确是“真正接业务数据、真正做分析”，不是纯演示系统
- `LLM / Cube / Neo4j / ERP` 接入不是“锦上添花”，而是这个 MVP 的核心组成
- 问题在于故事线不完整，不在于目标过大

### 选定方案的理由

- 当前 `3.3+` 和 `4.x+` 还未开发，重排成本仍低
- 把 AI/data integration 单独 story 化，能避免执行层临时缝合
- 这样后续每条 story 的验收会更可验证：
  - 是接模型了，还是没接
  - 是接真实数据了，还是还在 stub
  - 是走 Cube 了，还是还在本地假数据

### 风险评估

- **实施工作量：高**
- **计划扰动：中高**
- **返工节省：高**
- **长期收益：非常高**

## 5. 详细变更提案

### 5.1 Epic 结构变更提案

#### OLD

- Epic 3: 问题理解与分析计划生成
- Epic 4: 执行分析并输出归因结论
- Epic 5: 多轮追问、纠偏与重规划
- Epic 6: 企业级治理、审计与自托管运营
- Epic 7: 移动端结果查看与轻量追问（Growth）

#### NEW

- Epic 3: 问题理解与分析计划生成
- **Epic 4: 真实 AI 与数据源接入基线**
- Epic 5: 执行分析并输出归因结论
- Epic 6: 多轮追问、纠偏与重规划
- Epic 7: 企业级治理、审计与自托管运营
- Epic 8: 移动端结果查看与轻量追问（Growth）

#### Rationale

Epic 3 和执行 Epic 之间缺少“真实能力接线层”。这层不应隐含在执行故事里，而应独立成 Epic。

### 5.2 新 Epic 4 建议内容

#### Epic 4: 真实 AI 与数据源接入基线

平台在进入真实执行前，先完成服务端 LLM 接入、ERP 只读防腐层、Cube 语义层读路径、Neo4j 图谱读写与同步基线，以及工具编排桥接，使后续执行类 story 建立在真实能力之上而不是 stub 之上。  
**FRs covered:** FR2, FR4, FR5, FR6, FR12, FR13  
**NFRs covered:** NFR4, NFR7, NFR9, NFR10  

#### 建议故事拆分

**Story 4.1: 服务端 LLM Provider 适配层与 OpenAI 兼容接入**  
目标：建立服务端模型调用入口，支持 OpenAI-compatible API、密钥管理、超时重试、限流和基础健康检查。

**Story 4.2: 结构化输出契约与 Prompt/Schema Guardrails**  
目标：为意图、上下文增强、计划步骤、工具选择建立 Zod 驱动的结构化输出约束，避免模型输出直接裸入系统。

**Story 4.3: ERP 只读防腐层与权限过滤数据访问基线**  
目标：建立从 ERP 读取组织、项目、区域、业务事实数据的服务端防腐层，明确 scope 过滤与只读边界。

**Story 4.4: Cube 语义层只读查询接入**  
目标：接入 Cube 作为指标治理读路径，提供受控 metric query adapter，不走 ERP 主写路径。

**Story 4.5: Neo4j 图谱接入与关系/因果边同步基线**  
目标：建立实体关系查询 adapter 和最小同步基线，为候选因素扩展与关系推理提供真实读路径。

**Story 4.6: 分析工具注册表与编排桥接**  
目标：将 LLM、ERP、Cube、Neo4j 以受控工具方式挂入 worker / application orchestration，为后续执行 stories 提供统一编排入口。

### 5.3 现有执行 Epic 的重排提案

#### OLD

- `4.1` 提交分析计划到后台执行
- `4.2` 流式反馈执行进度与阶段结果
- `4.3` 输出带证据的归因结论
- `4.4` 保存步骤结果与最终结论

#### NEW

- `5.1` 提交分析计划到后台执行
- `5.2` 流式反馈执行进度与阶段结果
- `5.3` 输出带证据的归因结论
- `5.4` 保存步骤结果与最终结论

#### Rationale

执行类 stories 应建立在真实 LLM 与真实数据工具层已存在的前提上，否则它们只能继续以 stub 形式交付。

### 5.4 PRD 变更提案

#### Section: AI 原生分析平台要求 / 全栈产品要求

**NEW ADDITION**

- 在进入执行类故事前，MVP 必须先完成服务端 `LLM Provider` 接入以及真实业务数据读路径接入，包括 `ERP` 只读防腐层、`Cube` 语义层、`Neo4j` 图谱能力和统一工具编排桥接；这些能力属于 MVP 执行链路的前置条件，而不是后续优化项。

#### Rationale

这不是扩大范围，而是把已经隐含在 PRD 里的核心依赖显式化。

### 5.5 Architecture 变更提案

#### Section: 数据架构 / 认证与安全 / API 与通信模式 / 实施顺序

**NEW ADDITION**

- 新增组件：
  - `LLM Provider Adapter`
  - `Prompt Registry + Structured Output Guardrails`
  - `ERP Read Anti-Corruption Layer`
  - `Cube Semantic Query Adapter`
  - `Neo4j Graph Adapter`
  - `Graph / Semantic ETL Sync Baseline`
  - `Tool Registry + Orchestration Bridge`
- 调整实施顺序：
  1. 完成 Epic 3 的理解与计划骨架
  2. 接入服务端 LLM 与真实数据源适配层
  3. 再推进执行、流式反馈、结果和证据

#### Rationale

架构文档目前只有选型，没有把这些选型转换成可开发中间层。

### 5.6 Sprint Status 变更提案

#### 建议重排

**OLD**

- epic-3: in-progress
- epic-4: in-progress
- epic-5: in-progress
- epic-6: in-progress
- epic-7: in-progress

**NEW**

- epic-3: in-progress
- epic-4: backlog  ← 新真实 AI 与数据源接入 Epic
- epic-5: backlog  ← 原执行 Epic
- epic-6: backlog  ← 原多轮追问 Epic
- epic-7: backlog  ← 原治理 Epic
- epic-8: backlog  ← 原移动端 Epic

#### 故事级建议

- 保持 `3.3`、`3.4`、`3.5` 为下一批开发入口
- 完成 `3.5` 后，不直接进入现 `4.1`
- 先创建新 `4.1-4.6`
- 原 `4.1-4.4` story 文件转为 `5.1-5.4`

## 6. 高层行动计划

### 建议执行顺序

1. 批准本提案
2. 更新 `epics.md`，插入新 Epic 4 并整体后移后续 Epic
3. 更新 `architecture.md` 与 `prd.md`，补齐 AI/data integration 组件和实施顺序
4. 重新生成受影响的 story 文件：
   - 新 `4.1-4.6`
   - 原执行 Epic 改号为 `5.1-5.4`
   - 后续 Epic 整体顺延
5. 更新 `sprint-status.yaml`
6. 继续开发顺序：
   - 先 `DS 3.3`
   - 再 `DS 3.4`
   - 再 `DS 3.5`
   - 然后切入新 `4.1`

## 7. 实施交接建议

### Scope Classification

**Major**

原因：

- 需要修改 `PRD / Architecture / Epics / Sprint Status`
- 需要新增一整组 AI/data integration stories
- 需要整体后移当前执行、治理、移动端故事线

### 建议 handoff

- **Product Manager / Architect**
  - 确认新 Epic 4 的边界是否覆盖你的真实产品目标
  - 确认 ERP / Cube / Neo4j / LLM 的职责分层
- **Scrum Master**
  - 重排 backlog、更新 epics 和 sprint-status
  - 重新生成 story 文件
- **Development**
  - 在批准后的新顺序下继续执行

## 8. 审批请求

本提案建议：

- 不回滚当前 `3.1 / 3.2`
- 不缩减 MVP
- 插入一个新的“真实 AI 与数据源接入”Epic
- 将当前执行类 Epic 整体后移

等待你的明确审批：

- `同意`：我下一步直接帮你把 `epics.md / architecture.md / prd.md / sprint-status.yaml` 改好，并补齐新的 stories 规划入口
- `修改`：你指出想调整的边界，我基于这份提案再修一版
