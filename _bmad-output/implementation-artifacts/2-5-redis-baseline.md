# Story 2.5: 接入 Redis 并建立基础约定

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 建立 Redis 连接和基础 key/namespace 约定,
so that 后续限流、任务元数据、流式状态和后台执行能够复用统一缓存层。

## Acceptance Criteria

1. 项目必须具备明确的 Redis 连接配置、健康检查和基础读写能力。
2. Redis key namespace 必须稳定且可复用，避免与未来任务、状态、限流和会话用途冲突。
3. 后续故事能够复用统一 Redis 客户端与约定，而不是散落零散连接逻辑。

## Tasks / Subtasks

- [x] 建立统一 Redis 客户端与配置入口（AC: 1, 3）
  - [x] 在 `src/infrastructure/redis/` 下集中放置客户端工厂、配置读取和健康检查逻辑。
  - [x] 明确 `REDIS_URL` 与运行时失败策略；连接失败不能静默假成功。
  - [x] 不将受保护会话主存储切回 Redis。
- [x] 建立基础 namespace 约定（AC: 2, 3）
  - [x] 至少定义应用前缀与后续 worker / stream / rate-limit 可复用的 key builder。
  - [x] 保证本地、测试和未来环境可通过前缀隔离。
- [x] 补充文档与验证（AC: 1, 2, 3）
  - [x] 更新 Compose / `.env.example` / 文档，写清宿主机与容器内地址差异。
  - [x] 新增契约测试，验证配置入口、namespace 约定与最小健康检查。

## Dev Notes

- 本故事是 Redis 基线故事，不是缓存策略故事，也不是会话迁移故事。
- 重点是把连接、命名空间和复用边界一次定清楚，为 Story 2.6 的 worker skeleton 和 Epic 4 的执行流打底。
- 当前仓库已经有 Compose 中的 Redis 服务，本故事应复用现有基础设施，不再重复搭拓扑。

### Architecture Compliance

- Redis 只能作为共享缓存 / 协调层，不能突破“浏览器不可直连基础设施”的边界。
- 客户端应由服务端模块统一管理，避免 route 或页面各自建立连接。
- namespace 设计需要为后续任务状态和 SSE 事件预留清晰边界。

### File Structure Requirements

- 重点文件预计包括：
  - `src/infrastructure/redis/` 下新增客户端与 key 约定模块
  - `compose.yaml`
  - `.env.example`
  - `docs/local-infrastructure.md`
  - `tests/story-2-5-redis-baseline.test.mjs`

### Testing Requirements

- 至少覆盖：
  - 存在统一 Redis 客户端入口
  - 存在稳定 key namespace builder
  - 环境变量和健康检查约定明确
  - 如环境允许，可执行一次真实 `ping` / `set` / `get` 冒烟验证

### Previous Story Intelligence

- Story 2.1 已将 Redis 服务加入 Compose，并完成本地启动验证。
- Story 2.2 已建立 Postgres / Drizzle 基线；Redis 需要沿用相同的环境配置纪律，但不与数据库职责混淆。
- Story 2.6 预计直接依赖本故事的统一 Redis 客户端与 namespace。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5: 接入 Redis 并建立基础约定]
- [Source: _bmad-output/planning-artifacts/architecture.md#基础设施与部署]
- [Source: _bmad-output/project-context.md#技术栈与版本]
- [Source: _bmad-output/implementation-artifacts/2-1-docker-compose-baseline.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- 无阻塞问题。

### Completion Notes List

- 使用官方 `redis` (node-redis) v5.11.0，遵循 postgres/client.ts 工厂模式
- Key namespace 采用 `oa:` 前缀，4 个命名空间 (rate/worker/stream/cache)
- 支持 `REDIS_KEY_PREFIX` 环境变量实现环境隔离
- 健康检查通过 PING 命令返回 `{ ok, latencyMs }`
- 13 项契约测试全部通过，57 项 Story 2.x 测试零回归
- 2026-03-30 根据 Epic 2 code review 修复，worker 队列 list key 已不再硬编码 `oa:job:queue`，而是统一通过 `redisKeys.jobQueue()` 生成，保证 `REDIS_KEY_PREFIX` 对队列本体和任务载荷使用同一命名空间契约。

### File List

- src/infrastructure/redis/client.ts (新建)
- src/infrastructure/redis/keys.ts (新建)
- src/infrastructure/redis/health.ts (新建)
- src/infrastructure/redis/index.ts (新建)
- tests/story-2-5-redis-baseline.test.mjs (新建)
- docs/local-infrastructure.md (修改 — 补充 Redis 客户端与 key namespace 约定章节)
- package.json (修改 — 添加 redis 依赖)
- _bmad-output/implementation-artifacts/2-5-redis-baseline.md (修改)

### Change Log

- 2026-03-30：修复 worker queue list key 未复用共享 Redis namespace builder 的问题。
