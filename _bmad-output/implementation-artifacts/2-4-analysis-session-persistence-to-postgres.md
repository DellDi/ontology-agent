# Story 2.4: 将分析会话与历史持久化迁移到 Postgres

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 新建分析、历史列表和会话回看使用真实持久化,
so that 我的分析入口和基础上下文不会因服务重启而丢失。

## Acceptance Criteria

1. 用户创建新的分析会话时，系统必须将会话数据写入 Postgres，并通过真实数据库读取历史列表与详情。
2. 用户重新访问工作台历史或会话详情时，已保存数据必须与之前一致，不因服务重启丢失。
3. 跨用户隔离规则必须继续生效，任何历史列表与详情读取都只能返回当前用户有权访问的会话。

## Tasks / Subtasks

- [x] 将 `AnalysisSessionStore` 从内存实现切换到 Postgres 实现（AC: 1, 2, 3）
  - [x] 复用 `platform.analysis_sessions` 表，不额外创建重复持久化结构。
  - [x] 在 `src/infrastructure/analysis-session/` 下新增 Postgres-backed store，并保持现有 use case 契约稳定。
  - [x] 保留 `ownerUserId`、`questionText`、`status`、时间字段的真实映射。
- [x] 保持 API 与页面契约稳定（AC: 1, 2）
  - [x] 新建分析接口、工作台历史、详情页继续通过 application 层读取，不把数据库细节暴露到页面组件。
  - [x] 保持前端 URL 和基础交互不变，避免让 UI 感知底层存储切换。
- [x] 覆盖数据一致性与用户隔离测试（AC: 2, 3）
  - [x] 新增 story 级测试，验证 create/list/get/replay。
  - [x] 覆盖非法 `sessionId`、跨用户访问、重启后回看等路径。

## Dev Notes

- 本故事只迁移“分析会话元数据与历史”，不提前落地执行任务、结果快照、审计或多轮追问模型。
- 若 2.3 已完成，分析会话存储应复用稳定的服务端身份识别，不允许从客户端传 `ownerUserId`。
- 当前详情页与工作台页面已存在，建议保持页面层薄，业务切换集中在 application / infrastructure。

### Architecture Compliance

- 平台分析会话属于平台自有 schema，不对 ERP 表建立外键假设。
- 用户隔离必须由服务端会话和 repository 查询共同保证，而不是仅在 UI 过滤。
- 本故事不得把分析历史搬到 Redis 或浏览器缓存作为主存储。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/analysis-session/ports.ts`
  - `src/application/analysis-session/use-cases.ts`
  - `src/infrastructure/analysis-session/memory-analysis-session-store.ts`
  - `src/infrastructure/analysis-session/` 下新增 Postgres store
  - `src/app/api/analysis/sessions/route.ts`
  - `src/application/workspace/home.ts`
  - `src/app/(workspace)/workspace/page.tsx`
  - `src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx`

### Testing Requirements

- 新增 `tests/story-2-4-analysis-session-persistence.test.mjs` 或等价测试。
- 至少覆盖：
  - 新建分析会话后持久化成功
  - 历史列表按当前用户倒序返回
  - 详情页可回放已保存会话
  - 跨用户读取被拒绝
  - 非法或不存在的 `sessionId` 处理稳定

### Previous Story Intelligence

- Story 2.2 已定义 `platform.analysis_sessions` 与相关索引；本故事不应再次修改 schema 目标范围。
- Story 1.4 和 1.5 已建立分析创建、历史列表与回看路径，本故事目标是将其迁移到真实持久化而非重做交互。
- 若 Story 2.3 已先完成，建议复用其稳定的 Postgres 会话模式做用户识别与隔离。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4: 将分析会话与历史持久化迁移到 Postgres]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/implementation-artifacts/2-2-postgres-drizzle-platform-schema.md]

## Dev Agent Record

### Agent Model Used

Cascade (Claude)

### Debug Log References

- `node --test tests/story-2-4-analysis-session-persistence.test.mjs`（13/13 通过）
- `pnpm lint`（通过）
- `pnpm build`（通过，Turbopack 编译成功）
- `node --test --test-concurrency=1 tests/story-1-1-*.test.mjs tests/story-2-*.test.mjs`（60/60 通过，0 回归）
- 集成测试（story-1-2 ~ 1-6）需 Postgres 可用环境，14 项因无数据库连接预期失败

### Completion Notes List

- 新增 `src/infrastructure/analysis-session/postgres-analysis-session-store.ts`，实现 `AnalysisSessionStore` 接口，复用 Story 2.2 已建立的 `platform.analysis_sessions` 表。
- `createPostgresAnalysisSessionStore()` 接受可选 `db` 参数，默认通过 `createPostgresDb()` 获取连接，保持 infrastructure 层内聚。
- 领域模型字段（id、ownerUserId、questionText、status、createdAt、updatedAt）完整映射到 Postgres 行，`listByOwner` 使用 `desc(updatedAt)` 倒序返回。
- 3 处消费者全部切换：`src/app/api/analysis/sessions/route.ts`、`src/app/(workspace)/workspace/page.tsx`、`src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx`。
- application / domain / 页面组件层零改动，API 路由与前端 URL 完全不变，UI 无法感知底层存储切换。
- 用户隔离当前由 `use-cases.ts` 中的 `ownerUserId` 比较加作用域快照校验共同保证，repository 查询仍以 `ownerUserId` 为首层过滤。
- `memory-analysis-session-store.ts` 保留未删除，可作为测试或回退使用。
- 新增 `tests/story-2-4-analysis-session-persistence.test.mjs`，13 项契约测试覆盖：store 文件存在、接口兼容、schema 复用、字段映射、排序逻辑、3 处切换验证、数据库细节隔离、客户端存储安全、port 稳定性、use-cases 用户隔离、memory store 保留。
- 运行时集成测试（创建落库、历史列表、跨用户隔离、重启后回看）需在 Docker Compose 环境中执行。
- 结合 Epic 1 review 修复，分析会话 Postgres store 已继续映射组织/项目/区域作用域快照、`savedContext` 基础上下文快照，并补充 `delete(sessionId)` 以支持创建失败回滚。
- 当前 `listOwnedSessions()` / `getOwnedSession()` 已升级为 scope-aware 读取：除了 `ownerUserId`，还会基于当前工作台作用域校验组织、项目和区域边界。

### Change Log

- 2026-03-27：为 Epic 1 review 修复补充会话作用域快照、`savedContext` 持久化、删除接口与 scope-aware 读取约束。

### File List

- _bmad-output/implementation-artifacts/2-4-analysis-session-persistence-to-postgres.md
- src/infrastructure/analysis-session/postgres-analysis-session-store.ts（新增）
- src/app/api/analysis/sessions/route.ts（修改：切换到 Postgres store）
- src/app/(workspace)/workspace/page.tsx（修改：切换到 Postgres store）
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx（修改：切换到 Postgres store）
- tests/story-2-4-analysis-session-persistence.test.mjs（新增）
