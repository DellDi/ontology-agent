---
date: '2026-03-25'
project: 'ontology-agent'
workflow: 'correct-course'
mode: 'batch'
status: 'approved'
change_scope: 'moderate'
approved_date: '2026-03-25'
---

# Sprint Change Proposal

## 1. 问题摘要

### 触发背景

当前问题不是来自单一故事失败，而是在 `Story 1.2`、`Story 1.4`、`Story 1.5`、`Story 1.6` 的连续实现中逐步暴露出来的技术约束：

- 登录会话当前仍使用内存会话存储
- 分析会话与历史回看当前仍使用内存存储
- ERP 认证仍为开发期 stub
- 计划中的 `Postgres / Redis / Worker / Docker Compose` 尚未真正接入

### 问题类型

**技术限制在实现过程中被确认，需要重新编排 Sprint 顺序。**

### 核心问题陈述

当前 Epic 1 已经完成了“进入工作台、创建会话、查看历史、边界提示”的产品闭环，但这些能力仍建立在临时基础设施之上。如果继续直接进入 Epic 2 的“意图识别、上下文抽取、计划生成”，将导致后续更多分析能力继续依赖内存存储和开发期会话实现，增加返工风险，并削弱后续 Epic 3 的执行、流式反馈和审计能力的可落地性。

### 支撑证据

- 登录相关实现仍依赖 [memory-session-store.ts]({project-root}/src/infrastructure/session/memory-session-store.ts)
- 分析会话仍依赖 [memory-analysis-session-store.ts]({project-root}/src/infrastructure/analysis-session/memory-analysis-session-store.ts)
- 架构文档已将 `Postgres`、`Redis`、`Worker`、容器化部署列为目标能力，但仓库尚未落地
- 当前 [sprint-status.yaml]({project-root}/_bmad-output/implementation-artifacts/sprint-status.yaml) 中 Epic 2 以后全部仍是 backlog，因此现在调整顺序的成本仍然可控

## 2. Checklist 结果

### Section 1: Trigger and Context

- `1.1` [x] Done：触发故事为 `Story 1.2 / 1.4 / 1.5 / 1.6`
- `1.2` [x] Done：问题性质为实现中发现的基础设施缺口
- `1.3` [x] Done：已有明确代码证据和架构目标偏差

### Section 2: Epic Impact Assessment

- `2.1` [x] Done：Epic 1 仍可按原目标完成，但不宜直接衔接旧 Epic 2
- `2.2` [x] Done：需要新增一个“基础设施基线”Epic
- `2.3` [x] Done：旧 Epic 2-5 都受到顺序影响
- `2.4` [x] Done：无需废弃未来 Epic，但需要插入新 Epic
- `2.5` [x] Done：必须调整 Epic 顺序

### Section 3: Artifact Conflict and Impact Analysis

- `3.1` [x] Done：PRD 核心产品范围不冲突，但实施顺序需要补充说明
- `3.2` [x] Done：Architecture 需要修正“已选底座”和“基础设施引入节奏”
- `3.3` [N/A] Skip：UX 不需要大改，只需保持工作台结构不受影响
- `3.4` [x] Done：Sprint 状态、Story 创建顺序、实现文档都会受影响

### Section 4: Path Forward Evaluation

- `4.1` [x] Viable：直接调整当前计划，新增基础设施 Epic，可行
- `4.2` [ ] Not viable：不建议回滚已完成 Story 1.1-1.6
- `4.3` [ ] Not viable：不需要收缩 PRD 的 MVP 目标
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
- `6.3` [!] Action-needed：等待用户批准
- `6.4` [!] Action-needed：批准后再更新 `epics.md` 与 `sprint-status.yaml`
- `6.5` [x] Done：已给出执行角色与顺序

## 3. 影响分析

### Epic 影响

#### Epic 1

- **状态判断：** 仍成立
- **影响：** 不需要回滚，但不建议立刻标记为 `done`
- **原因：** Epic 1 已交付产品入口闭环，但仍有认证 stub 与内存持久化的已知风险，需要在基础设施基线阶段收口

#### 现有 Epic 2: 问题理解与分析计划生成

- **影响：高**
- **原因：** 继续在内存会话上扩展结构化意图、上下文纠正和计划骨架，会把临时实现固化
- **处理：** 顺延到新 Epic 3

#### 现有 Epic 3: 执行分析并输出归因结论

- **影响：高**
- **原因：** 它本来就依赖真实存储、Redis 和 Worker，更不能在当前状态下优先推进
- **处理：** 顺延到新 Epic 4

#### 现有 Epic 4 / 5 / 6

- **影响：中**
- **原因：** 不需要改目标，但顺序与依赖链必须整体后移

### Artifact 冲突与修改需求

#### PRD

- **冲突程度：低**
- **判断：** 产品目标、范围、用户旅程不需要推翻
- **需要修改：** 增加一条实施顺序说明，明确 MVP 在继续 AI 分析故事前需先落地最小基础设施基线

#### Architecture

- **冲突程度：中**
- **判断：** 文档里既有“手工初始化 Next.js”旧描述，也有基础设施全量目标，但缺少“分阶段接入”说明
- **需要修改：**
  - 修正起步底座为已实现事实：官方 `create-next-app` 路线
  - 增加分阶段基础设施引入顺序：
    - Phase 1：`web + postgres + redis`
    - Phase 2：`worker skeleton`
    - Phase 3：`neo4j`
    - Phase 4：`cube`

#### Epics

- **冲突程度：高**
- **需要修改：**
  - 新增一个基础设施基线 Epic
  - 将旧 Epic 2-6 整体顺延

#### UX

- **冲突程度：低**
- **判断：** 不需要改目标，只要新增基础设施故事时不破坏现有工作台和品牌规则

#### 其他实施工件

- [sprint-status.yaml]({project-root}/_bmad-output/implementation-artifacts/sprint-status.yaml) 需要在提案批准后重排 epic/story 键
- Story 创建顺序需要从“继续 Epic 2”改为“先创建基础设施故事”
- [project-context.md]({project-root}/_bmad-output/project-context.md) 已经记录当前风险，可继续复用

## 4. 推荐路径

### 选定方案

**Hybrid：直接调整当前计划 + 进行 backlog 重组**

### 不选回滚的原因

- Epic 1 已经提供了真实的用户入口与工作台主结构
- 回滚会损失当前已经验证通过的 Story 1.1-1.6
- 当前问题不是“做错了入口”，而是“入口之后的基础设施还没接上”

### 不选缩减 MVP 的原因

- PRD 的 MVP 目标本身仍然成立
- 当前问题是实现顺序，不是产品方向错误

### 选定方案的理由

- 现在调整，成本最低：Epic 2 之后都还未开始开发
- 能让后续意图识别、计划生成、执行编排建立在真实基础设施上
- 能把已知高风险点纳入一轮受控重排，而不是边做边补
- 不会破坏当前已经稳定的 PC 工作台和 UX 方向

### 风险评估

- **实施工作量：中**
- **计划扰动：中**
- **长期收益：高**

## 5. 详细变更提案

### 5.1 Epics 变更提案

#### 方案：插入新 Epic 2，并将现有 Epic 2-6 顺延为 Epic 3-7

**OLD**

- Epic 1: 安全分析工作台与会话入口
- Epic 2: 问题理解与分析计划生成
- Epic 3: 执行分析并输出归因结论
- Epic 4: 多轮追问、纠偏与重规划
- Epic 5: 企业级治理、审计与自托管运营
- Epic 6: 移动端结果查看与轻量追问（Growth）

**NEW**

- Epic 1: 安全分析工作台与会话入口
- **Epic 2: 基础设施基线与平台持久化**
- Epic 3: 问题理解与分析计划生成
- Epic 4: 执行分析并输出归因结论
- Epic 5: 多轮追问、纠偏与重规划
- Epic 6: 企业级治理、审计与自托管运营
- Epic 7: 移动端结果查看与轻量追问（Growth）

**Rationale**

当前最缺的是“让已做好的工作台建立在真实存储和基础服务上”，而不是继续堆叠更高层的 AI 分析能力。

### 5.2 新 Epic 2 建议内容

#### Epic 2: 基础设施基线与平台持久化

用户可以在稳定、可持续、自托管友好的平台底座上使用分析工作台，系统具备真实持久化、基础缓存和后台执行边界，而不是依赖进程内临时状态。  
**FRs covered:** FR11, FR12  
**NFRs covered:** NFR4, NFR7, NFR9  
**附加需求覆盖：** Postgres、Redis、Docker Compose、模块化单体 + Worker、自托管容器化

#### 建议故事拆分

**Story 2.1: Docker Compose 本地基础设施基线**  
目标：建立 `web + postgres + redis` 的本地开发编排，保留后续 `worker` 接入位。

**Story 2.2: Postgres 与 Drizzle 平台 schema 初始化**  
目标：接入真实数据库连接、迁移流程和平台自有 schema。

**Story 2.3: 受保护会话持久化迁移到 Postgres**  
目标：将当前登录会话从内存 store 迁移到数据库。

**Story 2.4: 分析会话与历史持久化迁移到 Postgres**  
目标：将新建分析、历史列表、会话回看迁移到真实持久化。

**Story 2.5: Redis 接入与基础约定**  
目标：建立连接、健康检查、基础 key namespace，为限流、状态同步和后续队列做准备。

**Story 2.6: Worker Skeleton 与最小任务契约**  
目标：建立独立 worker 进程与最小 job contract，为 Epic 4 做准备，但不提前实现完整执行编排。

**Story 2.7: 认证与跳转安全收口**  
目标：修复开发期 ERP stub 暴露问题，并收紧 `next` 跳转白名单。

### 5.3 Architecture 变更提案

#### Section: 起步模板评估

**OLD**

- 选定方案：手工初始化 Next.js App Router

**NEW**

- 选定方案：官方 `create-next-app` 初始化的 Next.js App Router 基线
- 说明：实施已按用户最新决定切换为官方脚手架路线，应以仓库现状为准

**Rationale**

文档必须与实际工程初始化方式一致，否则后续 agent 会反复做错底座判断。

#### Section: 基础设施与部署

**NEW ADDITION**

- 基础设施接入采用分阶段策略，而不是在首轮实现中一次性接入所有中间件：
  1. `web + postgres + redis + docker compose`
  2. `worker skeleton`
  3. `neo4j`
  4. `cube`
- `neo4j` 与 `cube` 在对应业务能力真正开始前再接入，避免过早平台化

**Rationale**

这能减少平台搭建对产品主线的干扰，同时保证后续 Story 建在真实底座上。

### 5.4 PRD 变更提案

#### Section: 项目类型要求 / 架构协同要求

**NEW ADDITION**

- 在继续“意图识别、分析计划生成、执行编排”等 AI 分析故事前，MVP 应先完成最小基础设施基线，包括平台自有数据持久化、基础缓存与后台执行骨架，以避免核心分析能力建立在临时会话和内存存储之上。

**Rationale**

这不会改变产品范围，但会明确实施顺序约束。

### 5.5 Sprint Status 变更提案

#### 建议重排

**OLD**

- epic-1: in-progress
- epic-2: backlog
- epic-3: backlog
- epic-4: backlog
- epic-5: backlog
- epic-6: backlog

**NEW**

- epic-1: in-progress
- epic-2: backlog  ← 新基础设施 Epic
- epic-3: backlog  ← 原 Epic 2
- epic-4: backlog  ← 原 Epic 3
- epic-5: backlog  ← 原 Epic 4
- epic-6: backlog  ← 原 Epic 5
- epic-7: backlog  ← 原 Epic 6

**Rationale**

当前只有 Epic 1 已落地，未来 Epic 全部仍是 backlog，现阶段顺延成本最低。

## 6. 高层行动计划

### 建议执行顺序

1. 先运行一次完整 `Code Review`
2. 批准本提案
3. 更新 `epics.md`
4. 更新 `architecture.md`
5. 更新 `sprint-status.yaml`
6. 创建新 Epic 2 的独立 Story 文件
7. 从 `Story 2.1` 开始开发基础设施基线

### 建议的 Sprint 顺序

- Sprint A：Epic 1 review 收口 + 认证风险修复
- Sprint B：Epic 2 基础设施基线
- Sprint C：Epic 3 问题理解与分析计划生成
- Sprint D：在需要关系推理时接入 `Neo4j`
- Sprint E：继续执行分析与归因主链
- Sprint F：在需要语义层时接入 `Cube`

## 7. 实施交接

### 变更范围分类

**Moderate**

原因：

- 不需要推翻 PRD 和已完成 Story
- 但需要新增 Epic、重排后续 Epic 编号、更新 sprint 工件
- 需要产品、架构和 Scrum 侧协同，而不是只让开发直接继续

### 交接角色与职责

**Scrum Master / Correct Course**

- 批准后更新 Epic 顺序和 Sprint 结构
- 驱动新 Epic 2 的 Story 文件化

**Product Manager**

- 将基础设施基线解释为 MVP 实施顺序约束，而不是产品功能扩张

**Architect**

- 修正架构文档与实际底座不一致处
- 增加分阶段基础设施接入说明

**Developer**

- 先做 Code Review
- 然后从基础设施 Story 开始实现

## 8. 成功标准

- 后续 Epic 3+ 不再建立在内存会话和内存分析会话之上
- `Postgres + Redis + Docker Compose + Worker skeleton` 在继续 AI 分析故事前就绪
- `Neo4j` 与 `Cube` 不被提前平台化，而是在真实依赖出现时接入
- Epic 1 已有代码无需回滚

## 9. 批准后下一步

批准后建议直接按这个顺序执行：

1. `bmad-bmm-code-review`
2. 更新 [epics.md]({project-root}/_bmad-output/planning-artifacts/epics.md)
3. 更新 [architecture.md]({project-root}/_bmad-output/planning-artifacts/architecture.md)
4. 更新 [sprint-status.yaml]({project-root}/_bmad-output/implementation-artifacts/sprint-status.yaml)
5. 为新 Epic 2 创建 Story 文件
