---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - {project-root}/_bmad-output/planning-artifacts/prd.md
  - /Users/delldi/ai-data-research/04-core-tech-deepdive.md
  - /Users/delldi/ai-data-research/07-nextjs-fullstack-architecture.md
workflowType: 'architecture'
project_name: 'ontology-agent'
user_name: 'Delldi'
date: '2026-03-25'
---

# 架构决策文档

_本文档通过逐步协作发现持续构建。随着每一项架构决策达成一致，内容会按步骤追加。_

## 项目上下文分析

### 需求概览

**功能需求：**
当前输入材料尚未形成一份完整、细化的 PRD 功能需求清单，但已确认的两份研究文档已经给出了明确的产品方向和初始能力地图。

从架构视角看，这个产品不是传统报表或驾驶舱，而是一个以 AI 原生分析工作流为核心的系统。当前材料隐含的能力范围包括：

- 面向业务分析的自然语言问题输入
- 覆盖查询、趋势、对比、归因分析，以及后续决策支持的意图分类
- 通过可信中间表示而不是直接自由生成 SQL 的查询表达方式
- 基于语义层的指标访问，以保证口径一致和治理能力
- 依赖知识图谱完成业务实体和指标之间的因果推理
- 面向复杂分析问题的多步骤计划与执行
- 以对话和流式方式呈现中间推理、执行进度和结果
- 带证据链、可排序原因和行动建议的输出
- 与遗留 ERP 的认证、组织架构和历史数据访问集成

这些都说明，这个产品的功能中心是“可解释执行的 AI 辅助分析”，而不是简单的报表检索。

**非功能需求：**
已加载材料清楚地指向了以下架构驱动因素：

- 高可信度和答案一致性是硬要求
- 指标定义必须集中治理并可复用
- AI 输出必须通过计划、步骤和证据进行解释
- 涉及敏感行业数据时，应支持自托管部署模式
- 对遗留 Java ERP 的集成必须通过防腐层隔离
- 面向长耗时分析流程，流式响应体验很重要
- 新平台必须继承组织和权限控制，不得弱化
- 系统必须支持从简单查询逐步演进到归因分析，再到更强的 Agent 编排

**规模与复杂度：**
该项目当前应判定为高复杂度的全栈 AI 分析平台。

- 主要技术域：全栈 AI 原生数据分析平台
- 复杂度等级：高
- 预计核心架构组件数量：8-12 个，覆盖展示层、应用编排、语义层集成、图谱推理、AI 执行、遗留系统集成、认证和可观测性

复杂度的主要来源不是页面数量，而是跨层协同数量，包括 AI 编排、可治理分析、图谱推理、流式交互以及遗留系统互操作。

### 技术约束与依赖

从已加载材料中提炼出的已知约束与依赖如下：

- 现有 Java ERP 仍然是认证、权限、组织层级和部分遗留 API 的依赖源
- 新能力应通过现代全栈架构承载，而不是继续堆叠到遗留 Java 栈中
- 指标访问应通过语义层治理，不能退化为直接 ad hoc SQL
- 因果分析和关系感知分析依赖知识图谱能力
- 架构应支持从模板驱动逐步演进到更强的 Agent 计划与执行
- 部署方式必须考虑行业数据敏感性和较高概率的自托管要求
- 产品定义仍未完全收敛，因此部分业务边界暂时只能视为假设而非最终需求

### 已识别的横切关注点

以下关注点会同时影响多个架构组件：

- 身份、租户和权限上下文传播
- 指标治理与计算口径一致性
- AI 生成分析结果的可解释性与可审计性
- 长流程编排和流式状态更新
- 可靠性、降级处理与基于置信度的控制路径
- ERP、语义层、图谱与 AI 输出之间的数据血缘
- 系统行为和 Agent 行为的双重可观测性
- 快速演进的 AI 工作流与稳定企业集成之间的变更隔离

## 起步模板评估

### 主要技术域

全栈 Web 应用，核心特征是 AI 原生分析编排、对话式分析体验、可治理的数据访问，以及企业遗留系统集成。

### 已评估的起步方案

**1. 官方 `create-next-app` 模板**
- 这是当前实际采用的起步路线
- 以官方脚手架生成 Next.js App Router 基线，再在仓库内继续按领域分层与企业集成边界演进
- 对当前项目而言，它既保留了官方升级路径，也没有妨碍我们建立 `domain / application / infrastructure` 结构

**2. 手工初始化 Next.js App Router**
- 这是一个可行方案，也曾作为前期架构讨论中的候选项
- 它保留了完整控制权，但当前仓库已经按用户最新决定改为官方脚手架路线
- 后续实现与文档应以仓库现状为准，不再继续以“手工初始化”作为事实基线

**3. 基于 Vite 的 React 应用**
- 对纯前端、强客户端交互的 React 系统是一个好方案
- 本项目不选它，是因为我们直接受益于 Next.js 原生的服务端边界、Route Handlers、服务端渲染模式和 App Router 能力
- 对这套架构而言，“Next.js + Vite 作为主底座”并不是推荐路线

### 选定方案：官方 `create-next-app` 初始化的 Next.js App Router

**选择理由：**
这个项目真正的复杂性来自 AI 编排、可治理分析、知识图谱集成以及遗留 ERP 边界，而不是工程脚手架本身。因此当前采用的最佳实践不是“为了可控而放弃官方脚手架”，而是“用官方脚手架快速建立稳态底座，再在代码组织层面保持架构主导权”。

这条路线带来的直接收益包括：
- 完整掌控面向 DDD 的目录结构
- 为遗留 Java ERP 集成保留清晰的防腐层边界
- 仍然不被模板长期绑定认证、数据库或 API 约定
- 原生支持产品所需的流式交付和服务端执行模式
- 开发阶段可直接使用官方 `next dev`，默认走 `Turbopack`
- 与当前仓库实现、升级路径和后续 Story 事实保持一致

**初始化命令：**

```bash
pnpm create next-app@latest ontology-agent --ts --app
```

**建议的 `package.json` 脚本：**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "lint:fix": "eslint --fix"
  }
}
```

**该底座直接带来的架构决定：**

**语言与运行时：**
- 以 TypeScript 为主的 Next.js 应用
- 依赖包层面跟随 React 稳定版本线
- 基于 App Router 的架构方式

**构建器与开发工作流：**
- `next dev` 默认使用 `Turbopack`
- 不引入 Vite 依赖，也不维护双轨工具链
- 开发路径与官方 Next.js 行为保持一致

**样式方案：**
- 不由初始化脚本预先固定
- 后续可以把 Tailwind 和 shadcn/ui 作为明确架构决策引入，而不是被 starter 被动继承

**测试框架：**
- 不强制默认测试栈
- 这更符合当前项目，因为测试策略应该作为明确的架构决策，而不是随 starter 一起被动带入

**代码组织：**
- 保留对 `app`、`domain`、`application`、`infrastructure` 等分层的完整主导权
- 比通用 starter 布局更适合企业集成和持续演进的 AI 编排场景

**开发体验：**
- 使用官方 Next.js 脚本和升级路径
- 与框架文档和未来升级之间的错配风险最低
- 为后续引入 AI SDK、语义层适配器、图谱适配器和可观测性预留了最干净的基础

**说明：** 虽然早期架构讨论曾偏向手工初始化，但当前仓库的真实起点已经切换为官方 `create-next-app` 路线。后续所有实现与文档同步都应以该事实为准。

## 核心架构决策

### 决策优先级分析

**阻塞实现的关键决策：**
- 运行时基线：`Next.js 16.1`、`React 19.2`、`Node.js 24 Active LTS`
- 系统形态：采用“模块化单体 + 独立后台 Worker”，不在 MVP 阶段拆成微服务
- 真正数据源边界：现有 ERP 的 posgres 仍然是业务操作数据的事实来源
- 语义层：采用 `Cube Core 1.6.x`，固定到经过验证的 patch 版本
- 知识图谱：采用 `Neo4j 5.26 LTS`
- 认证：采用基于 ERP 的服务端会话和带作用域的 RBAC
- API 交互模式：MVP 采用 `REST + SSE`，基于 Next Route Handlers，不引入 GraphQL

**重要但不阻塞的决策：**
- 校验标准：采用 `Zod 4`
- 前端架构：`App Router` 服务端优先，`Tailwind CSS 4.1`、`shadcn/ui`、`TanStack Query v5`
- 缓存与队列：采用 `Redis Open Source 8.2+`
- 部署姿态：自托管容器化，后续再准备 Kubernetes 化
- 可观测性：`OpenTelemetry + Prometheus/Grafana/Loki`

**延后到 Post-MVP 的决策：**
- 更细粒度的多 Agent 拆分，而不是当前的 Worker 编排
- 超出 Redis 能力之外的专用向量数据库
- 基于 Graph Data Science 或 ML 的因果排序增强
- 面向外部合作方的 GraphQL 门面或开放 API

### 数据架构

- 现有 ERP posgres 仍然是业务操作数据的事实来源，新平台不直接写入 ERP 拥有的业务表。
- 新平台自有数据，例如会话、对话元数据、保存的分析结果、认证查询、用户反馈和审计事件，存放在独立的 posgres schema 中。
- `Drizzle ORM` 与迁移能力仅用于平台自有表；ERP schema 视为外部契约，而不是由本项目掌控的内部结构。
- `ERP Read Anti-Corruption Layer` 负责从 ERP 暴露组织、项目、区域和业务事实的只读访问边界，并在进入分析链路前完成 scope 过滤。
- `Cube Core 1.6.x` 作为语义层，应连接到只读副本或 ETL 维护的分析 schema，而不是 ERP 主写路径。
- `Cube Semantic Query Adapter` 负责把分析请求转换为受治理的指标查询，不允许执行绕过语义层的 ad hoc ERP 直查。
- `Neo4j 5.26 LTS` 用于存储实体关系和经过治理的因果边，数据来源于 ETL 与受控增强流程。
- `Neo4j Graph Adapter` 负责候选因素扩展、关系查询和因果边读取；图谱写入来自受控同步流程，而不是分析请求临时写图。
- `Graph / Semantic ETL Sync Baseline` 负责把 ERP 事实、语义层需要的聚合结构和图谱边界同步到各自读模型。
- `Zod 4` 作为 Route Handlers、Worker 载荷、工具调用契约以及外部管理 API 的统一校验边界。
- `Redis 8.2+` 作为共享基础设施，用于限流、短时缓存、任务元数据和流式协调。

### 认证与安全

- Java ERP 仍然是身份权威。Next.js 平台负责在服务端完成 token 校验或交换，然后签发 HTTP-only 的应用会话 Cookie。
- 授权模式采用带作用域的 RBAC，权限来源于 ERP 角色、组织层级和项目/小区边界。
- 浏览器端不允许直连 posgres、Cube、Neo4j、Redis 或 LLM Provider。
- `LLM Provider Adapter` 必须只存在于服务端，统一承接 OpenAI-compatible 模型调用、密钥管理、超时、重试、限流和健康检查。
- `Prompt Registry + Structured Output Guardrails` 必须位于服务端编排边界内，使用 Zod 驱动意图、上下文增强、计划步骤、工具选择和结论摘要的结构化输出约束。
- 对高成本分析能力和模型接口使用基于 Redis 的“按用户 + 按组织”双层限流。
- 密钥只存在于服务端。传输链路默认加密，静态加密依赖数据库、存储和基础设施策略。
- 对分析请求、工具调用、导出操作以及涉及权限边界的行为都要求可审计。

### API 与通信模式

- 主应用契约采用基于 Next Route Handlers 的 `REST + SSE`。
- 长耗时分析统一采用“提交 -> 入队 -> 流式返回状态和结果”的模式。
- `Tool Registry + Orchestration Bridge` 负责把 LLM、ERP、Cube、Neo4j 等能力以受控工具方式挂接到应用服务与 worker 中，而不是让页面或单个 route 临时拼装调用链。
- 内部编排优先使用应用服务加作业 Worker，而不是在 MVP 阶段建设分布式微服务网络。
- 错误处理采用稳定错误码、结构化 problem details 与 trace ID。
- `OpenAPI` 仅用于外部或管理面 API；内部路由契约保持 code-first，并由 Zod 驱动。
- `GraphQL` 和 `gRPC` 明确延后到 MVP 之后。

### 前端架构

- 前端采用 Next.js App Router 的服务端优先模式，对认证后、数据密集的页面优先使用 RSC。
- 只有在必须依赖交互状态或浏览器 API 时才引入 Client Components。
- UI 基础采用 `Tailwind CSS 4.1` 和 `shadcn/ui`。
- `TanStack Query v5` 仅用于 hydration 之后的客户端服务端状态同步，不作为全局状态容器滥用。
- 默认避免引入全局客户端状态管理；只有在跨页面编排被证明确有必要时，才考虑 `Zustand` 或类似工具。
- 路由分组建议至少拆分为 `(auth)`、`(workspace)`、`(admin)` 三类边界。
- 面向分析的动态页面优先按需加载大型图表和工具型 UI。

### 基础设施与部署

- 运行时基线采用 `Node.js 24 Active LTS`，同时保持对 Next.js 最低 Node 要求的兼容性。
- 部署模型采用自托管容器。开发、本地和试点环境先用 Docker Compose，后续保留平滑迁移到 Kubernetes 的边界。
- 基础设施接入采用分阶段策略，而不是在当前阶段一次性引入所有中间件：
  - Phase 1：`web + postgres + redis + docker compose`
  - Phase 2：`worker skeleton`
  - Phase 3：`llm provider adapter + prompt/schema guardrails + ERP read anti-corruption layer`
  - Phase 4：`cube semantic query adapter + neo4j graph adapter + graph/semantic sync baseline`
- 完整目标态进程拓扑仍然包括：
  - `web`：Next.js 应用
  - `worker`：后台分析执行进程
  - 基础设施服务：postgres、Redis、Neo4j、Cube
- CI/CD 应覆盖 lint、typecheck、测试、生产构建、镜像打包和环境晋升。
- 可观测性采用 OpenTelemetry 埋点、Prometheus 指标、Grafana 仪表盘，以及兼容 Loki 的结构化日志。
- 在引入更多服务拆分之前，优先支持对 Worker 的独立扩容。

### 决策影响分析

**实施顺序：**
1. 以官方 `create-next-app` 建立 Next.js App Router 基座，并锁定运行时与工具链版本
2. 建立 `domain / application / infrastructure` 的清晰分层
3. 实现 ERP 认证适配器和带作用域的会话模型
4. 插入最小基础设施基线：`Docker Compose + Postgres + Redis`
5. 建立平台自有 postgres schema、迁移机制与真实持久化
6. 引入最小 `worker skeleton`，为长任务执行留出进程边界
7. 继续推进意图识别、上下文抽取与计划生成，先站稳 provider-agnostic 的契约与 UI 骨架
8. 接入服务端 `LLM Provider Adapter`、`Prompt Registry + Structured Output Guardrails` 与 `ERP Read Anti-Corruption Layer`
9. 接入 `Cube Semantic Query Adapter`、`Neo4j Graph Adapter` 与最小 `Graph / Semantic ETL Sync Baseline`
10. 建立 `Tool Registry + Orchestration Bridge`，把真实模型与真实数据能力接入 worker / application orchestration
11. 再推进执行、流式反馈、归因结论与结果持久化
12. 最后完善多轮追问、审计轨迹、治理、移动端与可观测性

**跨组件依赖：**
- 认证决策会直接影响 API 鉴权、缓存作用域和审计日志
- 数据所有权边界会直接影响 Cube、Neo4j 与 Worker 的职责划分
- 队列与 Worker 编排方式会直接影响 SSE 行为与限流设计
- 运行时和工具链选择会直接影响 CI/CD 与部署方式
- 统一校验层会直接影响路由契约、Worker 消息和工具调用安全

## 智能体框架选型决策

### 当前结论

- 当前阶段不引入“大而全”的智能体开发框架作为系统核心。
- 当前阶段保留“自有 `LLM Provider Adapter` + `Prompt Registry / Structured Output Guardrails` + `Tool Registry + Worker`”作为主编排边界。
- 当前阶段正式批准引入 `Vercel AI SDK` 作为 AI application runtime layer，用于承接 UI message lifecycle、tool runtime、MCP 接线和 memory bridge，但不取代平台内部编排。
- 当系统进入“长流程、多阶段、可恢复、需要人工确认和重规划”的执行阶段后，再评估是否将内部编排升级为 `LangGraph`。
- 当前不选 `AutoGen`、`LangChain` 全家桶或 Google ADK 作为主框架底座。

### 为什么当前不直接引入重框架

- 当前系统更需要先站稳的是：服务端模型接线、权限边界、结构化输出约束、工具接入边界、队列与 Worker 模型。
- 在这些边界尚未完全稳定前，过早引入重框架，风险不是“更先进”，而是把业务控制权交给框架抽象，后续容易变成“为了适配框架而设计业务”。
- 本项目不是通用聊天机器人，也不是多 Agent 研究 playground；它的核心是“可治理、可解释、可追溯”的物业分析执行链路。
- 因此当前最佳策略不是“先上框架再想业务”，而是“先把业务边界和编排契约做成平台能力，再在合适时机引入框架增强局部层面”。

### 框架判断

**1. Vercel AI SDK**

- 适合场景：
  - Next.js / TypeScript 项目中的流式文本输出
  - tool calling 结果的前端交互呈现
  - chat / streaming UI、SSE、消息渲染与中间状态回传
  - ToolLoopAgent、tool / dynamicTool、tool approval 等通用运行时能力
  - MCP tools / resources / prompts / elicitation 的统一接入
  - memory provider、provider-defined memory tool 或 custom memory tool 的接入面
- 不适合作为：
  - 平台内部的长期编排内核
  - 任务恢复、长流程状态机、人工确认流的唯一实现方式
  - ontology registry、知识治理、权限审计和发布治理系统
- 决策：
  - 可引入，定位为“AI application runtime layer”，不是“系统编排底座”或“业务真相层”。

**2. LangGraph**

- 适合场景：
  - 多阶段状态机
  - 长流程执行与恢复
  - human-in-the-loop
  - 失败后重规划、条件分支和多步依赖
- 风险：
  - 过早引入会增加抽象成本，且在当前阶段会与我们自己的 Worker / Tool Registry / Guardrails 边界产生重叠
- 决策：
  - 保持为中期升级候选；只有当现有“应用服务 + Worker + Redis + Tool Registry”无法优雅承载复杂执行编排时再引入。

**3. LangChain**

- 适合场景：
  - 快速接大量 provider、prompt、tool、memory 生态
- 风险：
  - 抽象层偏厚，长期容易让项目逻辑依赖框架内部概念
- 决策：
  - 当前不作为主框架选型；如未来需要，可局部借用生态，而不是全盘引入。

### 什么条件、什么阶段下引入 Vercel AI SDK

**建议引入契机：**

- 当 `Story 4.1` 和 `Story 4.2` 已经把服务端模型接线、结构化输出和 guardrails 站稳之后
- 当 `Epic 5` 开始真正实现以下能力时：
  - `5.1` 提交分析计划进入执行
  - `5.2` 流式回传执行进度与阶段结果
  - `5.3` 展示归因结论与证据
- 当我们明确需要：
  - 更顺滑的 token streaming
  - 更稳定的 tool call 结果渲染
  - 更低成本的前端消息与流式交互接线
  - 更轻量地接入 memory、knowledge resources、skills 与工具系统

**引入方式：**

- 把它放在 Next.js / application 之间的 AI application runtime layer：
  - 消息流
  - SSE / streaming UI
  - tool call 结果渲染
  - tool approval / resume
  - MCP 接入
  - memory bridge
- 不让它接管：
  - 平台内部的业务编排
  - Redis / Worker 队列
  - ERP / Cube / Neo4j 的工具治理边界
  - ontology registry、知识治理与审计发布流程

### AI Interaction Rendering Layer

为避免把传输协议直接固化为页面状态结构，`Epic 5` 起需要显式增加一层 **AI Interaction Rendering Layer**。这层仍属于 Next.js 交互边界，不改变平台内部编排主线。

**职责：**

- 定义统一 `execution event envelope`
- 定义统一 `render block / message part schema`
- 将 worker 阶段结果、工具结果和最终结论映射为可消费的 UI parts
- 提供 renderer registry，支持：
  - 文本说明
  - 表格
  - 图表
  - 图谱
  - 证据卡
  - 结论卡
  - 执行节点 / 时间线
- 为 `PC` 与 `mobile` 提供同源 schema 的不同投影
- 为 memory recall、knowledge resources、skills 激活态与工具审批态预留统一视觉语义

**边界约束：**

- 可采用 `Vercel AI SDK` 作为 stream adapter 与 UI message lifecycle 实现
- canonical source of truth 仍然是服务端 execution events 与结果模型
- `Worker + Redis + Tool Registry + Orchestration Bridge` 继续作为内部执行主线
- 浏览器端不应直接消费原始 worker 协调状态；应消费服务端整形后的 interaction events 与 render blocks
- memory、knowledge、skills 与 tools 的工程接入可经由该层承接，但业务知识的治理、版本和权限仍属于独立平台能力

**不应在这些阶段提前引入：**

- `Epic 2`：基础设施基线阶段
- `Epic 3`：意图 / 上下文 / 候选因素 / 计划骨架阶段
- `Story 4.1` 之前：模型接线边界尚未稳定，不应先引 UI SDK

### 什么条件、什么阶段下升级到 LangGraph

**建议升级契机：**

- 当 `Epic 5` 与 `Epic 6` 进入后段，且出现以下真实复杂度时：
  - 计划执行步骤明显增多
  - 需要持久化执行图状态
  - 失败后要从中间状态恢复，而不是整条任务重跑
  - 人工确认与回退点开始增多
  - 多轮追问 / 重规划 / 工具再选择已经不再适合用简单 use-case + worker 组合表达

**更具体的故事节点：**

- `5.2` 流式执行进度与阶段结果  
  这是第一次明显暴露“执行图状态管理”需求的节点。
- `5.4` 持久化步骤结果与最终结论  
  这是第一次需要把“执行过程”作为一等对象存储的节点。
- `6.2` 增加因素或缩小范围  
  这是第一次对既有执行路径做条件性变更。
- `6.3` 用户修正后重规划  
  这是最关键的升级信号。如果这里已经需要复杂分支、回退、重算和人工确认点，LangGraph 的收益会显著上升。
- `6.4` 保留多轮历史  
  如果多轮状态已经变成“带执行上下文的会话图”，而不仅仅是消息历史，也说明升级时机到了。

**可以继续不引入 LangGraph 的前提：**

- 当前执行仍然主要是线性流程
- Worker + Redis + Tool Registry 已足够表达状态机
- 错误恢复仍然可以通过“任务失败 -> 重试 / 重提”解决
- 人工确认点很少，且不会显著改变执行图

### 推荐路线

**当前阶段：**

- 保持自有编排边界：
  - `LLM Provider Adapter`
  - `Prompt Registry + Structured Output Guardrails`
  - `ERP Read Anti-Corruption Layer`
  - `Tool Registry + Orchestration Bridge`
  - `Worker + Redis`

**近期阶段：**

- 若 `Epic 5` 需要更好的流式交互体验，引入 `Vercel AI SDK` 作为 UI / streaming 增强层

**中期阶段：**

- 若 `Epic 5 / 6` 的执行图复杂度显著上升，再把内部执行编排升级为 `LangGraph`

**保持暂缓：**

- `AutoGen`
- `LangChain` 全栈式接管
- `Google ADK`

### 结论摘要

- 当前不应直接引入重框架
- `Vercel AI SDK` 的最合适引入点是 `Epic 5` 开始需要强流式交互时
- `LangGraph` 的最合适引入点是 `5.4 / 6.2 / 6.3 / 6.4` 暴露出明确执行图复杂度之后
- 在此之前，优先把我们自己的服务端边界和可治理编排模型做稳

## 架构专题补充

- 统一本体层与知识治理专题设计见：
  - [ontology-governance-architecture.md]({project-root}/_bmad-output/planning-artifacts/ontology-governance-architecture.md)
- 该文档用于回答“当前语义化分析平台如何继续演进为本体驱动系统”，不替代本总架构文档。
- 架构债备注：当前接受 `web + worker + migrate` 的现状实现；镜像复用、共享依赖安装层与运行时体积控制属于后续工程优化项，待 CI/CD、部署效率、运行稳定性或协作复杂度成为真实瓶颈时再处理。
