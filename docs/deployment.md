# 自托管容器部署指南

复用共享平台 PostgreSQL 的 `easyv-dev` 内部演示流程见
[`easyv-dev-deployment.md`](./easyv-dev-deployment.md)。该流程将 EasyV source ingestion 与长期运行的
API/Worker 凭据严格分离，并在同一 Compose 中运行 Property Cube / Neo4j；不启动第二套 PostgreSQL。

## 组件边界

| 服务 | 镜像来源 | 用途 |
|---|---|---|
| `web` | `Dockerfile` | Next.js 页面渲染、Java BFF 透明代理（含认证路由）与 Web 观测；不持有数据库/认证逻辑 |
| `backend` | `Dockerfile.java` | Java 21 + Spring Boot 4.1 API、认证（登录/退出/ERP 目录解析）、Spring AI Agent 与异步 Worker |
| `migrate` | `Dockerfile.java` | 一次性 Flyway 初始化入口（`--spring.profiles.active=migrate`）：执行幂等的 `V1__init.sql`，可重复执行 |
| `postgres` | `postgres:18.2-bookworm` | 业务、任务、事件、治理、图同步与审计事实源 |
| `redis` | `redis:8.2.5-bookworm` | Java Worker 唤醒；不是任务事实源 |
| `cube` | `cubejs/cube:v1.6.31` | 受治理指标查询 |
| `cubestore-router` | `cubejs/cubestore:v1.6.31` | Cube Store 查询路由与元数据节点 |
| `cubestore-worker` | `cubejs/cubestore:v1.6.31` | Cube Store 单机工作节点；与 Router 共享持久卷 |
| `neo4j` | `neo4j:5.26.24-community-ubi10` | 可重建图投影 |

生产拓扑不再启动 `src/worker/main.ts`。新 root/follow-up execution 只由 Java 领取；Node ledger 对
`java-initial-v1` 和 `java-follow-up-v1` 的所有 claim、terminal mutation 与 lease recovery 均拒绝处理。

认证（登录/退出/回调/URL 桥接/Cookie 签名/Session 读写/ERP 目录权限范围解析）全部由 Java 承载，
Next 侧 6 个认证路由与业务路由一样是透明代理，Web 容器不再注入 `DATABASE_URL`、`REDIS_URL`、
`SESSION_SECRET` 或任何认证开关。Web 只保留页面渲染、Java BFF、观测与 UI 映射。

## 发布顺序

1. 从模板创建生产配置并填写全部占位值：

   ```bash
   cp .env.prod.example .env.prod
   docker compose -f compose.prod.yaml --env-file .env.prod config --quiet
   ```

2. 在停止旧 Node Worker 后，先启动目标 PostgreSQL，再通过同一 Compose 网络执行只读切换检查。
   不需要暴露数据库端口，也不依赖模板中不存在的宿主机 `DATABASE_URL`：

   ```bash
   docker compose -f compose.prod.yaml --env-file .env.prod up -d postgres
   docker compose -f compose.prod.yaml --env-file .env.prod run --rm preflight
   ```

   检查项包括 0004/0005 唯一索引的历史重复、多个 current ontology、仍活跃的 legacy analysis job、
   未结束的 graph sync run、重复 dirty scope，以及 follow-up 与 snapshot 绑定不一致。脚本不自动修数据；
   必须先确认业务事实后再处理根因。全新空数据库会明确输出 `fresh database`；若已有 `platform`
   schema 但结构不完整，检查会直接失败，不会把半迁移数据库当成空库。

3. 执行数据库初始化（Flyway 独立入口，应用启动不自动迁移）：

   ```bash
   docker compose -f compose.prod.yaml --env-file .env.prod run --rm migrate
   ```

   初始化脚本定位为新库重建与初始化（`V1__init.sql`，全部 `IF NOT EXISTS`，可重复执行）：
   - 全新空库 → 一次性建齐全部 schema/表/索引；
   - 已初始化库 → Flyway 校验 checksum 后幂等 no-op，不重跑；
   - 无 Flyway 历史的旧库 → 直接补全缺失列/索引，不丢数据、不报错。

4. 构建并启动：

   ```bash
   docker compose -f compose.prod.yaml --env-file .env.prod up -d --build
   docker compose -f compose.prod.yaml --env-file .env.prod ps
   docker compose -f compose.prod.yaml --env-file .env.prod logs backend web --tail=100
   ```

`migrate` 必须成功退出后 `backend` 才启动，`web` 又必须等待 `backend` 健康。生产模式的 Cube
显式依赖独立的 Cube Store Router/Worker，不能依赖开发模式内置缓存。Next 容器只通过
`JAVA_BACKEND_URL=http://backend:8080` 访问 Java，不使用宿主机回环地址。

5. 全新事实库只通过 Java 初始化固定 Ontology baseline，再从 backend 容器内执行 system-only Graph
   bootstrap。Graph system API 不经过 Next，运维密钥不会下沉到 Web：

   ```bash
   curl --fail --silent --request POST \
     --header "Cookie: dip3_session=${DIP3_SESSION_COOKIE}" \
     "http://127.0.0.1:${APP_PORT:-3000}/api/admin/ontology/bootstrap"

   docker compose -f compose.prod.yaml --env-file .env.prod exec -T backend \
     sh -lc 'curl --fail --silent --request POST --header "X-Graph-Sync-Ops-Secret: ${GRAPH_SYNC_OPS_SECRET}" http://127.0.0.1:8080/api/system/graph-sync/bootstrap'
   ```

   `DIP3_SESSION_COOKIE` 必须来自已登录的 `PLATFORM_ADMIN` 会话。Ontology API 仅在 registry 全空时写入；
   完整 current 重复调用只读返回，半成品或多 current 会明确失败。Graph bootstrap 在开始时冻结同一个
   `DatasetVersionSet` 及其产品版本，只有所有组织都成功投影后 parent run 才完成；失败 parent/child run
   保留在 PostgreSQL 供诊断，已完成组织在 Neo4j 留有同版本的 projection manifest。

## 必填配置

- `SESSION_SECRET`：会话 Cookie 签名密钥（Java backend），必须是生产随机值。
- `ERP_API_BASE_URL`：ERP 目录认证接口地址（Java backend 登录必需）；目录登录不可用时请确保
  已配置其他受支持的登录入口，否则登录页会明确提示不可用。
- `COOKIE_SECURE=true`：生产会话 Cookie 必须带 Secure（compose.prod.yaml 已固定）。
- `POSTGRES_*`、`REDIS_KEY_PREFIX`：容器内部地址由 Compose 固定，不填写宿主机地址。
- `CUBE_API_SECRET`、`NEO4J_*`：Java evidence 与 Graph Sync 使用。
- `LLM_PROVIDER_BASE_URL/API_KEY/MODEL`：真实模型配置。
- `LLM_PROVIDER_MODE`：仅 `openai-compatible` 或 `dashscope`。
- `LLM_PROVIDER_TOOL_CALLING=true`。
- `LLM_PROVIDER_STRUCTURED_OUTPUT`：通用 Provider 可用 `native-json-schema` 或 `json-object`；
  DashScope 必须是 `json-object`。
- `JAVA_GRAPH_SYNC_ENABLED=true`：生产启用 canonical 图投影调度；本地模板默认关闭。
- `JAVA_GRAPH_SYNC_POLL_DELAY`：检查新 frozen Dataset Version Set 的频率；Graph Sync 不再扫描 ERP 来源。
- `GRAPH_SYNC_OPS_SECRET`：仅 Java system-only full bootstrap 使用的长随机密钥；不配置时接口直接拒绝执行。

Provider 声明、HTTPS 地址、零重试和禁用并行工具调用在 Java 启动时校验；不符合时容器直接失败，
不会切换模型或返回降级答案。

## 本地开发

日常开发推荐只容器化 PostgreSQL、Redis、Cube、Neo4j，宿主机分别运行 `pnpm dev` 与
`mvn -f backend-java/pom.xml spring-boot:run`。需要验证完整容器边界时才运行：

```bash
docker compose --env-file .env.example up -d --build
```

开发 Compose 同样使用 Java backend，不再启动 Node Worker。Java 容器固定 `Asia/Taipei` JVM 时区；
生产也使用相同边界，避免 PostgreSQL/Cube 日期口径随宿主机漂移。

## 健康与诊断

- `web`：`http://127.0.0.1:3000/`
- `backend`：容器内 `/actuator/health`
- 任务事实：`platform.jobs`、`platform.job_events`、`platform.analysis_execution_events`
- Graph Sync：`platform.graph_sync_runs`；历史 `cursors/dirty_scopes` 表只保留迁移审计，不参与活动链路
- Graph Sync 管理 API：经 Web 透明代理访问 `/api/admin/graph-sync/status`、组织 rebuild/status 与
  consistency sweep；Java scheduler 只检查是否出现新的 frozen Dataset Version Set，不直接扫描 ERP
  来源。组织操作只接受同组织 `PLATFORM_ADMIN`。
- 关键失败响应：`code + traceId`；日志按同一 correlation ID 检索。

`llmProvider` health 在未真实探测上游时返回 `UNKNOWN`，不会泄露 API key/base URL，也不会伪报 `UP`。
真实 Tool Calling、Structured Output 和 evidence grounding 必须由 `live-integration` profile 验证。

## 验证与回滚

发布前至少执行：

```bash
mvn -f backend-java/pom.xml test
pnpm test:web
pnpm exec tsc --noEmit
pnpm build
docker compose -f compose.prod.yaml --env-file .env.prod config --quiet
```

有真实 Provider、Cube、Neo4j 与业务数据凭据时再执行：

```bash
mvn -f backend-java/pom.xml verify -Plive-integration
```

回滚应用镜像不得回滚数据库 migration。若必须恢复旧 Node Worker，先停止 Java backend，确认不存在
活跃 Java contract job，并明确评审共享表 ownership；不能让两个 Worker 同时领取 `analysis-execution`。
