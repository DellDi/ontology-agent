---
date: '2026-04-08'
project: 'ontology-agent'
workflow: 'correct-course'
mode: 'batch'
status: 'approved'
change_scope: 'moderate'
approved_date: '2026-04-08'
---

# Sprint Change Proposal

## 1. 问题摘要

### 触发背景

本次变更触发点来自 `Story 4.5` 已经完成“Neo4j 图谱查询适配器 + 最小同步基线”之后，项目在真实环境中继续推进到了：

- 真实 `PG -> Neo4j` baseline 同步
- 真实分析执行依赖 Neo4j 候选因素查询
- 对“首次全量 + 后续增量 + 持续交付”的正式运行方案设计

此时暴露出的核心问题不是“4.5 做错了”，而是：

- `4.5` 的完成范围是 **baseline**
- 但当前系统已经需要 **运行化 graph sync**
- 这部分还没有进入正式的 story / sprint 编排

### 问题类型

这是一次 **执行阶段发现的范围外延显化**，性质上属于：

- 已有需求的深化，而不是产品方向反转
- 运行模型从“可手工执行”提升到“可持续交付、可运营、可恢复”
- 需要纳入 backlog 的正式扩编，而不是继续停留在补充文档

### 核心问题陈述

当前 [graph-sync-baseline.md]({project-root}/docs/data-contracts/graph-sync-baseline.md) 已经定义了“同步什么”，而 [graph-sync-operating-model.md]({project-root}/docs/data-contracts/graph-sync-operating-model.md) 已经定义了“怎么运行与持续同步”。

真正的缺口在于：

- `_bmad-output/implementation-artifacts` 中没有对应 story
- `sprint-status.yaml` 中没有这部分的计划位
- `epics.md` 还没有把 graph sync 的运行元数据、增量扫描、dirty scope 派发、调度/补偿和持续运维纳入正式交付

如果现在直接编码实现，会出现：

- baseline 已完成，但运行管理层没有正式验收边界
- 运维与持续交付能力被散落到脚本和代码里
- 后续 `Epic 7` 的部署、监控、可用性 story 无法准确承接 graph sync

### 支撑证据

- [4-5-neo4j-graph-adapter-and-sync-baseline.md]({project-root}/_bmad-output/implementation-artifacts/4-5-neo4j-graph-adapter-and-sync-baseline.md) 明确交付的是“最小同步基线”，不是长期运行模型
- [graph-sync-operating-model.md]({project-root}/docs/data-contracts/graph-sync-operating-model.md) 已经新增了运行层设计，包括：
  - `graph_sync_runs`
  - `graph_sync_cursors`
  - `graph_sync_dirty_scopes`
  - `full-bootstrap / org-rebuild / incremental-rebuild`
  - scheduler / dispatcher / consistency sweep
- [epics.md]({project-root}/_bmad-output/planning-artifacts/epics.md) 中当前 `Epic 7` 只覆盖：
  - 权限
  - 审计
  - 自托管部署
  - 监控
  - 登录桥接
  尚未覆盖 graph sync 运行化
- [sprint-status.yaml]({project-root}/_bmad-output/implementation-artifacts/sprint-status.yaml) 当前没有对应 story 条目

## 2. Checklist 结果

### Section 1: Trigger and Context

- `1.1` [x] Done：触发故事为 `Story 4.5`，其 baseline 已完成，但运行化能力未纳入正式 story
- `1.2` [x] Done：问题类型为“原有需求深化后需要 backlog 结构调整”
- `1.3` [x] Done：已有 baseline 文档、operating model 文档、epics 和 sprint status 可作为证据

### Section 2: Epic Impact Assessment

- `2.1` [x] Done：`Epic 4` 仍可视为 baseline epic，不建议回滚或重开
- `2.2` [x] Done：建议 **不新增独立 Epic**，优先把 graph sync 运行化收编进 `Epic 7`
- `2.3` [x] Done：受影响最大的是 `Epic 7`；`Epic 4` 需要边界说明，但不需要重写
- `2.4` [x] Done：现有 epics 没有失效，但 `Epic 7` 需要补 story
- `2.5` [x] Done：建议把 graph sync 运行化优先级提到 `Epic 7` 的中前段，不再视为远期优化

### Section 3: Artifact Conflict and Impact Analysis

- `3.1` [x] Done：PRD 核心目标不冲突，本次主要是交付面细化，PRD 可选补充，不是 blocker
- `3.2` [x] Done：Architecture 需要补充 graph sync 运行管理层
- `3.3` [N/A]：UX 不直接受影响，无需修改核心交互文档
- `3.4` [x] Done：epics、implementation artifacts、部署与监控文档都需要承接

### Section 4: Path Forward Evaluation

- `4.1` [x] Viable：直接在现有 epic 结构内补 story 和架构补遗，可行
- `4.2` [ ] Not viable：不建议回滚 `4.5` 或真实同步代码
- `4.3` [ ] Not viable：不需要缩减 MVP，问题不是产品范围过大，而是交付编排缺口
- `4.4` [x] Done：推荐 **Direct Adjustment + Epic 7 backlog expansion**

### Section 5: Proposal Components

- `5.1` [x] Done
- `5.2` [x] Done
- `5.3` [x] Done
- `5.4` [x] Done
- `5.5` [x] Done

### Section 6: Final Review and Handoff

- `6.1` [x] Done
- `6.2` [x] Done
- `6.3` [x] Done：用户已于 `2026-04-08` 批准继续执行
- `6.4` [x] Done：继续回写 `epics.md` 与 `sprint-status.yaml`
- `6.5` [x] Done：handoff 方案已明确

## 3. 影响分析

### Epic 4 的影响

- **状态判断：** `Epic 4` 不应被重开
- **原因：**
  - `4.5` 的原始承诺是 baseline，不是完整运行平台
  - 当前 baseline 已具备真实 adapter、真实 sync entry 和真实图查询能力
- **需要修正：**
  - 在 `4.5` 的边界说明中补一句：长期运行管理与增量策略转入 `Epic 7`

### Epic 7 的影响

- **状态判断：** 这是本次 change 的主要落点
- **原因：**
  - `Epic 7` 本来就是“企业级治理、审计与自托管运营”
  - graph sync 的持续运行、调度、补偿、可观测性，本质上属于平台运营能力
- **需要修正：**
  - 增加 graph sync 运行化 story
  - 将部署与监控 story 显式覆盖 graph sync runner / scheduler / metrics

### Epic 5 / 6 的影响

- **状态判断：** 间接受益，但不建议把 graph sync 运行化放回执行 epic
- **原因：**
  - `Epic 5/6` 面向分析用户功能
  - graph sync 运行层属于平台支撑与数据新鲜度保障

### PRD 的影响

- **冲突程度：低**
- **判断：**
  - PRD 已要求 Neo4j 来自 ETL 与受控增强流程
  - 本次更多是把这条要求落成可运营的实施面
- **建议：**
  - 可选补一条“关键读模型同步需要具备可恢复与持续运行能力”的实施约束
  - 但不作为本次变更的必须前置

### Architecture 的影响

- **冲突程度：中**
- **当前问题：**
  - 已有 `Graph / Semantic ETL Sync Baseline`
  - 但缺 graph sync run metadata、cursor、dirty scope、scheduler、dispatcher 的正式表达
- **需要修改：**
  - 在数据架构或运行架构中新增 graph sync operating layer

### 部署 / 监控文档的影响

- **冲突程度：中**
- **原因：**
  - 一旦 graph sync 进入长期运行，就不再只是开发脚本
  - 必须进入部署清单、调度清单与观测面板

## 4. 推荐路径

### 选定方案

**Direct Adjustment：保持 `Story 4.5` 为 baseline 完成态，并把 graph sync 的运行化能力正式纳入 `Epic 7`。**

### 为什么不建议重开 4.5

- `4.5` 已经完成了它承诺的 baseline：
  - graph adapter
  - controlled sync entry
  - real candidate factor query path
- 如果现在重开 `4.5`，会把“能力基线”和“运行化运营层”混成一件事，导致 story 边界失真

### 为什么推荐落到 Epic 7

- graph sync 的首次全量、后续增量、补偿重建、持续调度和观测，本质是平台运行能力
- 它与：
  - `7.3` 自托管部署
  - `7.4` 运行监控
  在职责上天然连贯
- 这样能保持：
  - `Epic 4` = 真实能力接入 baseline
  - `Epic 7` = 企业运行与交付能力

### 风险评估

- **实施工作量：中**
- **时间影响：中**
- **返工风险：低于把它塞回 4.5**
- **长期收益：高**

## 5. 详细变更提案

### 5.1 Epic 变更提案

#### Epic 7 增补 Story 7.6

**NEW**

### Story 7.6: 图谱同步运行元数据与组织级重建

As a 企业运维负责人,  
I want 对 Neo4j 图谱同步建立运行元数据记录和组织级重建能力,  
So that 图谱基线同步不再只是一次性脚本，而是可追踪、可恢复、可校正的正式运行流程。

**关联需求：** FR4, FR13, NFR6, NFR7；附加需求（Neo4j、自托管、调度）

**Acceptance Criteria:**

**Given** 平台需要执行一次图谱 baseline 或指定组织重建  
**When** graph sync job 开始运行  
**Then** 系统应创建可检索的 run 记录  
**And** 记录 scope、mode、cursor snapshot、节点/边写入统计和失败摘要

**Given** 某个组织执行 graph rebuild  
**When** Neo4j 写入节点与边  
**Then** 所有对象应带 `scope_org_id`、`last_seen_run_id`、`last_seen_at`  
**And** scoped cleanup 不得跨组织误删其他范围数据

#### Epic 7 增补 Story 7.7

**NEW**

### Story 7.7: 图谱增量扫描与脏范围派发

As a 企业运维负责人,  
I want 平台按 watermark 识别变更并派发 dirty scope 重建,  
So that Neo4j 图谱可以持续跟上 ERP staging 的变化，而不是长期依赖手工全量重刷。

**关联需求：** FR4, FR13, NFR6, NFR7

**Acceptance Criteria:**

**Given** 各 ERP staging source 存在可用的时间戳或主键游标  
**When** 增量扫描任务运行  
**Then** 系统应根据 watermark 识别变更 source  
**And** 将受影响 `organizationId` 写入 dirty scope 队列

**Given** dirty scope 已被派发  
**When** dispatcher 消费任务  
**Then** 系统应以 `organizationId` 为最小增量单元执行 `org-rebuild`  
**And** 仅在成功处理后推进相应 cursor

#### Epic 7 增补 Story 7.8

**NEW**

### Story 7.8: 图谱同步调度、补偿与一致性巡检

As a 企业运维负责人,  
I want 为 graph sync 提供 scheduler、失败补偿和一致性巡检,  
So that 图谱同步可以长期运行并在异常后恢复，而不是依赖人工盯守。

**关联需求：** NFR6, NFR7；附加需求（Scheduler、结构化日志、监控）

**Acceptance Criteria:**

**Given** graph sync 已进入常态运行  
**When** scheduler 周期性触发增量与巡检任务  
**Then** 平台应支持 `incremental / dispatch / consistency-sweep` 三类 job  
**And** 支持人工触发 `bootstrap / org-rebuild`

**Given** 某次增量或重建失败  
**When** 运维团队查看系统状态  
**Then** 平台应保留失败 run、重试次数和待补偿 dirty scope  
**And** 不因单次失败导致 cursor 错误前移

### 5.2 现有 Story 7.3 变更提案

**Story:** `7.3 自托管容器化部署基线`  
**Section:** Acceptance Criteria

**OLD**

- 核心服务应能够以容器方式启动
- 应存在能够表达这些组件边界的容器化配置

**NEW**

- 核心服务应能够以容器方式启动
- 部署基线除 `web / worker / Postgres / Redis / Cube / Neo4j` 外，还应明确 `graph sync job runner / scheduler` 的运行边界
- 应存在能够表达这些组件边界的容器化配置

**Rationale：** graph sync 进入正式运行后，不能只作为开发脚本存在，必须进入部署模型。

### 5.3 现有 Story 7.4 变更提案

**Story:** `7.4 建立运行监控与可用性观测`  
**Section:** Acceptance Criteria

**OLD**

- 应能看到基础服务健康状态、分析任务状态和关键错误信息

**NEW**

- 应能看到基础服务健康状态、分析任务状态、graph sync run 状态、dirty scope 积压和关键错误信息

**Rationale：** graph sync 如果不进观测面，后续会成为隐性故障源。

### 5.4 Architecture 变更提案

**Section:** 数据架构 / 运行架构

**OLD**

- `Graph / Semantic ETL Sync Baseline` 负责把 ERP 事实、语义层需要的聚合结构和图谱边界同步到各自读模型。

**NEW**

- `Graph / Semantic ETL Sync Baseline` 负责把 ERP 事实、语义层需要的聚合结构和图谱边界同步到各自读模型。
- 对 Neo4j 图谱同步，平台需额外提供运行管理层，包括：
  - `graph_sync_runs`
  - `graph_sync_cursors`
  - `graph_sync_dirty_scopes`
  - `full-bootstrap / org-rebuild / incremental-rebuild`
  - scheduler / dispatcher / consistency-sweep
- 增量同步 v1 以 `organizationId` 为最小重建单元，不采用逐条 CDC patch 图边。

**Rationale：** 当前架构文档已定义 baseline，但尚未正式定义运行管理层。

### 5.5 Implementation Artifacts 变更提案

批准后建议新增以下 implementation artifacts：

- `7-6-graph-sync-run-metadata-and-org-rebuild.md`
- `7-7-graph-sync-incremental-scan-and-dirty-scope-dispatch.md`
- `7-8-graph-sync-scheduling-compensation-and-consistency-sweep.md`

并在 `sprint-status.yaml` 中新增对应条目，初始状态建议为：

- `7-6`: `ready-for-dev`
- `7-7`: `ready-for-dev`
- `7-8`: `ready-for-dev`

## 6. 推荐实施顺序

1. `7.6` 先落地  
   原因：先建立 run metadata、scope cleanup 和 org-rebuild 的正式边界

2. `7.7` 再落地  
   原因：有了可追踪 run 之后，再做 cursor 和 dirty scope 派发更稳

3. `7.8` 最后落地  
   原因：调度、补偿和一致性 sweep 要建立在前两者之上

## 7. 实施交接

### 变更范围判定

**Moderate**

原因：

- 不需要推翻 PRD / Architecture 主方向
- 需要 backlog 重组和 story 新增
- 需要更新 epics、implementation artifacts、sprint status
- 需要后续开发与运维 story 联动

### 角色交接

- **Scrum Master / Correct Course**  
  负责批准后回写 epics、story 编排和 sprint status

- **Create Story**  
  先创建 `7.6`，再按顺序创建 `7.7`、`7.8`

- **Development**  
  按新的 story 顺序实施 graph sync 运行管理层

- **Architecture / Tech Writer**
  负责把 architecture 中的 graph sync operating layer 正式补齐

### 成功标准

- graph sync 不再只是“可手工运行”
- baseline、增量、派发、补偿、巡检有明确 story 边界
- 部署与监控文档正式承接 graph sync 运行面
- sprint status 中能准确表达该能力的推进状态

## 8. 审批状态

当前状态：**已批准，进入回写执行**

后续执行动作：

1. 回写 `epics.md` 的变更提案内容
2. 更新 [sprint-status.yaml]({project-root}/_bmad-output/implementation-artifacts/sprint-status.yaml)
3. 准备 `7.6` 的 story 创建入口
