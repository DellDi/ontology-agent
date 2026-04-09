---
workflowType: 'architecture-extension'
status: 'draft'
project_name: 'ontology-agent'
user_name: 'Delldi'
date: '2026-04-09'
inputDocuments:
  - /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md
  - /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md
  - /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md
  - /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/project-context.md
  - /Users/delldi/work-code/open-code/ontology-agent/docs/data-contracts/cube-semantic-baseline.md
  - /Users/delldi/work-code/open-code/ontology-agent/docs/data-contracts/graph-sync-baseline.md
  - /Users/delldi/work-code/open-code/ontology-agent/docs/data-contracts/graph-sync-operating-model.md
---

# 统一本体层与知识治理架构

## 文档定位

本文档是现有总架构文档 [architecture.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md) 的专题补充，目标不是重写当前系统，而是回答当前项目进入下一阶段时最关键的问题：

- 现有“语义化分析平台”如何升级为“本体驱动系统”
- 业务概念、指标口径、候选因素、图谱关系和执行计划如何收束到统一中心
- 知识变更如何被治理、审计、发布和回溯

本文档不替代现有 Clean Architecture / Ports and Adapters / Domain-first 主线，而是在其上增加一个更高层的业务知识中心。

## 1. 当前状态判断

### 1.1 当前已经具备的能力

当前系统已经不是 demo，也不是“聊天框 + 模型调用”。

已具备的真实能力包括：

- 分析工作台、会话、历史回看、follow-up、多轮历史
- 问题理解、上下文抽取、候选因素扩展、计划生成
- 分析执行、流式状态、结论持久化、追问重规划
- Cube 语义查询、Neo4j 图谱查询、ERP 只读防腐层、Worker 执行链
- 图谱同步的 baseline / org rebuild / incremental / dispatch / consistency sweep 运行模型

### 1.2 当前缺口

当前最大的缺口不是“再加几个工具”，而是缺少统一知识中心。

今天的业务概念分散在多个模块：

- `analysis context`
- `candidate factors`
- `semantic metric catalog`
- `graph node / edge`
- `analysis plan step`
- `execution snapshot`

这些对象已经具备“本体化元素”，但还没有收敛成统一的、显式可治理的业务本体层。因此当前系统更准确的定位是：

**受控智能分析平台**

而不是：

**完整本体驱动智能体系统**

## 2. 架构目标与非目标

### 2.1 架构目标

统一本体层与知识治理的目标是：

1. 为业务概念提供统一中心，而不是继续分散在 context / graph / metrics / planning 各处
2. 让“分析问题 -> 计划 -> 工具 -> 证据 -> 结论”都以同一套业务语义为约束
3. 为指标口径、候选因素、图谱关系、计划策略提供版本化与审计能力
4. 为后续权限、审计、观测、移动端结果投影提供统一的知识源
5. 为未来引入更强的本体驱动推理打下正式基础

### 2.2 非目标

这一阶段不做以下事情：

- 不把系统改造成学术型 ontology 平台
- 不追求 OWL/RDF 全栈落地
- 不在当前阶段引入复杂推理引擎或规则引擎大一统替换现有执行链
- 不直接把 Neo4j 视为本体唯一事实源
- 不把本体治理做成独立后台产品再反向接主系统

## 3. 核心架构原则

### 3.1 Canonical Ontology, Multiple Projections

本体层必须有一个 canonical source of truth。

建议原则：

- **Canonical 本体事实** 放在 `Postgres platform schema`
- **Neo4j** 是关系与查询投影，不是唯一事实源
- **Cube** 是指标语义与统计读路径投影，不是唯一事实源
- **execution snapshot / follow-up history** 是运行结果事实，不是概念定义源

### 3.2 Business Meaning Before Tooling

业务概念优先，工具实现其次。

必须先回答：

- 什么是“项目”
- 什么是“收费项”
- 什么是“口径”
- 什么是“候选因素”
- 什么是“证据”
- 什么是“可复用步骤”

再决定这些对象如何进入图谱、计划和执行。

### 3.3 Governance Before Autonomy

先治理，再增强自治。

在本体中心未建立前，不应继续扩大“自动推理”能力边界，否则系统会继续在多个局部模型上累积隐性冲突。

### 3.4 Stable Contracts, Evolvable Runtime

本体层应稳定，运行时可演进。

意味着：

- 概念对象、关系对象、口径对象、证据对象需要稳定 ID 与版本
- planner、tool selection、LLM prompt、render block 可以在不破坏本体契约的情况下逐步升级

## 4. 统一本体层总体结构

建议把统一本体层拆为 5 个子域。

### 4.1 Concept Registry

负责定义“系统认识世界的基础对象”。

核心对象包括：

- `DomainObjectType`
  - 例如：`organization`、`project`、`building`、`owner`、`charge-item`、`service-order`
- `BusinessEntityDefinition`
  - 定义实体显示名、同义词、标识字段、父子层级、可参与分析的方式
- `AnalysisSubjectDefinition`
  - 定义哪些对象可以作为“问题主体”

### 4.2 Metric Semantics Registry

负责定义指标与统计口径。

核心对象包括：

- `MetricDefinition`
  - 指标编码、显示名、适用主题、默认聚合方式
- `MetricVariantDefinition`
  - 例如收费类的“项目口径 / 尾欠口径”
- `TimeSemanticDefinition`
  - 例如：`receivable-accounting-period`、`billing-cycle-end-date`、`payment-date`
- `DimensionConstraintDefinition`
  - 指标允许使用的维度、过滤条件、时间粒度

### 4.3 Factor & Causality Registry

负责定义候选因素、因果关系和归因证据语义。

核心对象包括：

- `FactorDefinition`
  - 例如：`物业服务`、`满意度`、`投诉量`、`空置率`
- `FactorCategory`
  - 服务质量、收费结构、项目运营、外部环境等
- `CausalityEdgeDefinition`
  - 定义“哪些关系允许作为候选归因路径”
- `EvidenceTypeDefinition`
  - 表格证据、图谱证据、ERP 事实证据、模型摘要证据

### 4.4 Planning Semantics Registry

负责把业务语义映射到计划与执行。

核心对象包括：

- `AnalysisIntentDefinition`
  - 查询、趋势、对比、归因、下钻、追问
- `PlanStepTemplate`
  - 如“确认分析口径”“校验核心指标波动”“逐项验证候选因素”“汇总归因判断”
- `ToolCapabilityBinding`
  - 某种计划步骤可调用哪些工具、依赖哪些前置语义
- `ReusabilityRule`
  - 追问重规划时什么条件下可以复用旧步骤结果

### 4.5 Policy & Governance Registry

负责把治理规则本身结构化。

核心对象包括：

- `OntologyVersion`
- `DefinitionLifecycleState`
  - `draft / review / approved / deprecated / retired`
- `CompatibilityRule`
  - 新旧版本是否兼容
- `ChangeRequest`
  - 本体、口径、关系、规则的变更申请
- `ApprovalRecord`
  - 审批与发布记录

## 5. 核心存储与投影设计

### 5.1 Postgres 作为 Canonical Store

建议新增一组平台表，承载 canonical knowledge。

建议最小表组：

- `platform.ontology_versions`
- `platform.ontology_entity_definitions`
- `platform.ontology_metric_definitions`
- `platform.ontology_metric_variants`
- `platform.ontology_time_semantics`
- `platform.ontology_factor_definitions`
- `platform.ontology_causality_edges`
- `platform.ontology_plan_step_templates`
- `platform.ontology_tool_capability_bindings`
- `platform.ontology_change_requests`
- `platform.ontology_approval_records`

这些表的角色是：

- 定义“标准业务语义”
- 提供版本化和审计
- 作为 Neo4j / Cube / planner / renderer 的上游事实源

### 5.2 Neo4j 作为 Relationship Projection

Neo4j 继续承担：

- 实体关系查询
- 候选因素扩展
- 因果路径探索

但定位要更明确：

- 不负责定义“哪些关系是合法关系”
- 不负责定义“哪些因果边具备业务意义”
- 这些规则应来自 Postgres canonical ontology，再投影到 Neo4j

### 5.3 Cube 作为 Metric Semantics Projection

Cube 继续承担：

- 受治理的统计读路径
- 指标查询执行

但口径定义不能只留在 adapter 或 cube model 里。

建议未来做法：

- `MetricDefinition / MetricVariantDefinition / TimeSemanticDefinition`
  先在 ontology registry 中定义
- `metric-catalog.ts` 成为 registry 到 Cube 的运行时映射层
- 这样收费类“项目口径 / 尾欠口径”不再只是代码约定，而是治理对象

## 6. 与现有系统的映射关系

### 6.1 当前模块如何迁移到统一本体层

| 当前能力 | 当前位置 | 未来定位 |
|---|---|---|
| context 抽取 | `domain/analysis-context` | ontology grounding 输入层 |
| candidate factors | `domain/candidate-factors` 等 | Factor & Causality Registry 消费者 |
| Cube metric catalog | `infrastructure/cube/metric-catalog.ts` | Metric Semantics Projection |
| Neo4j 图谱 | `infrastructure/neo4j/*` | Relationship Projection |
| 计划步骤 | `domain/analysis-plan` | Planning Semantics Registry 消费者 |
| execution snapshot | `domain/analysis-execution` | 本体约束下的运行结果事实 |

### 6.2 当前哪些逻辑最应该先收敛

最先应该收敛的不是全部，而是以下四类：

1. `MetricDefinition / Variant / TimeSemantic`
2. `FactorDefinition / CausalityEdgeDefinition`
3. `PlanStepTemplate / ToolCapabilityBinding`
4. `EvidenceTypeDefinition`

因为这四类对象已经同时出现在：

- context 抽取
- Cube 查询
- Neo4j 关系
- plan generation
- conclusion rendering

继续分散维护，后面只会越来越难收口。

## 7. 运行时工作流如何改变

目标不是重写现有执行链，而是在其前后增加 ontology grounding 与 governance control。

### 7.1 新的运行时主链

1. 用户输入问题
2. context extraction 产出初步结构化上下文
3. `Ontology Grounding`
   - 将实体、指标、时间、候选因素映射到 canonical definitions
4. planner 只基于已 grounding 的概念生成计划
5. tool selection 只能从 `ToolCapabilityBinding` 中选允许的能力
6. execution 返回的结果必须归一化为 `EvidenceTypeDefinition`
7. conclusion 只能引用已定义的因素、指标和证据类型
8. follow-up / replan 继承的是 ontology-grounded context，而不是自由文本上下文

### 7.2 这会带来的直接收益

- 计划更加稳定，不容易因为 prompt 漂移而乱变
- 工具选择有正式语义边界，不再只是字符串匹配
- 结论和证据可以做更强的一致性校验
- 后续移动端摘要可以直接依赖 ontology-grounded result model

## 8. 知识治理模型

### 8.1 治理对象

治理对象至少包括：

- 实体定义
- 指标定义
- 口径变体
- 时间语义
- 候选因素定义
- 因果边定义
- 计划步骤模板
- 工具能力绑定

### 8.2 生命周期

建议统一生命周期：

- `draft`
- `review`
- `approved`
- `deprecated`
- `retired`

约束：

- 只有 `approved` 对象才能进入运行时 planner / tool selection / conclusion rendering
- `deprecated` 可以兼容读取，但不能继续成为新计划默认值
- `retired` 只能用于历史回放，不得参与新执行

### 8.3 变更流程

建议采用正式变更单流程：

1. 提交 `ChangeRequest`
2. 说明变更原因、影响对象、兼容策略
3. 审核通过后生成新版本
4. 投影到 Neo4j / Cube / planner bindings
5. 发布后允许新执行使用

### 8.4 审计要求

每次变更都必须记录：

- 谁改的
- 改了什么
- 为什么改
- 影响哪些 metrics / factors / plan steps / tools
- 是否向下兼容
- 从哪个版本升级到哪个版本

这部分后续应与 `Epic 7.2` 的审计能力合并，而不是再造第二套审计协议。

## 9. 与权限、审计、运营能力的关系

### 9.1 权限

本体层不替代权限系统，但为权限系统提供“分析对象粒度”。

例如未来权限不只是：

- 用户能看哪个项目

还可能是：

- 用户能否使用某类分析主题
- 用户能否查看某些因素类型
- 用户能否触发某些高成本计划步骤

这要求 `Epic 7.1` 的服务端授权后续要能消费 ontology definitions。

### 9.2 审计

本体层必须可审计，否则治理无从谈起。

最小审计粒度包括：

- 本体定义变更
- 指标口径变更
- 因果边变更
- planner binding 变更
- 某次 execution 使用的是哪个 ontology version

### 9.3 运营

产品化运营层需要看到：

- 当前运行时生效版本
- 哪些定义已 deprecated
- 哪些变更尚未发布
- 某次异常结论是否来自旧知识版本

否则系统一旦出现“结果为什么变了”，无法对外解释。

## 10. 建议实施顺序

不建议一次性全做。建议分 4 阶段推进。

### Phase 1: 建立最小 Ontology Registry

目标：

- 先把 metric / factor / time semantics / plan step template 建成正式 registry

产出：

- Canonical 表结构
- 版本模型
- 基础读取 use cases

### Phase 2: 建立 Ontology Grounding

目标：

- 让 context、candidate factor、planner、tool selection 统一消费 registry

产出：

- entity / metric / factor grounding layer
- planner binding layer
- evidence type normalization

### Phase 3: 建立知识治理流程

目标：

- 让知识变更具备正式审计和生命周期管理

产出：

- change request
- approval record
- compatibility rule
- publish flow

### Phase 4: 建立本体约束下的执行与结论

目标：

- 把 execution / conclusion / follow-up 全部绑到 ontology version

产出：

- execution snapshot 增加 ontology version 引用
- follow-up / replan 基于 grounded context
- renderer 基于 evidence type 和 factor definition

## 11. 对当前 epics 的影响

### 11.1 现有不需要推翻的部分

以下已完成能力仍然有效：

- Epic 5 执行、流式、结论、持久化
- Epic 6 多轮追问、重规划、历史
- Epic 7.6 ~ 7.8 图谱同步运行化

这些都不是返工对象，而是后续要接入 ontology layer 的消费者。

### 11.2 现有必须优先继续的部分

即便开始做本体层设计，当前产品主线仍应优先推进：

- `7.1` 服务端授权
- `7.2` 审计分析与工具事件
- `7.3 / 7.4` 部署与观测

原因：

- 这些是产品交付底线
- 本体治理后续也要依赖它们

### 11.3 建议新增的交付面

建议后续通过 `Correct Course` 正式纳入一组新 story 或新 Epic，至少包含：

1. 最小 ontology registry 与 version model
2. metric / factor / time semantics 正式治理化
3. ontology grounding 接入 planner 与 tool selection
4. ontology change request / approval / publish 审计链
5. execution / follow-up / history 绑定 ontology version

## 12. 结论

当前项目没有偏离 AI 本体驱动方向，但也不能把现状误判为“本体层已完成”。

更准确的判断是：

- 当前系统已经完成了**语义化分析平台底座**
- 下一步缺的是**统一本体层与知识治理中心**

因此后续最合理的路线不是盲目继续加功能，而是：

1. 保持 `Epic 7` 产品化主线推进
2. 同时正式引入 ontology registry 与知识治理路线
3. 让后续 planner、tooling、execution、conclusion 逐步改为“本体约束驱动”

这条路线能保持当前项目继续可交付，也不会把“本体化”做成脱离现实交付的概念工程。
