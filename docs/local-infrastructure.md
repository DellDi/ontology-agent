# 本地基础设施基线

## 目标

Story 2.1 为本项目提供统一的本地基础设施入口，通过一个 Compose 配置启动 `web`、`postgres`、`redis` 三个服务，方便后续故事逐步接入持久化和后台执行能力。

当前阶段仍然只有应用容器和基础服务基线：

- `web` 继续运行现有 Next.js App Router 工程
- `postgres` 只提供数据库服务，不提前引入 Drizzle schema 或迁移
- `redis` 只提供本地开发端口，不引入密码、ACL 或公网暴露
- `worker` 独立进程消费 Redis 任务队列，与 web 进程职责分离

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

## 常用命令

生成最终配置：

```bash
docker compose config
```

后台启动全部服务：

```bash
docker compose up -d
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

Postgres 与 Redis 的端口默认只绑定到本机回环地址，避免在本地开发态被无意暴露到局域网。
如果宿主机已经有本地 Postgres 占用 `5432`，建议像当前样例一样把 Compose 暴露端口改到其他可用值，例如 `55432`，同时同步更新 `.env` 中的 `DATABASE_URL`。

## 运行约定

- `web` 容器基于 Node.js 24 的 Debian 镜像
- 容器内通过 `corepack` 启用 `pnpm`
- 仓库源码通过 bind mount 挂载到 `/workspace`
- `node_modules` 与 `pnpm` store 使用独立命名卷，避免污染宿主依赖目录
- `web` 会在 `postgres` 与 `redis` 健康检查通过后再启动
- Postgres 18 官方镜像建议把命名卷挂到 `/var/lib/postgresql`，避免沿用旧数据目录布局时触发启动失败

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

### Key Namespace 约定

所有 Redis key 使用统一前缀 `oa:` (ontology-agent 缩写)，通过 `redisKeys` builder 生成：

| 命名空间 | 格式 | 用途 |
|----------|------|------|
| `rate` | `oa:rate:{userId}:{resource}` | 按用户限流 |
| `worker` | `oa:worker:{jobId}:{field}` | Worker 任务元数据 |
| `stream` | `oa:stream:{sessionId}` | 流式状态 / SSE 事件 |
| `cache` | `oa:cache:{scope}:{key}` | 短时缓存 |

环境隔离：可通过 `REDIS_KEY_PREFIX` 环境变量覆盖默认前缀，用于测试环境隔离。

```typescript
import { redisKeys } from '@/infrastructure/redis';

redisKeys.rate('user-123', 'analysis');    // → "oa:rate:user-123:analysis"
redisKeys.worker('job-456', 'status');     // → "oa:worker:job-456:status"
```

### 健康检查

```typescript
import { checkRedisHealth } from '@/infrastructure/redis';

const result = await checkRedisHealth(redis);
// → { ok: true, latencyMs: 2 }
```

## 后续扩展位

当前 `compose.yaml` 已定义 `web`、`worker`、`postgres`、`redis` 四个服务。

后续故事扩展建议：

- `neo4j` / `cube`：保持延后，不在本阶段提前引入
- 持久化迁移：由后续 Story 2.2 到 2.5 逐步完成

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

使用 Redis List（LPUSH/RPOP）作为简单可靠的任务队列：

- Web 侧通过 `JobQueue.submit()` 投递任务
- Worker 通过 `JobQueue.consume()` 消费任务
- 任务元数据存储在 `oa:worker:{jobId}:data` key 中

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
