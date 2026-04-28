# Story 2.6: 建立 Worker Skeleton 与最小任务契约

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 建立独立 worker 进程和最小任务契约,
so that 后续分析执行能力可以在不阻塞 web 进程的前提下逐步演进。

## Acceptance Criteria

1. 项目中必须存在独立 worker 入口和最小任务处理骨架，与 web 进程职责分离。
2. web 与 worker 之间必须具备清晰的最小任务契约，而不是依赖隐式字符串或散落的 payload 约定。
3. 当前交付只需支持最小任务类型或健康检查任务，不提前实现完整归因执行流程。

## Tasks / Subtasks

- [x] 建立 worker 入口与启动方式（AC: 1, 3）
  - [x] 在 `src/worker/` 或等价目录建立独立入口。
  - [x] 在 `package.json` 增加 worker 启动脚本，并在 Compose 中表达独立进程边界。
  - [x] worker 至少能处理一个最小任务类型或自检任务。
- [x] 定义最小任务契约（AC: 2, 3）
  - [x] 为 job payload、状态流转、失败语义建立显式类型或 schema。
  - [x] web 侧只负责投递任务，不在 Route Handler 内同步执行长任务。
  - [x] 为未来版本扩展预留字段，但不要过早实现完整执行编排。
- [x] 补充测试与文档（AC: 1, 2, 3）
  - [x] 新增契约测试，覆盖 payload 校验、最小消费流程和错误处理。
  - [x] 新增真实 Redis 回归测试，覆盖未 ack job 重投递、完成后 XACK、超过重试上限进入 DLQ。
  - [x] 更新文档，说明 worker 角色、运行方式和与 Redis 的依赖关系。

## Dev Notes

- 本故事是“骨架 + contract”故事，不是分析执行故事；真正的执行提交和 SSE 流式反馈属于 Epic 4。
- worker 与 web 的边界要从一开始就清晰，避免在 web 进程里伪装异步。
- 如果 2.5 已完成，优先复用统一 Redis client 与 namespace；若尚未完成，也应至少抽出协调层 port，避免后续推翻。

### Architecture Compliance

- 符合架构中的“submit -> queue -> stream”方向，但本故事只做到 queue / worker 骨架。
- 任务契约必须位于服务端模块内，浏览器不能直接感知或操作底层任务协议。
- 不应在这一故事中把结果持久化、审计、SSE 和多步计划执行一次性塞进 worker。

### File Structure Requirements

- 重点文件预计包括：
  - `src/worker/` 下新增入口与最小处理器
  - `src/application/` 或 `src/domain/` 下新增 job contract 模块
  - `compose.yaml`
  - `package.json`
  - `tests/story-2-6-worker-skeleton.test.mjs`
  - 视需要新增 `docs/worker-baseline.md`

### Testing Requirements

- 至少覆盖：
  - worker 启动入口存在
  - 最小 job payload 校验通过 / 非法 payload 被拒绝
  - web 侧能投递最小任务
  - worker 能消费最小任务或完成健康检查

### Previous Story Intelligence

- Story 2.1 提供了 Compose 基线；worker 应在现有容器边界之上演进，不重做基础设施。
- Story 2.5 预计提供 Redis client 与 key namespace，是本故事的直接前置。
- Epic 4 的执行、SSE 和结果保存都依赖这里定义的最小任务边界是否稳定。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.6: 建立 Worker Skeleton 与最小任务契约]
- [Source: _bmad-output/planning-artifacts/architecture.md#基础设施与部署]
- [Source: _bmad-output/planning-artifacts/architecture.md#应用通信与执行模型]
- [Source: _bmad-output/project-context.md#关键实现规则]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- 9 个测试全部通过（入口文件、契约模型、Redis 队列 submit/consume/fail、空队列、非法 payload、compose/package 配置）
- ESLint 零错误
- TypeScript 编译零错误

### Completion Notes List

- 建立了完整的 job contract 领域模型：JobType、JobStatus、JobPayload、Job、validateJobPayload
- 当前支持 health-check 任务类型，状态流转 pending/queued → processing → completed/failed/dead_letter
- Application 层定义 JobQueue port 和 use-cases（submit/consume/complete/fail/get）
- Infrastructure 层已新增 Postgres-backed JobQueue：Postgres `platform.jobs` 是任务事实源，Redis Streams 只保存 `jobId` 唤醒信号
- Worker 独立入口 src/worker/main.ts，轮询 Redis 队列消费任务
- Handler 注册机制 src/worker/handlers.ts，health-check handler 执行 Redis 健康检查
- compose.yaml 新增 worker 服务，依赖 Redis healthy
- package.json 新增 worker:dev 脚本（tsx 运行 TS 入口）
- 更新 docs/local-infrastructure.md 说明 worker 角色和扩展方式
- 2026-03-30 根据 Epic 2 code review 修复，Redis 队列本体的 list key 已改为复用共享 key builder，与任务记录 key 一样遵守 `REDIS_KEY_PREFIX` 隔离策略，避免多环境共用同一队列名。
- 2026-04-28 根据全仓风险审查修复，Redis 队列由 `LPUSH/RPOP` 升级为 Redis Streams consumer group：
  - `XREADGROUP` 消费新任务，任务进入 pending list
  - worker 崩溃或未 ack 时，其他 consumer 通过 `XAUTOCLAIM` 在 visibility timeout 后重投递
  - `completeJob` / `failJob` 更新 job data 后执行 `XACK`
  - 超过重试上限时写入 `jobDeadLetterQueue`
  - 新增 `tests/story-2-6-redis-job-queue-real.test.mjs` 真实 Redis 回归，使用唯一 `REDIS_KEY_PREFIX` 隔离测试数据
- 2026-04-28 后续加固：job canonical ledger 迁移到 Postgres：
  - 新增 `platform.jobs`、`platform.job_events`、`platform.job_dispatch_outbox`
  - `createPostgresBackedJobQueue` 保持 application `JobQueue` port 稳定，内部组合 Postgres ledger 与 Redis dispatcher
  - Redis stream message 只携带 `jobId`，不再写入 `oa:worker:{jobId}:data` 作为新任务事实源
  - terminal duplicate signal 会被 ack 并忽略，避免重复执行 handler
  - 新增 Story 2.8 真实 Postgres / Redis 回归测试

### File List

- src/domain/job-contract/models.ts（新增：任务契约领域模型）
- src/application/job/ports.ts（新增：JobQueue 端口接口）
- src/application/job/use-cases.ts（新增：任务用例）
- src/infrastructure/job/redis-job-queue.ts（保留：历史 Redis Streams 队列适配器）
- src/infrastructure/job/postgres-job-ledger.ts（新增：Postgres job ledger）
- src/infrastructure/job/redis-job-dispatcher.ts（新增：Redis jobId signal dispatcher）
- src/infrastructure/job/postgres-backed-job-queue.ts（新增：Postgres-backed JobQueue adapter）
- src/infrastructure/postgres/schema/job-ledger.ts（新增：job ledger schema）
- src/worker/main.ts（新增：Worker 主入口）
- src/worker/handlers.ts（新增：任务处理器注册）
- compose.yaml（修改：新增 worker 服务）
- package.json（修改：新增 worker:dev 脚本、tsx 依赖）
- docs/local-infrastructure.md（修改：新增 Worker 进程文档）
- tests/story-2-6-worker-skeleton.test.mjs（新增：契约测试）
- tests/story-2-6-redis-job-queue-real.test.mjs（新增：真实 Redis at-least-once / DLQ 回归测试）
- tests/story-2-8-postgres-backed-job-ledger.test.mjs（新增：真实 Postgres ledger 回归测试）
- tests/story-2-8-postgres-redis-job-dispatch.test.mjs（新增：真实 Postgres + Redis 分发回归测试）

### Change Log

- 2026-03-26: Story 2.6 实现完成 — Worker 骨架 + 最小任务契约 + Redis 队列 + 9 个测试
- 2026-03-30: 修复 worker queue list key 未接入统一 Redis namespace 契约的问题
- 2026-04-28: Redis job queue 升级为 Streams consumer group，并补真实 Redis 重投递 / DLQ 回归与运行文档
- 2026-04-28: job canonical ledger 迁移到 Postgres，Redis 降级为 `jobId` 唤醒/分发信号
