---
date: '2026-04-09'
project: 'ontology-agent'
workflow: 'correct-course'
mode: 'batch'
status: 'approved'
change_scope: 'moderate'
approved_date: '2026-04-09'
---

# Sprint Change Proposal

## 1. 问题摘要

### 触发背景

项目当前已经完成：

- `Epic 5`：执行分析、流式反馈、归因结论、结果持久化
- `Epic 6`：多轮追问、纠偏、重规划、多轮历史
- `Epic 7.6 ~ 7.8`：图谱同步运行化

在这些能力落地之后，系统已经不再是概念验证，而是一个真实可运行的语义化分析平台。

但同时暴露出一个结构性问题：

- 业务概念、指标口径、候选因素、图谱关系、计划步骤、证据类型分散在多个模块中
- 当前缺少统一的 canonical ontology layer
- 当前缺少正式的知识治理与版本审计机制

### 问题类型

这是一次 **执行阶段成熟化后暴露出的架构缺口**，性质属于：

- 已有方向深化，而不是产品方向反转
- 体系化能力缺口，而不是单点 bug 或单条 story 缺失
- 需要进入正式 backlog 的新增交付面，而不是继续靠零散优化推进

### 核心问题陈述

当前项目已经具备“语义化分析平台”的核心骨架，但还没有进入“统一本体驱动系统”阶段。

真正缺少的是：

- 统一本体层（canonical ontology）
- 指标口径、因素、关系、计划模板的正式治理
- 本体版本、变更流程、兼容策略与审批审计
- 让 planner / tool selection / execution / conclusion 消费同一套业务知识中心

如果现在不做这次路线修正，后续风险会越来越高：

- 同一业务概念继续在多个模块重复定义
- 计划与工具选择受 prompt 和局部代码约定影响，稳定性变差
- 指标口径、候选因素和图谱关系难以做正式版本审计
- Epic 7 的授权、审计、运营能力无法自然承接知识治理对象

### 支撑证据

- [ontology-governance-architecture.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ontology-governance-architecture.md) 已明确给出缺口分析与架构建议
- [architecture.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md) 当前主文档尚未把统一本体层纳入正式 epic 路线
- [epics.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md) 当前只有：
  - `Epic 7`：企业治理、审计、自托管运营
  - `Epic 8`：移动端 Growth
  尚无“统一本体层与知识治理”承载位
- [sprint-status.yaml](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/sprint-status.yaml) 当前没有这条路线对应的 story 条目

## 2. Checklist 结果

### Section 1: Trigger and Context

- `1.1` [x] Done：触发问题来自 `Epic 5 / 6` 完成后暴露的架构缺口，而非单一 story
- `1.2` [x] Done：问题类型为“现有系统已进入下一成熟阶段，需要新增正式架构交付面”
- `1.3` [x] Done：已有架构专题文档、现有 epics、当前 sprint 状态和真实运行能力作为支撑证据

### Section 2: Epic Impact Assessment

- `2.1` [x] Done：当前 `Epic 7` 仍可按原计划推进，不需要回滚
- `2.2` [x] Done：建议 **新增独立 Epic** 承载“统一本体层与知识治理”
- `2.3` [x] Done：受影响最大的是 `Epic 7` 与未来 planner / tooling / execution 主线，但现有 `Epic 5 / 6` 不需要重开
- `2.4` [x] Done：需要新增 epic，不建议把本体层散塞到现有 epics 中
- `2.5` [x] Done：优先级建议为“保持 `Epic 7` 主线优先，同时将新 Epic 加入 backlog，待 `7.1 / 7.2` 站稳后启动”

### Section 3: Artifact Conflict and Impact Analysis

- `3.1` [x] Done：PRD 核心目标不冲突，本次属于架构和交付面深化，PRD 可补但不是阻塞项
- `3.2` [x] Done：Architecture 已需要补正式承接，当前已新增专题文档，但还未进入 sprint 正式交付面
- `3.3` [N/A]：UX 当前不直接受影响，不需要先改交互主文档
- `3.4` [x] Done：epics、sprint status、后续审计与权限 story 都会受影响

### Section 4: Path Forward Evaluation

- `4.1` [x] Viable：通过新增独立 Epic 和分阶段 story 纳入现有计划，可行
- `4.2` [ ] Not viable：不建议回滚 `Epic 5 / 6` 或 `Epic 7.6 ~ 7.8`
- `4.3` [ ] Not viable：不需要缩减 MVP，问题不是范围过大，而是架构中心尚未正式化
- `4.4` [x] Done：推荐 **Direct Adjustment + New Epic Addition**

### Section 5: Proposal Components

- `5.1` [x] Done
- `5.2` [x] Done
- `5.3` [x] Done
- `5.4` [x] Done
- `5.5` [x] Done

### Section 6: Final Review and Handoff

- `6.1` [x] Done
- `6.2` [x] Done
- `6.3` [ ] Action-needed：等待用户批准
- `6.4` [ ] Action-needed：批准后再回写 `epics.md` 与 `sprint-status.yaml`
- `6.5` [x] Done：handoff 方向已明确

## 3. 影响分析

### Epic 5 / Epic 6 的影响

- **状态判断：** 不建议重开
- **原因：**
  - 这两组 epic 已经交付了真实的执行与多轮分析能力
  - 它们的价值不在于“是否已经本体化”，而在于已经提供了后续接入 ontology layer 的运行骨架
- **需要修正：**
  - 后续新 Epic 应把 `execution / follow-up / history` 视为 ontology consumer，而不是推翻重做

### Epic 7 的影响

- **状态判断：** 继续作为产品化主线
- **原因：**
  - `7.1` 服务端授权
  - `7.2` 审计事件
  - `7.3 / 7.4` 部署与观测
  这些仍然是产品交付底线
- **需要修正：**
  - 后续新增 Epic 应与 `7.1 / 7.2` 对齐，特别是知识治理的审计与授权粒度

### Epic 8 的影响

- **状态判断：** 暂无直接影响
- **原因：**
  - 移动端只会作为 ontology-grounded result model 的下游消费者
  - 不需要现在改 Epic 8 范围

### PRD 的影响

- **冲突程度：低**
- **判断：**
  - PRD 已经要求可解释执行、指标治理、实体关系和多轮分析
  - 本次不是更改产品目标，而是把这些要求收束为统一知识中心
- **建议：**
  - 后续可选在 PRD 中补一条“知识定义与口径需具备正式治理与版本化能力”的实施约束

### Architecture 的影响

- **冲突程度：中**
- **当前问题：**
  - 主架构文档已有数据架构、语义层、图谱和编排主线
  - 但缺一个正式承载“统一知识中心”的 epic 路线
- **需要修改：**
  - 已新增专题文档作为设计依据
  - 批准后需要在 epics 和 sprint status 中正式承接

## 4. 推荐路径

### 选定方案

**Direct Adjustment：新增独立 Epic，命名为“统一本体层与知识治理”，并保持 `Epic 7` 主线继续优先推进。**

### 为什么不建议把它塞进 Epic 7

- `Epic 7` 的核心是：
  - 授权
  - 审计
  - 自托管部署
  - 观测
  - 登录桥接
- 本体层与知识治理虽然和这些能力有关，但它不是纯运营侧能力，而是系统的业务知识中心
- 如果硬塞进 `Epic 7`，会把“产品化交付底线”和“本体化演进路线”混成一组，story 边界会失真

### 为什么建议新增独立 Epic

- 这条路线已经足够大，且跨越：
  - 数据模型
  - planner
  - tool selection
  - execution
  - conclusion
  - 审计
- 它需要独立优先级与分阶段推进
- 同时，它不应该打断 `Epic 7` 继续把产品做成可交付系统

### 风险评估

- **实施工作量：中到高**
- **对当前功能返工风险：低**
- **对未来架构收益：高**
- **最优策略：** 不抢占 `Epic 7` 主线，但尽快纳入 backlog，避免继续散点演化

## 5. 详细变更提案

### 5.1 Epic 变更提案

#### 新增 Epic 9

### Epic 9: 统一本体层与知识治理

平台团队可以用统一、可治理、可审计的业务本体层驱动分析计划、工具选择、执行和结论生成，而不是继续在多个模块中分散维护业务概念、指标口径、候选因素和证据语义。  
**FRs covered:** FR2, FR4, FR5, FR6, FR8, FR10, FR13

#### 新增 Story 9.1

### Story 9.1: 最小本体注册表与版本模型

As a 平台架构团队,  
I want 建立最小 ontology registry 和版本模型,  
So that 业务概念、指标语义、候选因素和计划模板有正式的 canonical source of truth。

**Acceptance Criteria:**

**Given** 平台需要定义核心业务概念  
**When** 系统读取本体定义  
**Then** 应从正式的 `platform` 表中读取版本化定义  
**And** 不再把这些定义只散落在 adapter 或 prompt 代码中

#### 新增 Story 9.2

### Story 9.2: 指标口径、因素与时间语义治理化

As a 平台架构团队,  
I want 将 metric / variant / factor / time semantics 正式治理化,  
So that Cube 口径、候选因素和结论证据不再依赖隐式代码约定。

**Acceptance Criteria:**

**Given** 平台需要处理收费类指标、候选因素和时间语义  
**When** planner、Cube adapter 或 conclusion renderer 使用这些对象  
**Then** 应从 ontology registry 消费正式定义  
**And** 支持版本和生命周期状态

#### 新增 Story 9.3

### Story 9.3: Ontology Grounding 接入上下文、计划与工具选择

As a 平台架构团队,  
I want 在 context、planner 与 tool selection 之间增加 ontology grounding,  
So that 计划和工具调用建立在统一业务语义之上，而不是自由文本与局部映射。

**Acceptance Criteria:**

**Given** 用户输入分析问题  
**When** 系统完成上下文抽取并准备生成计划  
**Then** 实体、指标、因素和时间语义应先完成 grounding  
**And** planner 与 tool selection 只消费 grounded definitions

#### 新增 Story 9.4

### Story 9.4: 本体变更申请、审批与发布审计

As a 平台治理负责人,  
I want 对 ontology 变更建立 change request、approval 和 publish 流程,  
So that 口径、关系、计划模板和证据定义具备正式治理与审计能力。

**Acceptance Criteria:**

**Given** 某个 ontology definition 需要新增、修改或废弃  
**When** 团队提交变更  
**Then** 系统应记录变更申请、审批记录、兼容说明和发布版本  
**And** 未审批定义不得进入运行时默认路径

#### 新增 Story 9.5

### Story 9.5: 本体治理后台管理界面

As a 平台治理负责人,  
I want 在内部后台查看和管理 ontology definitions、change request、approval 与 publish 状态,  
So that 知识治理不是停留在数据表和脚本层，而是具备最小可运营、可审核的管理闭环。

**Acceptance Criteria:**

**Given** 平台已经存在 ontology definitions 与 change requests  
**When** 治理人员进入内部管理界面  
**Then** 应能查看当前生效 ontology version、核心 definitions、change requests 和 approval 状态  
**And** 可执行最小的提交、审批、发布与查询操作

**Given** 某次 ontology change 已进入 review 或 approved 状态  
**When** 治理人员查看后台  
**Then** 系统应展示变更内容、影响对象、兼容说明和审计信息  
**And** 不要求首期做复杂编辑器，但必须形成正式管理面

#### 新增 Story 9.6

### Story 9.6: 执行结果、追问与历史绑定本体版本

As a 物业分析用户和平台团队,  
I want 让 execution、follow-up 与 history 绑定 ontology version,  
So that 结论来源、历史回放和问题诊断可以追溯到明确的知识版本。

**Acceptance Criteria:**

**Given** 某次分析执行完成  
**When** 系统保存 execution snapshot、follow-up 和历史轮次  
**Then** 应记录所使用的 ontology version  
**And** 历史回放时能够识别结论对应的知识版本

### 5.2 现有 Epic 7 边界说明补充

**Story group:** `7.1 ~ 7.5`

**补充说明：**

- `Epic 7` 继续作为产品化主线推进
- 新增 `Epic 9` 不改变 `Epic 7` 主线优先级
- 推荐顺序保持：
  - `7.1 -> 7.2 -> 7.3 / 7.4 -> 7.5`
- `Epic 9` 建议在 `7.1 / 7.2` 站稳后进入开发准备或并行架构化落地

**Rationale：**

- 本体层需要权限与审计配合
- 但不应等待 `Epic 7` 全部结束后才进入 backlog

### 5.3 Architecture 变更提案

**Artifact:** [architecture.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md)

**补充方式：**

- 保持总架构文档不做大规模重写
- 以专题文档 [ontology-governance-architecture.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ontology-governance-architecture.md) 作为正式架构补充

**Rationale：**

- 当前总架构文档已经很长
- 本体层与知识治理需要独立承载，不应继续混入执行框架选型章节

### 5.4 PRD 影响提案

**判断：** 本次不强制先改 PRD。

**可选补充方向：**

- 增补“知识定义、指标口径和因果关系需要具备版本治理与审计能力”

**Rationale：**

- 当前问题主要是实施路线缺口，不是产品目标冲突

### 5.5 实施交接建议

#### 变更范围分类

**Moderate**

原因：

- 需要新增独立 Epic 与多条 stories
- 需要与现有 Epic 7 主线重新编排优先级关系
- 不需要回滚已有已完成功能

#### 交接对象

- **PO / SM**
  - 把 Epic 9 正式纳入 `epics.md`
  - 更新 `sprint-status.yaml`
  - 决定和 Epic 7 的排期关系
- **Architect**
  - 以 [ontology-governance-architecture.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ontology-governance-architecture.md) 为正式架构基线
- **Dev Team**
  - 先不要直接散点开发
  - 等 story 拆分完成后按 registry -> semantics governance -> grounding -> governance admin -> version binding 顺序推进

## 6. 建议的高层行动顺序

1. 批准本次 Sprint Change Proposal
2. 回写 `epics.md`
3. 回写 `sprint-status.yaml`
4. 为 `Epic 9` 创建 story 文件
5. 保持 `Epic 7.1 / 7.2` 继续优先
6. 在 `Epic 9.1` 开发前先完成最小数据模型与权限/审计衔接设计
7. 在 `Epic 9.4 ~ 9.5` 前明确 `(admin)` 路由下的最小治理管理面边界

## 7. 结论

当前项目下一步最需要补的，不是更多功能页面，而是把已经出现的“本体化元素”收束成正式架构中心。

推荐路径是：

- 不回滚 `Epic 5 / 6 / 7.6~7.8`
- 不打断 `Epic 7` 产品化主线
- 新增 `Epic 9`，正式承载“统一本体层与知识治理”

这能保证项目继续朝真实产品走，同时避免业务语义继续在多个局部模型里失控扩散。
