# Java 分析后端

Java 21、Spring Boot 4.1、Spring AI 2.0、MyBatis-Plus 3.5.17 与 Flyway 12 实现的分析纵向切片。
PostgreSQL 是 session、job、event、snapshot 与审计事实源（迁移由本工程 Flyway 独占），
Redis 只负责唤醒 Worker。

## 数据库初始化（Flyway 独占）

- 初始化脚本：`src/main/resources/db/migration/V1__init.sql`
  （由原 Drizzle 全部历史迁移合并而成，全部 `IF NOT EXISTS`，可重复执行）；
  后续 schema 变更新增 `V2+`。
- 独立迁移入口（应用常规启动不自动迁移，`spring.flyway.enabled=false`）：
  ```bash
  mvn -f backend-java/pom.xml spring-boot:run -Dspring-boot.run.profiles=migrate
  ```
- 幂等语义：空库建齐全部 schema/表/索引；已有 Flyway 历史则 no-op；
  无历史的旧库直接补全缺失列/索引。实现见 `support/DatabaseMigrationService`。

## 认证（Java 承载）

登录/退出/回调/URL 桥接、Cookie 签名（`dip3_session`，与历史 Node 字节级兼容）、Session
读写（`platform.auth_sessions`，TTL 8h）与 ERP 目录权限范围解析（组织路径 → propertyProject →
precinct）全部由 Java 实现，Next 侧认证路由为纯代理。目录账号只授予 `PROPERTY_ANALYST`，
不存在账号名特判（无内置平台管理员）。

Spring AI Alibaba 2.x 当前只作为兼容性跟踪对象，不进入运行时依赖。截至 2026-08-14，Maven Central
最新 `com.alibaba.cloud.ai:spring-ai-alibaba-bom:2.0.0-M1.1` 仍绑定 Spring AI `2.0.0-M1` 与
Spring Boot `4.0.0`，Graph 还直接依赖 Jackson 2；它不能与本项目 Spring AI `2.0.0` GA、
Spring Boot `4.1.0`、Jackson 3 基线直接混用。Maven Enforcer 当前拒绝全部 `com.alibaba.cloud.ai:*`
运行时依赖，防止未经验证的新 milestone 被误放行；待其发布与当前基线对齐的正式版本后，先通过独立
兼容性验证，再把门禁收窄到已经验证的坐标。

## 当前能力边界

当前运行时只发布一个完整能力：`project` 实体 + `collection-rate` 指标定义 +
`project-collection-rate` 指标变体 + `receivable-accounting-period` 时间语义。问题必须给出可确定的
日期范围；项目只能取当前授权范围的全部项目或其明确子集。Main Agent 只允许调用一次
`analysis_workflow`，Workflow 再按已发布本体的 active tool binding 串行调用 ERP、Cube、Neo4j
与结论模型。任一必要证据为空或 Provider 失败即进入明确失败态，不生成降级结论。

新环境使用 `GET /api/admin/ontology/bootstrap` 查看基线状态，再由 `PLATFORM_ADMIN` 调用
`POST /api/admin/ontology/bootstrap` 安装固定 Java canonical baseline。POST 不接受调用方 seed；它只在
Ontology registry 全空时写入，并在同一个 PostgreSQL 事务中持有 blocking advisory lock、校验治理发布
完整性与 `AnalysisWorkflow` 运行时能力、写 publish record 和 correlation audit。已有完整 current 时只读
幂等返回；半成品、多 current 或不完整 current 会明确失败，不覆盖已有事实。

新会话的 `savedContext`、Java job payload 与根轮 snapshot plan 以 `java-initial-v1` 标识；追问轮使用
`java-follow-up-v1`。追问只能承接已持久化的完成态结论、`_resolvedContext` 与 pinned ontology version；
上下文冲突必须显式确认，变更后必须重规划再执行。每轮拥有独立 Job、Event、Snapshot、证据和结论，
页面刷新或历史回看不会重跑。

Spring AI 原生 `MessageChatMemoryAdvisor` 与 JDBC ChatMemory 只用于 follow-up 模型消息上下文，按 session
隔离；它不取代 PostgreSQL 中的 follow-up、plan、event 与 snapshot 业务事实。Main Agent 仍只允许调用一次
`analysis_workflow`，不实现自造 Agent loop，也不为失败增加模型或规则 fallback。

缺少 `java-initial-v1` 标识的历史 TypeScript 会话仍可查看，但不会自动执行，也不能通过 Java execute
接口重跑；调用会以 `LEGACY_EXECUTION_NOT_MIGRATED` 明确失败。旧历史迁移不属于当前阶段。

## LLM Provider 模式

Provider 能力必须显式声明，应用不会推断能力或切换 fallback：

- `LLM_PROVIDER_MODE=openai-compatible`：通用 OpenAI-compatible 服务；根据上游实际能力显式选择
  `native-json-schema` 或 `json-object`，并由上线前真实 Provider 测试证明支持。
- `LLM_PROVIDER_MODE=dashscope`：阿里云百炼 OpenAI 兼容接入；URL 必须是所属地域或业务空间的
  HTTPS `.../compatible-mode/v1`，结构化输出必须声明为已公开支持的 `json-object`。这条路径复用
  Spring AI 2.0 GA 的 OpenAI adapter，不引入不兼容的 Alibaba Agent Framework milestone。
- 两种模式都要求 `LLM_PROVIDER_TOOL_CALLING=true`，且固定 Provider 的 `max-retries=0`、
  `parallel-tool-calls=false`。不满足时应用启动失败。

`llmProvider` health contributor 只报告脱敏后的配置能力，状态为 `UNKNOWN`，明确标记
`upstreamReachability=not-probed`；它不会在未调用上游时伪报 `UP`。真实连通性、tool calling 和结构化
输出由 `live-integration` 门禁验证。

## 本地运行

先启动并初始化 PostgreSQL、Redis、Cube 与 Neo4j，再让当前 shell 获得根目录 `.env` 中的配置。
宿主机开发默认由 `POSTGRES_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`
组成 JDBC 地址；部署环境可用 `JAVA_DATABASE_URL`、`JAVA_DATABASE_USERNAME`、
`JAVA_DATABASE_PASSWORD` 显式覆盖。

```powershell
$java21 = 'C:\Users\zxzho\AppData\Local\mise\installs\java\temurin-21.0.12+8.0.LTS'
$env:JAVA_HOME = $java21
$env:Path = "$java21\bin;$env:Path"
mvn -f backend-java/pom.xml spring-boot:run
```

Next.js 的分析读写适配器只读取 `JAVA_BACKEND_URL`，例如 `http://127.0.0.1:8080`。
现有登录入口仍按仓库原有配置创建共享 Cookie session。Java 服务不会回退到旧的 TypeScript
执行链路；Provider、ontology、契约或权限失败都会显式返回并持久化错误事实。

追问闭环使用以下正式边界：

- `POST /api/analysis/sessions/{sessionId}/follow-ups` 创建根轮或父追问的下一轮。
- `POST /api/analysis/sessions/{sessionId}/follow-ups/{followUpId}/context` 显式纠正上下文。
- `POST /api/analysis/sessions/{sessionId}/follow-ups/{followUpId}/replan` 保存新计划与 diff。
- `POST /api/analysis/sessions/{sessionId}/execute` 携带 `followUpId` 提交追问执行。
- `GET /api/analysis/sessions/{sessionId}` 返回有序 follow-ups、轮次历史和选中执行事实。

## 验证

常规测试使用 Testcontainers PostgreSQL 执行完整 Drizzle migration：

```powershell
mvn -f backend-java/pom.xml test
pnpm test:java-contract
```

真实 Provider 门禁不会用 mock 或跳过失败。Maven 不会自动读取仓库根目录 `.env`；当前 shell 必须先提供
`REDIS_URL`、`SESSION_SECRET`、`LLM_PROVIDER_BASE_URL`、`LLM_PROVIDER_API_KEY`、
`LLM_PROVIDER_MODEL`、`LLM_PROVIDER_MODE`、`LLM_PROVIDER_TOOL_CALLING`、
`LLM_PROVIDER_STRUCTURED_OUTPUT`、`CUBE_API_URL`、`CUBE_API_SECRET`、`NEO4J_URI`、`NEO4J_USERNAME`、
`NEO4J_PASSWORD`，以及上文两组 PostgreSQL 配置中的任意一组。业务验证还必须提供：
`LIVE_USER_ID`、`LIVE_ORGANIZATION_ID`、`LIVE_PROJECT_IDS`、`LIVE_ONTOLOGY_VERSION_ID`、
`LIVE_ENTITY_KEY`、`LIVE_METRIC_DEFINITION_KEY`、`LIVE_METRIC_VARIANT_KEY`、
`LIVE_TIME_SEMANTIC_KEY`、`LIVE_FROM`、`LIVE_TO`、`LIVE_QUESTION`。这些语义键必须等于本节固化的
唯一首切片能力；问题必须明确包含实体、指标、项目与日期范围，以验证真实模型能生成受治理 Tool 参数。
这些值必须指向已经同步到 PostgreSQL、Cube 与 Neo4j 的同一批真实业务数据。

```powershell
mvn -f backend-java/pom.xml verify -Plive-integration
```
