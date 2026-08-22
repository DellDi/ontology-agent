# 本地基础设施基线

## 目标

当前 Compose 支持 `web`、`backend`、一次性 `migrate`、`postgres`、`redis`、`cube`、`neo4j` 的完整联调拓扑。日常开发默认只在容器中运行四个基础设施服务，Next.js 与 Java API/Worker 在宿主机运行。

当前阶段的职责划分：

- `web` 运行现有 Next.js App Router 展示层与 Java 透明代理
- `backend` 同一 Spring Boot 应用承载 Java API 与独立调度的异步 Worker
- `postgres` 承接平台表与 `erp_staging` schema
- `redis` 提供队列、限流和短时缓存
- `cube` 提供治理后的语义指标只读 API
- `neo4j` 提供图谱读取与受控同步目标库
- `cube` 的运行时缓存通过独立 volume 挂载，不再把 `.cubestore` 运行态文件写回源码目录

## 使用前准备

1. 从样例文件生成本地环境变量文件：

```bash
cp .env.example .env
```

2. 按需调整 `.env` 中的端口和凭据。

关键约定：

- `ENABLE_DEV_ERP_AUTH=1` 只用于本地联调，不能复制成生产或试点环境默认值
- 宿主机 `.env` 中的 `DATABASE_URL` / `REDIS_URL` 默认指向 `127.0.0.1`，便于直接运行 `pnpm db:migrate` 等本地命令
- `compose.yaml` 会为 `web` 容器显式覆写内部连接地址，使容器内仍通过 `postgres` / `redis` 服务名通信
- `SESSION_SECRET` 需要在本地 `.env` 中设置为自定义值
- `LLM_PROVIDER_API_KEY` 只允许存在于服务端环境变量中，不能下沉到浏览器端代码或公开配置
- `CUBE_API_SECRET` 用于本地 Cube 服务签发 JWT；本地开发建议在复制 `.env.example` 后先设置一个固定值
- Java backend 会基于 `CUBE_API_SECRET` 自动签发 Cube API JWT；本地开发不需要维护额外的 Cube 鉴权环境变量

## 常用命令

生成最终配置：

```bash
docker compose config
```

后台启动全部服务：

```bash
docker compose up -d
```

如果只想先拉起 4.4 / 4.5 联调所需的真实依赖：

```bash
docker compose up -d postgres redis neo4j cube
```

查看服务状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f web
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f cube
docker compose logs -f neo4j
```

运行 Java Graph Sync 的 PostgreSQL + Neo4j Testcontainers 验证：

```bash
pnpm test:java
```

停止服务：

```bash
docker compose down
```

连同命名卷一起清理：

```bash
docker compose down -v
```

## 连接方式

- Web: `http://127.0.0.1:${APP_PORT}`
- Postgres: `127.0.0.1:${POSTGRES_PORT}`
- Redis: `127.0.0.1:${REDIS_PORT}`
- Cube API: `http://127.0.0.1:${CUBE_PORT}/cubejs-api/v1`
- Neo4j Bolt: `bolt://127.0.0.1:${NEO4J_BOLT_PORT}`
- Neo4j Browser: `http://127.0.0.1:${NEO4J_HTTP_PORT}`

Postgres 与 Redis 的端口默认只绑定到本机回环地址，避免在本地开发态被无意暴露到局域网。
如果宿主机已经有本地 Postgres 占用 `5432`，建议像当前样例一样把 Compose 暴露端口改到其他可用值，例如 `55432`，同时同步更新 `.env` 中的 `DATABASE_URL`。

## 运行约定

- `web` 容器基于 Node.js 24 的 Debian 镜像
- 容器内通过 `corepack` 启用 `pnpm`
- 仓库源码通过 bind mount 挂载到 `/workspace`
- `node_modules` 与 `pnpm` store 使用独立命名卷，避免污染宿主依赖目录
- `web` 会在 `postgres` 与 `redis` 健康检查通过后再启动
- `web` 与 `backend` 都会等待 `cube` 与 `neo4j` 达到健康状态，避免代码声称接入但本地服务并不存在
- Postgres 18 官方镜像建议把命名卷挂到 `/var/lib/postgresql`，避免沿用旧数据目录布局时触发启动失败
- Neo4j 使用 `5.26.x community` 线，Cube 使用 `v1.6.x` 线，两个镜像都固定为明确版本标签，不使用 `latest`
- `cube/conf/.cubestore/` 属于运行时缓存目录，不应纳入 Git；当前已通过 Compose volume 与 `.gitignore` 双重隔离

## Redis 客户端与 Key Namespace 约定

### 客户端入口

统一 Redis 客户端位于 `src/infrastructure/redis/client.ts`，使用官方 `redis` (node-redis) 库。

```typescript
import { createRedisClient } from '@/infrastructure/redis';

const { redis } = createRedisClient();
await redis.connect();
```

- 客户端读取 `REDIS_URL` 环境变量，缺失时抛出明确错误
- 创建后需显式调用 `redis.connect()` 建立连接
- 连接错误通过 `error` 事件监听，不会静默失败
- Web 请求路径应使用 `getSharedRedisClient()` + `ensureRedisConnected()` 复用进程级连接，调用方不得关闭共享连接
- 测试、CLI、worker 这类独占生命周期入口继续使用 `createRedisClient()`，谁创建谁关闭

### Key Namespace 约定

所有 Redis key 使用统一前缀 `oa:` (ontology-agent 缩写)，通过 `redisKeys` builder 生成：

| 命名空间 | 格式 | 用途 |
|----------|------|------|
| `rate` | `oa:rate:{userId}:{resource}` | 按用户限流 |
| `job` | `oa:job:queue` / `oa:job:queue:dlq` | Worker 任务唤醒 stream 与历史 Redis-only dead-letter queue |
| `worker` | `oa:worker:{jobId}:{field}` | 历史 Redis-only 任务元数据；新任务事实源在 Postgres |
| `stream` | `oa:stream:{sessionId}` | 流式状态 / SSE 事件 |
| `cache` | `oa:cache:{scope}:{key}` | 短时缓存 |

环境隔离：可通过 `REDIS_KEY_PREFIX` 环境变量覆盖默认前缀，用于测试环境隔离。

```typescript
import { redisKeys } from '@/infrastructure/redis';

redisKeys.rate('user-123', 'analysis');    // → "oa:rate:user-123:analysis"
redisKeys.worker('job-456', 'status');     // → "oa:worker:job-456:status"
```

### Redis Job Queue 语义

Worker job queue 使用 Postgres-backed durable ledger + Redis Streams consumer group。Postgres 是任务最终事实源；Redis 只保存 `jobId` 唤醒信号，不再保存 canonical job data。

- 提交任务：写入 `platform.jobs`、`platform.job_events` 和 `platform.job_dispatch_outbox`，再向 `oa:job:queue` 发布 `jobId`
- 消费任务：worker 通过 `XREADGROUP` / `XAUTOCLAIM` 获取 `jobId`，随后必须在 Postgres 原子 claim 成功才会执行 handler
- 崩溃恢复：Postgres `locked_until` 是 visibility timeout 的权威字段；过期 lease 会被 recovery 重新置为可调度
- 完成/失败：`completeJob` / `failJob` 先写 Postgres terminal 状态，再 `XACK` 当前 Redis signal
- 重复信号：若 Redis 重投递已完成、失败或 dead-letter 的 job，worker 只 ack 并忽略，不重复执行
- 超过重试上限：job 在 `platform.jobs` 标记为 `dead_letter`，并在 `platform.job_events` 记录原因

Java durable job ledger 与 Redis wakeup 回归测试：

```bash
pnpm test:java
```

Java 测试使用 Testcontainers 隔离数据库与图实例；不会清理本地开发库，也不会执行 `FLUSHDB`。

当前语义是 `at-least-once dispatch + Postgres-authoritative execution state`，不是 exactly-once。业务 handler 仍应以 `job.id` / `executionId` 做幂等边界。

### 健康检查

```typescript
import { checkRedisHealth } from '@/infrastructure/redis';

const result = await checkRedisHealth(redis);
// → { ok: true, latencyMs: 2 }
```

## LLM Provider 约定

### 服务端接入边界

- 所有模型调用只经过 Java `MainAgent` / `ConclusionProvider` ports，由 Spring AI 2.0 的 adapter 实现。
- Next.js 页面和 Route Handler 只通过 `JAVA_BACKEND_URL` 调用 Java API，不持有 Provider、Cube 或 Neo4j 凭据。
- Main Agent 必须且只允许调用一次 `analysis_workflow` tool；workflow 完成确定性取数后，再由结论模型生成结构化结论，不进入第二轮自主 tool loop。
- Provider 失败会写入任务和执行事件并明确失败；不切换模型、不生成规则式替代答案、不返回伪成功。

### 环境变量

```bash
LLM_PROVIDER_BASE_URL=https://api.openai.com/v1
LLM_PROVIDER_API_KEY=replace-with-a-real-provider-key
LLM_PROVIDER_MODEL=replace-with-provider-model
LLM_PROVIDER_MODE=openai-compatible
LLM_PROVIDER_TOOL_CALLING=true
LLM_PROVIDER_STRUCTURED_OUTPUT=native-json-schema
```

- `openai-compatible` 模式支持 `native-json-schema` 或 `json-object` 结构化输出。
- Alibaba DashScope 作为重点跟踪对象时，使用已验证兼容的 base URL，并把结构化输出设置为 `json-object`。
- Java adapter 固定 `max-retries=0`，关闭 parallel tool calls，不接受 fallback model 列表。
- `LLM_PROVIDER_MODEL` 必须显式配置；模型能力必须满足 tool calling 与所选 structured output 模式。

### 真实 LLM Provider Smoke Test

配置真实 Provider 凭据后执行：

```bash
mise exec java@temurin-21.0.12+8.0.LTS --% -- mvn -f backend-java/pom.xml verify -Plive-integration
```

没有真实凭据时不要执行，也不要用 mock 或 fallback 将该门禁标记为通过。

## 后续扩展位

当前 `compose.yaml` 已定义完整 Web/Java 联调拓扑；日常宿主机开发只需启动 `postgres`、`redis`、`cube`、`neo4j`。

后续扩展应沿 Java feature package 与 ports/adapters 边界增加，不再向旧 TypeScript Worker 增加正式能力。数据库 schema 变更必须同步生成并提交 Drizzle migration。

## Cube 本地语义层

### 最小模型

当前仓库内已提供最小 Cube 配置：

- `cube/conf/cube.js`
- `cube/conf/model/Finance.js`
- `cube/conf/model/ServiceOrders.js`

它们直接面向当前已存在的 `erp_staging` 表，覆盖：

- `Finance`：收缴率、应收金额、实收金额
- `ServiceOrders`：工单总量、投诉量、平均满意度、平均响应时长、平均关闭时长

### Cube API 签名

复制 `.env.example` 为 `.env` 并设置 `CUBE_API_SECRET` 后，Java backend 会自动签发 Cube API JWT。

当前 Compose 中的 Cube 仍启用 `CUBEJS_DEV_MODE=true`，这样本地联调不会因为外部调试请求缺少鉴权头而完全阻塞；应用侧会始终用 `CUBE_API_SECRET` 自动签发请求头。

### 最小验证

启动 `cube` 后，可直接验证：

```bash
curl http://127.0.0.1:4000/readyz
```

如果需要验证应用侧到 Cube 的签名请求，优先通过语义查询链路或对应 story 测试验证，不再维护手工鉴权生成入口。

```bash
node --test tests/story-4-4-semantic-query.test.mjs
```

## Neo4j 本地图谱

### 最小验证

浏览器查看：

```text
http://127.0.0.1:7474
```

Bolt 地址：

```text
bolt://127.0.0.1:7687
```

如需命令行验证：

```bash
docker compose exec neo4j \
  cypher-shell -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" 'RETURN 1;'
```

## Java API 与 Worker

### 角色

Java Worker 与 HTTP 请求线程使用同一个 Spring Boot 部署单元，但通过独立 scheduler 领取 PostgreSQL job 并执行。Next.js 只调用 Java API，不在 Route Handler 内同步执行长任务。

### 任务契约

Java execution package 定义 `java-initial-v1` 与 `java-follow-up-v1` 两类正式 contract。任务载荷固定绑定 session、execution、follow-up（如有）、权限范围与 ontology version；不符合 contract 的任务会明确失败，不进入旧 TypeScript Worker。

### 队列机制

使用 Postgres durable job ledger 作为任务事实源，Redis Streams 只做唤醒/分发：

- Java application service 在同一数据库事务中创建 job 与 outbox
- Java Worker 先通过 PostgreSQL 原子 claim 获取租约，再执行 Main Agent
- 任务元数据、状态、结果、错误、attempt 和 lease 存储在 `platform.jobs`
- Redis stream entry 只携带 `jobId`

### 本地运行

```bash
# 启动 Java API 与 Worker（需要 PostgreSQL、Redis、Cube、Neo4j 已启动）
mise exec java@temurin-21.0.12+8.0.LTS --% -- mvn -f backend-java/pom.xml spring-boot:run

# 通过 Docker Compose 启动 Java backend
docker compose up -d backend
```

### 扩展新任务类型

1. 在 `backend-java` 的 execution feature 中增加明确的 contract 与状态语义
2. 由 `AnalysisWorker` 注册处理边界，并保持 Main Agent → Workflow Tool 的唯一智能链路
3. 补充租约、事务、事件、失败与 contract 测试
