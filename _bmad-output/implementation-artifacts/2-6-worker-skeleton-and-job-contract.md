# Story 2.6: 建立 Worker Skeleton 与最小任务契约

Status: review

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
- 当前支持 health-check 任务类型，状态流转 pending → processing → completed/failed
- Application 层定义 JobQueue port 和 use-cases（submit/consume/complete/fail/get）
- Infrastructure 层实现 Redis-backed JobQueue（LPUSH/RPOP 队列 + key-value 存储）
- Worker 独立入口 src/worker/main.ts，轮询 Redis 队列消费任务
- Handler 注册机制 src/worker/handlers.ts，health-check handler 执行 Redis 健康检查
- compose.yaml 新增 worker 服务，依赖 Redis healthy
- package.json 新增 worker:dev 脚本（tsx 运行 TS 入口）
- 更新 docs/local-infrastructure.md 说明 worker 角色和扩展方式

### File List

- src/domain/job-contract/models.ts（新增：任务契约领域模型）
- src/application/job/ports.ts（新增：JobQueue 端口接口）
- src/application/job/use-cases.ts（新增：任务用例）
- src/infrastructure/job/redis-job-queue.ts（新增：Redis 队列适配器）
- src/worker/main.ts（新增：Worker 主入口）
- src/worker/handlers.ts（新增：任务处理器注册）
- compose.yaml（修改：新增 worker 服务）
- package.json（修改：新增 worker:dev 脚本、tsx 依赖）
- docs/local-infrastructure.md（修改：新增 Worker 进程文档）
- tests/story-2-6-worker-skeleton.test.mjs（新增：9 个契约测试）

### Change Log

- 2026-03-26: Story 2.6 实现完成 — Worker 骨架 + 最小任务契约 + Redis 队列 + 9 个测试
