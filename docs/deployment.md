# 自托管容器部署指南

## 组件边界

| 服务 | 镜像来源 | 用途 |
|---|---|---|
| `web` | `Dockerfile` | Next.js 展示层、Cookie/状态码透明代理与尚未迁移的非关键管理入口 |
| `backend` | `Dockerfile.java` | Java 21 + Spring Boot 4.1 API、Spring AI Agent 与异步 Worker |
| `migrate` | `Dockerfile.migrate` | 一次性执行 Drizzle migration；镜像不包含旧 TypeScript Worker 入口 |
| `postgres` | `postgres:18.2-bookworm` | 业务、任务、事件、治理、图同步与审计事实源 |
| `redis` | `redis:8.2.5-bookworm` | Java Worker 唤醒；不是任务事实源 |
| `cube` | `cubejs/cube:v1.6.31` | 受治理指标查询 |
| `cubestore-router` | `cubejs/cubestore:v1.6.31` | Cube Store 查询路由与元数据节点 |
| `cubestore-worker` | `cubejs/cubestore:v1.6.31` | Cube Store 单机工作节点；与 Router 共享持久卷 |
| `neo4j` | `neo4j:5.26.24-community-ubi10` | 可重建图投影 |

生产拓扑不再启动 `src/worker/main.ts`。新 root/follow-up execution 只由 Java 领取；Node ledger 对
`java-initial-v1` 和 `java-follow-up-v1` 的所有 claim、terminal mutation 与 lease recovery 均拒绝处理。

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

3. 构建并启动：

   ```bash
   docker compose -f compose.prod.yaml --env-file .env.prod up -d --build
   docker compose -f compose.prod.yaml --env-file .env.prod ps
   docker compose -f compose.prod.yaml --env-file .env.prod logs backend web --tail=100
   ```

`migrate` 必须成功退出后 `backend` 才启动，`web` 又必须等待 `backend` 健康。生产模式的 Cube
显式依赖独立的 Cube Store Router/Worker，不能依赖开发模式内置缓存。Next 容器只通过
`JAVA_BACKEND_URL=http://backend:8080` 访问 Java，不使用宿主机回环地址。

4. 全新事实库只通过 Java 初始化固定 Ontology baseline，再从 backend 容器内执行 system-only Graph
   bootstrap。Graph system API 不经过 Next，运维密钥不会下沉到 Web：

   ```bash
   curl --fail --silent --request POST \
     --header "Cookie: dip3_session=${DIP3_SESSION_COOKIE}" \
     "http://127.0.0.1:${APP_PORT:-3000}/api/admin/ontology/bootstrap"

   docker compose -f compose.prod.yaml --env-file .env.prod exec -T backend \
     sh -lc 'curl --fail --silent --request POST --header "X-Graph-Sync-Ops-Secret: ${GRAPH_SYNC_OPS_SECRET}" http://127.0.0.1:8080/api/system/graph-sync/bootstrap'
   ```

   `DIP3_SESSION_COOKIE` 必须来自已登录的 `PLATFORM_ADMIN` 会话。Ontology API 仅在 registry 全空时写入；
   完整 current 重复调用只读返回，半成品或多 current 会明确失败。Graph bootstrap 捕获七类 ERP watermark，
   只有所有组织成功后才一次性初始化 cursors；失败 parent/child run 保留在 PostgreSQL 供诊断。

## 必填配置

- `SESSION_SECRET`：共享 Cookie 签名密钥，必须是生产随机值。
- `POSTGRES_*`、`REDIS_KEY_PREFIX`：容器内部地址由 Compose 固定，不填写宿主机地址。
- `CUBE_API_SECRET`、`NEO4J_*`：Java evidence 与 Graph Sync 使用。
- `LLM_PROVIDER_BASE_URL/API_KEY/MODEL`：真实模型配置。
- `LLM_PROVIDER_MODE`：仅 `openai-compatible` 或 `dashscope`。
- `LLM_PROVIDER_TOOL_CALLING=true`。
- `LLM_PROVIDER_STRUCTURED_OUTPUT`：通用 Provider 可用 `native-json-schema` 或 `json-object`；
  DashScope 必须是 `json-object`。
- `JAVA_GRAPH_SYNC_ENABLED=true`：生产启用 Java 增量图同步；本地模板默认关闭，避免开发机意外扫描共享 ERP。
- `JAVA_GRAPH_SYNC_POLL_DELAY` 与 `JAVA_GRAPH_SYNC_SOURCES`：显式控制扫描频率和七类 ERP 来源。
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
- Graph Sync：`platform.graph_sync_runs/cursors/dirty_scopes`
- Graph Sync 管理 API：经 Web 透明代理访问 `/api/admin/graph-sync/status`、组织 rebuild/status 与
  consistency sweep；全局 source incremental 只由 Java scheduler 执行，组织操作只接受同组织 `PLATFORM_ADMIN`。
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
