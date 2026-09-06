# Java 后端三阶段目标：治理、图同步与运行切换闭环

> 历史阶段说明：本文记录 Java 切换阶段当时的目标。Graph Sync 的 ERP watermark、cursor、dirty scope
> 方案已由 canonical data product 架构取代，不再代表当前运行模型。当前实现与运维以
> [Java Graph Sync 运行模型](./data-contracts/graph-sync-operating-model.md) 和
> [Ontology 数据平台实施计划](./architecture/ontology-data-platform-implementation-plan.md) 为准。

## Goal

在二阶段“首次分析 + 多轮追问”已经由 Java 完整承载的基础上，交付 Java 后端的生产运行闭环：Ontology 的读取、变更申请、审批与发布由 Java 负责；ERP 到 Neo4j 的图数据同步由 Java 负责；PC 管理端与移动分析入口只保留 Next.js 展示和透明代理，不再调用 TypeScript 业务用例；模型侧继续以 Spring AI 2.0 为唯一核心底座，并通过自有 Agent/Provider Adapter 验证 DashScope 的 OpenAI-compatible 接入。完成后，关键业务链不再要求 TypeScript Worker 或 Composition Root 才能运行。

## 架构边界

- Java 继续采用 package-by-feature；业务状态机、权限和事务留在 feature 内，不新增全局 Repository/Service 抽象层。
- PostgreSQL 是 Ontology、Graph Sync、Job、Event、Snapshot、Audit 与 Chat Memory 的事实源；Redis 只做唤醒，Neo4j 只做可重建的图查询投影。
- Ontology 发布、canonical dataset version 发布、Graph projection 提交和执行终态必须保持事务边界，不做吞错、默认成功或内存态补偿。
- Main Agent 仍是唯一智能决策入口；Workflow 仍是一次受治理 Tool Call。本阶段不引入第二套 Agent loop 或 Alibaba Graph 编排。
- Next.js route 仅认证透传、Cookie/状态码/重定向适配；不再持有 Ontology、Graph Sync 或 Mobile 分析业务规则。

## 范围

### 1. Java Ontology Governance

- 提供仅 `PLATFORM_ADMIN` 可调用的 Java baseline status/bootstrap API；bootstrap 不接收外部 seed，
  只在所有 Ontology registry 表全空时于单事务内写入固定 canonical baseline，并用 blocking PostgreSQL
  transaction advisory lock 串行化并发操作。完整 current 只读幂等返回；半成品、多 current 或运行时
  语义不完整均明确失败。
- 提供 overview、definitions、versions、change requests、approval history、publish history 的 Java 读 API。
- 提供 change request 创建、提交、审批/拒绝和 version 发布 API。
- 复用现有角色编码，服务端强制 `view / author / review / publish` 权限；所有写操作落审计事实。
- 状态转换采用条件更新或行锁；重复或过期请求 fail loud，不以幂等名义覆盖新状态。
- 发布前验证同一 pinned version 的实体、指标定义/变体、时间语义、计划步骤、Tool binding、因果边和证据类型完整性。
- 发布事务原子完成目标版本生效、前一版本 deprecated、关联申请 published 和 publish record；并发发布只能成功一个。
- 已入队和历史执行继续使用各自 pinned ontology version，不随新发布漂移。

### 2. Java Graph Sync（当前 canonical projection）

- full bootstrap、organization rebuild 与 consistency sweep 均从 PostgreSQL canonical facts 构建投影。
- 复用 `graph_sync_runs` 记录运行事实；历史 `graph_sync_cursors`、`graph_sync_dirty_scopes` 仅作迁移审计遗留。
- 每次运行在开始时冻结一个 `DatasetVersionSet`，Neo4j writer 校验节点、边的产品版本属于该集合。
- 组织与历史版本由 `organization + datasetVersionSetId` 隔离；失败 run 和 projection manifest 保留可诊断状态。
- 同一组织并发执行由数据库 advisory lock 与 active-run 检查串行化；重跑幂等但不覆盖其他版本。
- 提供受权限保护的手工触发与状态 API；Spring `@Scheduled` 只检查新的 frozen set，不扫描 ERP source。

### 3. PC 管理端与移动端切换

- Ontology 管理页和 API route 全部改为 Java read/write adapter；页面 UI 与既有表单交互保持不变。
- 移动端会话读取、追问、执行与历史回放复用 Java aggregate/follow-up/execute 接口；不保留移动端规则回答或 TypeScript 轻量兜底。
- TypeScript Worker 和 job ledger 对 `java-initial-v1`、`java-follow-up-v1` 继续严格隔离；切换后的入口不得再创建旧 contract job。
- 旧历史事实只读展示；缺少可迁移的 Java contract 时明确提示，不自动重跑或静默转写。

### 4. Spring AI / Alibaba Provider 边界

- Spring AI 2.0 GA 与 Boot 4.1 保持唯一依赖基线；Provider 通过现有 MainAgent/ConclusionProvider Adapter 隔离。
- DashScope 先使用其 OpenAI-compatible API，经 Spring AI OpenAI Adapter 接入，验证 Tool Calling、`returnDirect`、Structured Output 和无重试语义。
- 增加 Provider capability/startup 校验与 live profile，配置或能力不满足时启动或测试明确失败。
- Spring AI Alibaba 仅做自动兼容性检查和升级记录；在其正式版本仍依赖 Spring AI 1.x / Boot 3.x 时，不加入运行时依赖、不复制其 Agent loop。

### 5. 可观测与发布门禁

- Actuator health 显式呈现 PostgreSQL、Redis、Cube、Neo4j 与模型 Provider 状态；不得把必需上游失败标为健康。
- 为治理写入、发布、图同步和移动执行保留 trace/correlation ID 与可查询错误码。
- 提供生产迁移 preflight，发布前检测 0004 唯一索引所涉及的历史重复绑定及本阶段新增约束。
- 文档给出宿主机开发、Java Worker、图同步、DashScope live gate 和回滚步骤。

## 不在本阶段

- 不扩展为任意指标平台；分析运行时仍只承诺已完成真实 Provider 验证的 capability。
- 不引入 Alibaba ReactAgent、Graph、多 Agent Supervisor、NL2SQL 或 Nacos MCP。
- 不重写管理端或移动端视觉设计。
- 不自动迁移语义不完整的旧 TypeScript execution/follow-up；只提供明确诊断。
- 不增加模型级联、规则回答、缓存答案、吞错或降级成功。

## 验收标准

1. 管理端全部读写经 Java；越权、非法状态转换、重复审批与并发发布有确定错误码和审计记录。
2. Ontology 发布在真实 PostgreSQL 上原子提交；任何完整性校验或写入失败都保持旧版本为 current。
3. 新发布版本只影响之后提交的执行；已提交 root/follow-up 继续按 pinned version 可重放读取。
4. Java Graph Sync 能在真实 PostgreSQL + Neo4j 上按指定 frozen set 完成组织 rebuild、失败保留、恢复与历史版本隔离。
5. PC 管理页和移动分析不再引用 TypeScript Composition Root 的 Ontology、Graph Sync、Follow-up 或执行用例。
6. DashScope live gate 真实完成一次 Main Agent → Workflow Tool → Structured Conclusion；没有凭据时明确报告未验证，不伪造通过。
7. Java 单元测试、PostgreSQL/Neo4j Testcontainers、JSON Schema + Zod contract、Next route/component tests、lint、typecheck、production build 和 migration diff 全部通过。

## 完成定义

三阶段只有在 Java 成为 Ontology Governance、Graph Sync 和 PC/Mobile 分析入口的唯一业务实现，并且上述门禁有可复现证据时才算完成。仅新增接口、保留 TypeScript 旁路，或只通过 mock 测试，均不算完成。

## 收口证据（2026-08-22）

- Java 测试：216 个测试全部通过，包含真实 PostgreSQL 17 与 Neo4j 5 Testcontainers。
- Web / Java 契约：Next 透明代理（含认证路由与 Set-Cookie 透传）、JSON Schema、Zod 与移动端投影测试 48 个全部通过。
- 前端门禁：TypeScript、ESLint 与 Next.js production build 全部通过；生产构建生成 29 个页面。
- 数据库门禁：Flyway `V1__init.sql`（原 Drizzle 全部历史迁移合并的幂等初始化脚本）在 Testcontainers
  上验证：全新库一次性初始化、已有历史幂等 no-op、脚本本身可重复执行、旧库无历史时直接补全不丢数据。
- 容器门禁：生产 Web、Java backend、Flyway migration、PostgreSQL、Redis、Cube/Cube Store 与 Neo4j 联合验收通过。
- 认证边界：登录/退出/回调/URL 桥接、Cookie 签名（与历史 Node 字节级兼容）、Session 读写与 ERP 目录
  权限范围解析全部由 Java 承载；Next 6 个认证路由改为纯代理，登录页改由 Java `/api/auth/me` +
  `/api/auth/config` 驱动；`admin` 账号名特判（自动 PLATFORM_ADMIN）已彻底删除。
- 运行边界：Next 正式页面与 Route Handler 不再构造 TypeScript Composition Root；Web 容器不注入
  `DATABASE_URL`、`REDIS_URL`、`SESSION_SECRET` 或认证开关；旧 Node Agent/Worker/LLM/Tooling、
  Drizzle、Node PostgreSQL/Redis/Cube/Neo4j/Graph Sync/Ontology 实现、相关历史测试与依赖已删除；
  数据库迁移（Dockerfile.migrate / drizzle-kit）删除，migrate 由 Java Flyway 独立入口执行。
- Provider 边界：Java 固定 `max-retries=0`、关闭 parallel tool calls，并校验 tool calling 与 structured output capability。

尚未完成的是依赖真实外部环境的上线验收：使用目标 DashScope/OpenAI-compatible 凭据执行 Main Agent → Workflow Tool → Structured Conclusion，以及使用生产 ERP 数据验证图同步与目录登录。没有对应凭据和生产数据时，这两项保持“未验证”，不以 mock 或 fallback 代替。
