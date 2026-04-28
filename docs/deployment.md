# 自托管容器部署指南

## 组件边界

| 服务 | 镜像来源 | 用途 |
|---|---|---|
| `web` | `Dockerfile`（multi-stage） | Next.js Web 工作台，`next start` 生产模式 |
| `worker` | `Dockerfile.worker` | 异步任务执行 worker |
| `migrate` | `Dockerfile.worker`（一次性） | 数据库迁移，完成后退出 |
| `postgres` | `postgres:18.2-bookworm` | 主数据库 |
| `redis` | `redis:8.2.5-bookworm` | 会话存储 + 任务队列 |
| `cube` | `cubejs/cube:v1.6.31` | 指标查询引擎 |
| `neo4j` | `neo4j:5.26.24-community-ubi9` | 组织图数据库 |

## 快速部署

### 1. 准备环境变量

```bash
cp .env.prod.example .env.prod
# 编辑 .env.prod，填写所有 replace-with-* 占位符
```

**关键配置说明：**
- `DATABASE_URL` / `REDIS_URL`：**不要填宿主机地址**，容器内部通过服务名互通（`postgres:5432`、`redis:6379`）
- `SESSION_SECRET`：必须使用强随机值，不得与开发环境共用
- `ENABLE_DEV_ERP_AUTH`：生产环境固定为 `0`，`compose.prod.yaml` 已硬编码
- `ERP_API_BASE_URL`：必须填写真实 ERP 加密接口地址

### 2. 构建并启动

```bash
docker compose -f compose.prod.yaml --env-file .env.prod up -d --build
```

### 3. 验证配置正确性（不启动容器）

```bash
docker compose -f compose.prod.yaml --env-file .env.prod config --quiet
```

### 4. 查看服务状态

```bash
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml logs web --tail=50
```

## 开发环境

开发环境使用 `compose.yaml` + `Dockerfile.dev`，挂载源码、运行热更新：

```bash
cp .env.example .env
# 编辑 .env，设置 ENABLE_DEV_ERP_AUTH=1（本地联调）
docker compose up -d
```

## 关键差异：开发 vs 生产

| 项目 | 开发（`compose.yaml`） | 生产（`compose.prod.yaml`） |
|---|---|---|
| 源码挂载 | 是（实时热更新） | 否（镜像内已编译） |
| Next.js 模式 | `next dev` | `next start`（standalone） |
| `ENABLE_DEV_ERP_AUTH` | `1`（可手填 scope） | `0`（强制 ERP 目录认证） |
| Cube.js 开发模式 | `CUBEJS_DEV_MODE=true` | `CUBEJS_DEV_MODE=false` |
| 端口对外暴露 | 宿主机 `127.0.0.1:PORT` | 宿主机 `127.0.0.1:PORT` |
| `restart` 策略 | 无（默认） | `unless-stopped` |

## Kubernetes 演进路径

当前 compose.prod.yaml 的边界设计与 K8s Deployment 对齐：
- `web` → Deployment（可横向扩展）
- `worker` → Deployment（可横向扩展）
- `migrate` → Job（`restartPolicy: OnFailure`）
- `postgres` / `redis` → StatefulSet 或外部托管服务
- `cube` / `neo4j` → StatefulSet 或外部托管服务

迁移时，环境变量名称保持不变，改为 ConfigMap + Secret 注入即可。

## 健康检查

当前已为 `web`、`postgres`、`redis`、`cube`、`neo4j` 配置 `healthcheck`。
`worker` 暂未单独配置 `healthcheck`，当前依赖进程退出与 `restart: unless-stopped` 暴露故障；
`web` 服务等待 `migrate` 完成后才启动（`service_completed_successfully`）。

检查健康状态：
```bash
docker inspect ontology-agent-prod-web-1 --format='{{.State.Health.Status}}'
```

## Redis 队列持久性

Worker job queue 使用 Redis Streams consumer group，具备 at-least-once 分发、pending job 重投递和 dead-letter queue 语义。

生产部署要求：

- Redis 必须启用持久化能力，优先使用 AOF 或托管 Redis 的等价持久化配置。
- 仅依赖默认 RDB snapshot 会在 Redis 崩溃时产生窗口期丢失风险，不应作为生产级 job durability 的最终保障。
- worker 横向扩展时必须共享同一个 `REDIS_URL` 和 `REDIS_KEY_PREFIX`，consumer name 由进程自动生成。
- DLQ key 为 `{REDIS_KEY_PREFIX}:job:queue:dlq`，运维排障时应同时查看 job data：`{REDIS_KEY_PREFIX}:worker:{jobId}:data`。

发布前可在目标 Redis 上执行：

```bash
pnpm test:real:redis-queue
```

该测试验证未 ack job 的重投递、完成后的 `XACK`、超过重试上限后的 DLQ 写入。它只清理测试专用前缀下的 key。
