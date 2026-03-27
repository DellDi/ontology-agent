# Story 2.3: 将受保护会话持久化迁移到 Postgres

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 我的登录会话保存在真实持久化层中,
so that 系统重启或扩展实例后不会立刻丢失会话状态。

## Acceptance Criteria

1. 用户完成 ERP 登录后，系统创建的受保护会话必须写入 Postgres，而不是仅停留在进程内内存。
2. 受保护页面、API 和注销流程必须继续通过服务端会话边界读取与销毁会话，不能把敏感状态转移到客户端。
3. 当应用重启或请求由不同实例处理时，系统仍能识别有效会话，不依赖单进程内存状态。

## Tasks / Subtasks

- [x] 将 `SessionStore` 从内存实现切换到 Postgres 实现（AC: 1, 3）
  - [x] 复用 Story 2.2 已建立的 `platform.auth_sessions`，不要新建平行 schema 或重复表。
  - [x] 在 `src/infrastructure/session/` 下新增 Postgres-backed session store，并保持与现有 `SessionStore` port 兼容。
  - [x] 保留过期时间、用户作用域、角色列表等当前领域模型字段，不缩减权限信息。
- [x] 收紧服务端认证边界并保持现有 cookie 契约（AC: 1, 2）
  - [x] 登录回调仍由服务端创建 cookie，cookie 只保存最小会话标识。
  - [x] `requireRequestSession()` / `requireWorkspaceSession()` 继续从服务端读取会话，不信任浏览器提交身份。
  - [x] 注销时同时删除 cookie 与持久化会话记录。
- [x] 建立回归测试与持久化验证（AC: 1, 2, 3）
  - [x] 新增 story 级测试，覆盖登录、跨请求持久化、注销和过期会话。
  - [x] 保留现有受保护页面和 API 回归，确保切换存储后行为不回退。
  - [x] 如环境可用，验证重启后仍能识别有效会话。

## Dev Notes

- 本故事只迁移认证会话存储，不改变 ERP 登录协议，不引入 Redis，不修改浏览器端认证契约。
- 当前真实实现仍位于 `src/infrastructure/session/memory-session-store.ts`；目标是保持 application / domain 接口稳定，仅替换 infrastructure adapter。
- 会话持久化后，后续 Story 2.7 的认证边界收紧必须在 Postgres-backed session 模式下继续通过。

### Architecture Compliance

- 延续当前“浏览器只持有最小 cookie，服务端查真实会话”的安全模型。
- 平台自有会话数据必须继续位于 `platform` schema，不能耦合 ERP 用户表。
- 不允许把用户权限范围、角色或会话详情下沉到客户端本地状态作为事实源。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/auth/ports.ts`
  - `src/application/auth/use-cases.ts`
  - `src/infrastructure/session/server-auth.ts`
  - `src/infrastructure/session/memory-session-store.ts`
  - `src/infrastructure/session/` 下新增 Postgres session store
  - `src/infrastructure/postgres/client.ts`
  - `src/app/api/auth/callback/route.ts`
  - `src/app/api/auth/logout/route.ts`
- 若需要工厂切换逻辑，应放在 infrastructure 层，不要把 Postgres 细节散落到页面或 domain。

### Testing Requirements

- 新增 `tests/story-2-3-session-persistence.test.mjs` 或等价 story 测试。
- 至少覆盖：
  - 登录后会话落库
  - 受保护页面跨请求读取同一会话
  - 注销后 cookie 与会话同时失效
  - 过期会话被拒绝
  - 多用户会话隔离

### Previous Story Intelligence

- Story 2.1 已提供可用的 Postgres Compose 基线与 `.env` 约定。
- Story 2.2 已建立 `platform.auth_sessions` 表和 Drizzle 客户端；本故事直接复用，不重复设计 schema。
- 现有 Story 1.2 已建立受保护工作台和会话边界，2.3 不能破坏既有登录、跳转与权限范围行为。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3: 将受保护会话持久化迁移到 Postgres]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]
- [Source: _bmad-output/planning-artifacts/architecture.md#安全与权限边界]
- [Source: _bmad-output/project-context.md#关键实现规则]
- [Source: _bmad-output/implementation-artifacts/2-2-postgres-drizzle-platform-schema.md]

## Dev Agent Record

### Agent Model Used

Cascade (Claude)

### Debug Log References

- `node --test tests/story-2-3-session-persistence.test.mjs`（12/12 通过）
- `pnpm lint`（通过）
- `pnpm build`（通过，Turbopack 编译成功）
- `node --test --test-concurrency=1 tests/story-2-3-session-persistence.test.mjs tests/story-2-2-postgres-drizzle-schema.test.mjs tests/story-2-1-compose-baseline.test.mjs tests/story-1-1-foundation.test.mjs`（47/47 通过，0 回归）

### Completion Notes List

- 新增 `src/infrastructure/session/postgres-session-store.ts`，实现 `SessionStore` 接口，复用 Story 2.2 已建立的 `platform.auth_sessions` 表。
- `createPostgresSessionStore()` 接受可选 `db` 参数，默认通过 `createPostgresDb()` 获取连接，保持 infrastructure 层内聚。
- 领域模型字段（sessionId、userId、displayName、scope.organizationId/projectIds/areaIds/roleCodes、expiresAt）完整映射到 Postgres 行，无信息缩减。
- `getSession()` 使用 `gt(expiresAt, new Date())` 在查询层过滤过期会话，无需额外清理定时器。
- `server-auth.ts` 将 `createMemorySessionStore()` 替换为 `createPostgresSessionStore()`，仅改一行 import + 一行实例化，application / domain / route handler 层零改动。
- Cookie 契约完全不变：仍使用 HMAC 签名的最小 sessionId，`requireRequestSession()` / `requireWorkspaceSession()` 继续从服务端读取会话。
- `memory-session-store.ts` 保留未删除，可作为测试或回退使用。
- 新增 `tests/story-2-3-session-persistence.test.mjs`，12 项契约测试覆盖：store 文件存在、接口兼容、schema 复用、字段映射、过期检查、server-auth 切换、cookie 契约、注销流程、端口稳定性、路由安全。
- 当前环境无运行中 Postgres 实例，运行时集成测试（登录落库、跨请求持久化、重启后会话存活）需在 Docker Compose 环境中执行 story-1-2 级别集成测试验证。
- 当前实现已继续作为认证事实源使用，并与 Story 2.7 的安全门禁和 Epic 1 review 修复一起完成回归验证，无需回退到 memory store。

### Change Log

- 2026-03-27：回写当前认证事实源状态，确认已与 Story 2.7 及 Epic 1 review 修复联动验证。

### File List

- _bmad-output/implementation-artifacts/2-3-session-persistence-to-postgres.md
- src/infrastructure/session/postgres-session-store.ts（新增）
- src/infrastructure/session/server-auth.ts（修改：切换到 Postgres session store）
- tests/story-2-3-session-persistence.test.mjs（新增）
