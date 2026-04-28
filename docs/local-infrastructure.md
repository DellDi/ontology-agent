# 本地基础设施基线

## 目标

当前本地基础设施基线通过一个 Compose 配置启动 `web`、`worker`、`postgres`、`redis`、`cube`、`neo4j` 六个服务，让代码、环境变量、文档和真实依赖保持一致。

当前阶段的职责划分：

- `web` 继续运行现有 Next.js App Router 工程
- `worker` 独立进程消费 Redis 任务队列，与 web 进程职责分离
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
- `DASHSCOPE_API_KEY` 只允许存在于服务端环境变量中，不能下沉到浏览器端代码或公开配置
- `CUBE_API_SECRET` 用于本地 Cube 服务签发 JWT；本地开发建议在复制 `.env.example` 后先设置一个固定值
- `CUBE_API_TOKEN` 建议通过 `pnpm cube:token` 生成，再写回 `.env`

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

运行真实 Neo4j smoke test：

```bash
pnpm test:smoke:neo4j
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
- `web` 与 `worker` 现在都会等待 `cube` 与 `neo4j` 达到健康状态，避免代码声称接入但本地服务并不存在
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

真实回归测试：

```bash
pnpm test:real:redis-queue
pnpm test:real:job-ledger
```

这些测试会使用唯一 `REDIS_KEY_PREFIX` / job id 隔离数据，只清理本次测试数据，不会 `FLUSHDB`。Postgres ledger 测试要求先运行 `pnpm db:migrate`。

当前语义是 `at-least-once dispatch + Postgres-authoritative execution state`，不是 exactly-once。业务 handler 仍应以 `job.id` / `executionId` 做幂等边界。

### 健康检查

```typescript
import { checkRedisHealth } from '@/infrastructure/redis';

const result = await checkRedisHealth(redis);
// → { ok: true, latencyMs: 2 }
```

## LLM Provider 约定

### 服务端接入边界

- 所有模型调用统一走 `src/application/llm/` + `src/infrastructure/llm/`，不要在 `src/app/` 页面或 Route Handler 中零散直连 provider。
- 当前实现采用 OpenAI-compatible HTTP 接口，默认约定：
  - `POST {LLM_PROVIDER_BASE_URL}/responses`
  - `POST {LLM_PROVIDER_BASE_URL}/chat/completions`
  - `GET {LLM_PROVIDER_BASE_URL}/models` 作为基础健康检查
- Provider 密钥只通过 `LLM_PROVIDER_API_KEY` 在服务端注入。

### 环境变量

```bash
LLM_PROVIDER_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_API_KEY=replace-with-a-real-dashscope-key
LLM_PROVIDER_MODEL=bailian/kimi-k2.5
LLM_FALLBACK_MODELS=bailian/qwen3.6-plus,bailian/glm-5,bailian/MiniMax/MiniMax-M2.7
LLM_REQUEST_TIMEOUT_MS=15000
LLM_MAX_RETRIES=2
LLM_RATE_LIMIT_MAX_REQUESTS=20
LLM_RATE_LIMIT_WINDOW_SECONDS=60
```

- 当前默认主模型：`bailian/kimi-k2.5`
- 默认第一 fallback：`bailian/qwen3.6-plus`
- 其它备用：`bailian/glm-5`、`bailian/MiniMax/MiniMax-M2.7`
- 发送到百炼兼容接口时会自动去掉前缀，例如 `bailian/qwen3.6-plus -> qwen3.5-plus`

### 限流约定

- 模型限流复用 Redis，共享 `redisKeys.rate(...)` 体系。
- 当前 key 维度为 `userId + organizationId + purpose`，保证“按用户 + 按组织”的服务端节流边界。
- Provider 返回 `429`、请求超时、结构错误、不可用错误，都应在 adapter 层转成稳定的服务端错误，而不是把原始 provider 报错直接抛给页面层。

### 真实百炼 Smoke Test

如需验证本地环境变量是否真的能打通百炼兼容接口，可执行：

```bash
pnpm test:smoke:bailian
```

约定：

- 该命令会显式设置 `RUN_BAILIAN_SMOKE_TEST=1`
- 测试会复用当前 LLM adapter，并对真实百炼配置执行一次健康检查与一次最小文本生成
- 默认全量回归不会执行这条测试，避免把外部 provider 波动引入日常开发反馈

## 后续扩展位

当前 `compose.yaml` 已定义 `web`、`worker`、`postgres`、`redis`、`cube`、`neo4j` 六个服务。

后续故事扩展建议：

- 若需要把 Cube 做成更完整的本地语义层环境，可继续补 refresh worker、seed 数据和更细的 model
- 若需要把 Neo4j 做成更接近试点环境，可继续补索引、APOC 策略和更完整的同步命令
- 持久化迁移仍由 Story 2.2 到 2.5 的数据库故事逐步完成

## Cube 本地语义层

### 最小模型

当前仓库内已提供最小 Cube 配置：

- `cube/conf/cube.js`
- `cube/conf/model/Finance.js`
- `cube/conf/model/ServiceOrders.js`

它们直接面向当前已存在的 `erp_staging` 表，覆盖：

- `Finance`：收缴率、应收金额、实收金额
- `ServiceOrders`：工单总量、投诉量、平均满意度、平均响应时长、平均关闭时长

### 本地 token 生成

复制 `.env.example` 为 `.env` 并设置 `CUBE_API_SECRET` 后，执行：

```bash
pnpm cube:token
```

把输出的 JWT 写回 `.env` 的 `CUBE_API_TOKEN=`。  
当前 Compose 中的 Cube 仍启用 `CUBEJS_DEV_MODE=true`，这样本地联调不会因为 token 生成步骤遗漏而完全阻塞；但为了让应用与真实请求头保持一致，仍建议显式生成并配置 token。

### 最小验证

启动 `cube` 后，可直接验证：

```bash
curl -H "Authorization: $(grep '^CUBE_API_TOKEN=' .env | cut -d= -f2-)" \
  http://127.0.0.1:4000/cubejs-api/v1/meta
```

如果只是确认服务已启动，`readyz` 也可以直接看：

```bash
curl http://127.0.0.1:4000/readyz
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

## Worker 进程

### 角色

Worker 是独立于 web 的后台进程，负责消费 Redis 任务队列中的 job 并执行。web 进程只负责投递任务，不在 Route Handler 内同步执行长任务。

### 任务契约

任务通过 `src/domain/job-contract/models.ts` 定义显式类型：

- **JobType**: 支持的任务类型（当前仅 `health-check`）
- **JobPayload**: 任务载荷，包含 `type` 和 `data`
- **JobStatus**: 状态流转 `pending → processing → completed / failed`
- **Job**: 完整任务记录，包含 id、状态、结果、错误信息和时间戳

非法 payload 通过 `validateJobPayload()` 拒绝，抛出 `InvalidJobPayloadError`。

### 队列机制

使用 Postgres durable job ledger 作为任务事实源，Redis Streams 只做唤醒/分发：

- Web 侧通过 `JobQueue.submit()` 投递任务
- Worker 通过 `JobQueue.consume()` 消费任务
- 任务元数据、状态、结果、错误、attempt 和 lease 存储在 `platform.jobs`
- Redis stream entry 只携带 `jobId`

### 本地运行

```bash
# 单独启动 worker（需要 Redis 已启动）
pnpm worker:dev

# 通过 Docker Compose 启动（包含 Redis 依赖）
docker compose up -d worker
```

### 扩展新任务类型

1. 在 `src/domain/job-contract/models.ts` 的 `JOB_TYPES` 添加新类型
2. 在 `src/worker/handlers.ts` 注册对应 handler
3. 补充测试覆盖
