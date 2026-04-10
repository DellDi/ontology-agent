# Story 2.2: 初始化 Postgres 与 Drizzle 平台 schema

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 建立平台自有 Postgres schema 与 Drizzle 迁移机制,
so that 受保护会话、分析会话和后续结果留存可以脱离内存实现。

## Acceptance Criteria

1. 项目具备可执行的数据库连接配置与迁移命令，能够围绕现有 `DATABASE_URL` 建立平台数据库访问基线。
2. 平台自有 schema 与外部 ERP 数据边界清晰分离，初始迁移后至少存在后续会话持久化所需的最小表结构。
3. 本故事只建立最小 schema 与迁移能力，不提前创建超出当前故事范围的大量未来表，也不提前把现有内存 store 切换到数据库实现。

## Tasks / Subtasks

- [x] 建立 Drizzle / Postgres 依赖与命令基线（AC: 1）
  - [x] 在 `package.json` 中新增 `drizzle-orm`、`pg` 运行时依赖，以及 `drizzle-kit` 开发依赖；版本需固定到当前官方稳定发布而不是宽泛范围。
  - [x] 在仓库根目录新增 `drizzle.config.ts`，使用当前 `DATABASE_URL` 作为连接来源，并将 migration 输出目录固定为稳定路径，例如 `drizzle/`。
  - [x] 在 `package.json` 中补充至少 `db:generate`、`db:migrate` 两个命令；可按需增加 `db:studio`，但不要引入与故事无关的数据库工具链。
  - [x] 优先复用 `next` 已包含的 `@next/env` 加载 `.env`，不要额外引入 `dotenv` 只为读取 Drizzle 配置。

- [x] 建立平台自有 Postgres schema 与数据库客户端入口（AC: 1, 2）
  - [x] 在 `src/infrastructure` 下新增独立的 Postgres 基础设施目录，例如 `src/infrastructure/postgres/`，集中放置数据库客户端、schema 定义与后续 repository 入口。
  - [x] 使用 `drizzle-orm/node-postgres` 与 `pg` 建立最小数据库客户端工厂，保留后续在 Route Handler / repository 中复用的单一入口。
  - [x] 通过 Drizzle 的 PostgreSQL schema 能力建立独立平台 schema（例如 `platform`），明确其与 ERP 拥有表的边界。
  - [x] 本故事不接入具体业务 repository，不替换当前 `createMemorySessionStore()` 或 `createMemoryAnalysisSessionStore()`。

- [x] 建立后续会话持久化所需的最小表结构（AC: 2, 3）
  - [x] 为受保护会话建立最小表，字段需覆盖当前 `AuthSession` / `PermissionScope` 的真实持久化需要：`sessionId`、`userId`、`displayName`、`organizationId`、`projectIds`、`areaIds`、`roleCodes`、`expiresAt`。
  - [x] 为分析会话建立最小表，字段需覆盖当前 `AnalysisSession` 的真实持久化需要：`id`、`ownerUserId`、`questionText`、`status`、`createdAt`、`updatedAt`。
  - [x] 只补充当前故事确实需要的主键、必要索引和时间字段；不要提前加入结果快照、审计、任务、反馈、图谱或语义层相关表。
  - [x] 不要对 ERP schema 建外键，不要假设本项目掌控 ERP 用户表；跨系统身份字段保持字符串边界即可。

- [x] 生成迁移并补充最小验证（AC: 1, 2, 3）
  - [x] 通过 `pnpm db:generate` 生成首个 Drizzle migration，使 schema 变更可追踪、可复放，而不是只依赖 `push`。
  - [x] 新增 `tests/story-2-2-postgres-drizzle-schema.test.mjs`，验证依赖、脚本、`drizzle.config.ts`、平台 schema 定义和最小表结构契约。
  - [x] 如当前环境能访问 Postgres，运行 `pnpm db:migrate` 并检查数据库对象，确认只创建本故事约定的最小 platform schema / tables。
  - [x] 运行 `pnpm lint`、`pnpm build` 与 `node --test --test-concurrency=1 tests/*.test.mjs`，确保基础设施接线未破坏现有行为。

## Dev Notes

- Story 2.2 是 Epic 2 的“数据库基线故事”，不是“把业务切到数据库”的故事。目标是建立 schema、迁移和数据库入口，为 Story 2.3 / 2.4 的真实持久化迁移做准备。
- 现有真实代码状态仍然是：
  - 登录会话通过 `src/infrastructure/session/memory-session-store.ts` 存在进程内
  - 分析会话通过 `src/infrastructure/analysis-session/memory-analysis-session-store.ts` 存在进程内
  - `AuthSession` 与 `AnalysisSession` 的真实字段定义分别在 `src/domain/auth/models.ts` 与 `src/domain/analysis-session/models.ts`
- 本故事必须为 Story 2.3 / 2.4 提供稳定数据库基础，但不能提前做完这些故事：
  - 不把 `SessionStore` 切换到 Postgres
  - 不把 `AnalysisSessionStore` 切换到 Postgres
  - 不引入 Redis 客户端
  - 不创建 worker、任务队列或执行记录表
  - 不创建 Neo4j、Cube 或 ERP 影子表

### Technical Requirements

- 继续复用 Story 2.1 已建立的 `DATABASE_URL` 约定，不要再平行引入第二套主数据库连接变量，除非实现中有明确且必要的迁移连接拆分理由。
- `drizzle.config.ts` 放在仓库根目录，便于 `drizzle-kit` 与 CI 统一发现。
- 迁移输出目录使用稳定、可提交路径，例如 `drizzle/`；不要把生成物写进 `src/` 或临时目录。
- 优先使用 `@next/env` 的 `loadEnvConfig()` 读取 `.env`，避免为了 Drizzle CLI 再引入 `dotenv`。
- 若需要表命名，请优先保持与现有领域模型一一对应且可读，例如 `auth_sessions`、`analysis_sessions`；不要使用过度缩写或未来导向命名。
- 当前 `AnalysisSessionStatus` 只有 `pending`，本故事不需要为了单值状态提前引入复杂 PostgreSQL enum 迁移；简单、稳定、可扩展优先。

### Architecture Compliance

- 架构文档已明确：平台自有数据必须位于独立 Postgres schema，ERP schema 视为外部契约，而不是由本项目掌控的内部结构。
- 架构实施顺序中，Story 2.2 紧接在 `Docker Compose + Postgres + Redis` 基线之后，属于“真实持久化前的数据库准备层”。
- 浏览器仍不得直连 Postgres；本故事只建立服务端数据库入口和迁移能力。
- `REST + SSE`、模块化单体和当前 Route Handler 边界不因本故事而改变。

### Library / Framework Requirements

- 数据库 ORM：`drizzle-orm`
- 迁移工具：`drizzle-kit`
- PostgreSQL 驱动：`pg`
- 基于 2026-03-25 的 registry 查询，当前可优先固定：
  - `drizzle-orm@0.45.1`
  - `drizzle-kit@0.31.10`
  - `pg@8.20.0`
- Node / App 基线继续遵循当前仓库：`Next.js 16.2.1`、`React 19.2.4`、`TypeScript 5`、`Node.js 24` 开发容器
- 依赖版本应固定到当前官方稳定发布，不要使用宽泛 `^` 范围，避免 CLI / ORM 版本错配导致迁移结果漂移

### File Structure Requirements

- 推荐新增工件：
  - `drizzle.config.ts`
  - `drizzle/`（迁移 SQL 与 meta）
  - `src/infrastructure/postgres/client.ts`
  - `src/infrastructure/postgres/schema/auth-sessions.ts`
  - `src/infrastructure/postgres/schema/analysis-sessions.ts`
  - `src/infrastructure/postgres/schema/index.ts`
  - `tests/story-2-2-postgres-drizzle-schema.test.mjs`
- 如需新增辅助文件，优先放在 `src/infrastructure/postgres/` 目录内，保持数据库接入点集中，不要把 Drizzle schema 散落到 `src/domain` 或页面目录。
- `package.json` 与 `.env.example` 只做本故事真正需要的最小改动；不要在这一故事中顺手加入与 Redis、worker 或生产部署相关的新脚本。

### Testing Requirements

- Story 2.2 应继续沿用当前“故事级测试 + 串行回归”的项目习惯。
- `tests/story-2-2-postgres-drizzle-schema.test.mjs` 建议至少覆盖：
  - `package.json` 存在 `db:generate` / `db:migrate`
  - 存在 `drizzle.config.ts`
  - Postgres 基础设施目录与 schema 文件存在
  - 使用独立 platform schema，而不是默认 `public`
  - 存在且仅存在本故事约定的最小表定义，不提前引入大量未来表
  - 没有在本故事中切换 memory store 到 Postgres 实现
- 命令级验证建议顺序：
  - `node --test tests/story-2-2-postgres-drizzle-schema.test.mjs`
  - `pnpm db:generate`
  - `pnpm db:migrate`
  - 如数据库可用，使用查询或 `information_schema` 检查 platform schema / tables
  - `pnpm lint`
  - `pnpm build`
  - `node --test --test-concurrency=1 tests/*.test.mjs`
- 若当前环境没有可访问的 Postgres 实例，可先完成契约测试、迁移生成和静态验证，但必须在完成说明中如实记录限制，不能伪造成功执行迁移。

### Previous Story Intelligence

- Story 2.1 已落地 `compose.yaml`、`.env.example`、`Dockerfile.dev` 与 `docs/local-infrastructure.md`；2.2 应直接复用这些工件，而不是重新设计数据库启动方式。
- 当前 `.env.example` 已定义 `DATABASE_URL=postgresql://ontology_agent:ontology_agent_dev_password@postgres:5432/ontology_agent`，这应成为 Drizzle 配置与迁移命令的默认连接来源。
- Story 2.1 明确记录了 Docker daemon 在当前执行环境中可能不可用，因此 2.2 的验证说明必须允许“生成迁移成功，但运行时数据库验证受限”的真实结果。
- Story 1.2 到 1.6 已经建立了会话、工作台、分析创建、历史回看与范围边界的产品事实；2.2 建表时要以这些已存在的领域模型为准，而不是凭空扩展字段。
- 现有 `AuthSession` 使用字符串 `sessionId` 与 ISO 字符串 `expiresAt`，`AnalysisSession` 使用字符串 `id` 和 ISO 时间；2.2 建表时需要确保这些模型能无损映射，而不是强行引入与现有模型冲突的结构。

### Latest Tech Guidance

- Drizzle 官方文档当前继续以根级 `drizzle.config.ts` + schema 文件 + migration 输出目录的模式组织迁移工作流，适合作为本项目的最小基线。
- Drizzle 文档提供 PostgreSQL schema 能力，可通过 `pgSchema(...)` 将平台表与默认 `public` / 外部 ERP schema 分离；这正对应当前架构要求的“平台自有 schema 与 ERP 边界清晰分离”。
- Drizzle 的团队迁移工作流以“先生成 migration，再执行 migration”为主，适合当前仓库需要提交 SQL 变更、避免 schema 漂移的场景；本故事不应退化为只做 `push`。
- 2026-03-25 通过 `pnpm dlx drizzle-kit --help` 校验，当前 CLI 明确提供 `generate`、`migrate`、`push`、`check`、`studio` 等命令；本故事应标准化采用 `generate + migrate`，而不是把 `push` 当作主路径。
- PostgreSQL 官方镜像已在 Story 2.1 中固定到 Compose 基线；2.2 应围绕同一 Postgres 服务与 `DATABASE_URL` 约定展开，而不是重新定义数据库拓扑。

### Project Structure Notes

- 当前仓库尚无任何数据库接入目录；2.2 是第一次正式引入 Postgres / Drizzle，因此命名和目录边界要一次性站稳。
- 现有 `src/infrastructure/session/` 与 `src/infrastructure/analysis-session/` 已体现“按外部适配器职责分目录”的模式；Postgres 接入也应遵循同类结构，而不是把所有数据库代码堆到根目录脚本中。
- 当前没有 `drizzle-kit`、`drizzle-orm` 或 `pg` 依赖，开发者不应误以为仓库已经部分接线。
- UX 文档没有为 Story 2.2 引入新的用户界面要求，因此本故事默认不新增页面或视觉交互，只做基础设施与迁移层工作。

### References

- [Source: {project-root}/_bmad-output/planning-artifacts/epics.md#Epic 2: 基础设施基线与平台持久化]
- [Source: {project-root}/_bmad-output/planning-artifacts/epics.md#Story 2.2: 初始化 Postgres 与 Drizzle 平台 schema]
- [Source: {project-root}/_bmad-output/planning-artifacts/architecture.md#数据架构]
- [Source: {project-root}/_bmad-output/planning-artifacts/architecture.md#基础设施与部署]
- [Source: {project-root}/_bmad-output/planning-artifacts/architecture.md#决策影响分析]
- [Source: {project-root}/_bmad-output/project-context.md#技术栈与版本]
- [Source: {project-root}/_bmad-output/project-context.md#关键实现规则]
- [Source: {project-root}/_bmad-output/implementation-artifacts/2-1-docker-compose-baseline.md]
- [Source: {project-root}/.env.example]
- [Source: {project-root}/package.json]
- [Source: {project-root}/src/domain/auth/models.ts]
- [Source: {project-root}/src/domain/analysis-session/models.ts]
- [Source: {project-root}/src/application/auth/ports.ts]
- [Source: {project-root}/src/application/analysis-session/ports.ts]
- [Source: {project-root}/src/infrastructure/session/memory-session-store.ts]
- [Source: {project-root}/src/infrastructure/analysis-session/memory-analysis-session-store.ts]
- [Source: {project-root}/tests/story-1-4-analysis-session.test.mjs]
- [Drizzle config overview](https://orm.drizzle.team/docs/drizzle-config-file)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [Drizzle PostgreSQL schemas](https://orm.drizzle.team/docs/schemas)
- [Drizzle migrations for teams](https://orm.drizzle.team/docs/migrations-for-teams)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- 先新增 Story 2.2 的契约测试，锁定 Drizzle 依赖版本、`drizzle.config.ts`、平台 schema、数据库客户端入口和 migration 目录的最小约定。
- 在根目录建立 `drizzle.config.ts` 与 `db:generate` / `db:migrate` / `db:studio` 脚本，并继续复用 `DATABASE_URL` 作为唯一主数据库连接来源。
- 在 `src/infrastructure/postgres/` 下集中落 `client.ts` 与 schema 文件，只建立 `platform.auth_sessions` / `platform.analysis_sessions` 两张最小表，不切换现有 memory store。
- 生成首个 Drizzle migration，随后跑故事级测试、全量测试、`pnpm lint` 与 `pnpm build`，并如实记录数据库运行时验证边界。

### Debug Log References

- `node --test tests/story-2-2-postgres-drizzle-schema.test.mjs`（先失败，后通过）
- `pnpm view @types/pg version`
- `pnpm add drizzle-orm@0.45.1 pg@8.20.0`
- `pnpm add -D drizzle-kit@0.31.10`
- `pnpm add -D @types/pg@8.20.0`
- `pnpm add -D @next/env@16.2.1`
- `pnpm db:generate`（首次因未加载 `DATABASE_URL` 失败）
- `set -a; source .env.example; set +a; pnpm db:generate`
- `set -a; source .env.example; set +a; pnpm db:migrate`（首次失败：数据库连接在当前环境中意外终止）
- `set -a; source .env.example; set +a; node -e "const { Client } = require('pg'); const client = new Client({ connectionString: process.env.DATABASE_URL }); client.connect().then(() => { console.log('connected'); return client.end(); }).catch((error) => { console.error(error.message); process.exit(1); });"`（首次失败，排查用）
- `pnpm lint`
- `pnpm build`
- `node --test --test-concurrency=1 tests/*.test.mjs`
- `docker info`
- `docker compose up -d postgres redis`
- `docker compose logs --no-color postgres redis`
- `set -a; source .env; set +a; node -e "const { Client } = require('pg'); const client = new Client({ connectionString: process.env.DATABASE_URL }); client.connect().then(() => { console.log('connected'); return client.end(); }).catch((error) => { console.error(error.message); process.exit(1); });"`
- `set -a; source .env; set +a; pnpm db:migrate`
- `docker exec ontology-agent-postgres-1 psql -U ontology_agent -d ontology_agent -c "select schema_name from information_schema.schemata where schema_name = 'platform';"`
- `docker exec ontology-agent-postgres-1 psql -U ontology_agent -d ontology_agent -c "select table_schema, table_name from information_schema.tables where table_schema = 'platform' order by table_name;"`
- `docker exec ontology-agent-postgres-1 psql -U ontology_agent -d ontology_agent -c "select tablename, indexname from pg_indexes where schemaname = 'platform' order by tablename, indexname;"`
- `set -a; source .env; set +a; docker compose config`
- `node --test tests/story-2-1-compose-baseline.test.mjs tests/story-2-2-postgres-drizzle-schema.test.mjs`

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- 已在 `package.json` 中固定 `drizzle-orm@0.45.1`、`pg@8.20.0`、`drizzle-kit@0.31.10`，并补充 `db:generate`、`db:migrate`、`db:studio` 脚本。
- 为了让 `drizzle.config.ts` 在 TypeScript 检查中可解析，补充了同版本的 `@next/env@16.2.1` 与 `@types/pg@8.20.0`，没有引入 `dotenv`。
- 已新增根级 `drizzle.config.ts`，通过 `loadEnvConfig(process.cwd())` 读取环境，并将 schema 入口固定到 `src/infrastructure/postgres/schema/index.ts`、migration 输出固定到 `drizzle/`。
- 已新增 `src/infrastructure/postgres/client.ts`，使用 `drizzle-orm/node-postgres` 与 `pg` 提供最小数据库客户端工厂 `createPostgresDb()`，为后续 repository 复用保留单一入口。
- 已建立独立 `platform` schema，并只定义 `auth_sessions` 与 `analysis_sessions` 两张最小表，字段映射当前 `AuthSession` / `AnalysisSession` 的真实持久化需求，未提前加入结果、审计、任务、图谱或语义层表。
- 已生成首个 migration：`drizzle/0000_clear_senator_kelly.sql`，并同步生成 `drizzle/meta/0000_snapshot.json` 与 `drizzle/meta/_journal.json`。
- 已通过 `node --test tests/story-2-2-postgres-drizzle-schema.test.mjs`、`pnpm lint`、`pnpm build` 与 `node --test --test-concurrency=1 tests/*.test.mjs`。
- 后续排障已确认最初失败根因有二：宿主机 `.env` 使用了仅适用于容器网络的 `postgres` 主机名，且本机已有本地 Postgres 占用 `127.0.0.1:5432`；现已改为宿主机使用 `127.0.0.1:55432`，而 Compose 内 `web` 容器仍显式连接 `postgres:5432`。
- 同次排障还修复了 Postgres 18 官方镜像的卷挂载路径问题，现改为将 `postgres-data` 挂载到 `/var/lib/postgresql`，避免容器因旧数据目录布局直接退出。
- 现已成功执行 `docker compose up -d postgres redis`、宿主机 `pg` 连接探测、`pnpm db:migrate`，并通过 `psql` 验证数据库中已存在 `platform` schema、`auth_sessions` / `analysis_sessions` 两张表及对应索引。
- 结合 Epic 1 review 修复，`platform.analysis_sessions` 已扩展保存 `organizationId`、`projectIds`、`areaIds` 与 `savedContext`，并生成增量迁移 `drizzle/0001_cuddly_cable.sql` 支撑作用域隔离与基础上下文快照回放。
- 2026-03-30 根据 Epic 2 code review 修复，`src/infrastructure/postgres/client.ts` 已改为默认 `DATABASE_URL` 场景下的进程级单例缓存，避免不同 consumer 在模块加载时反复创建 `pg.Pool`。
- 针对旧会话必须可访问的产品决策，后续读取链路已补上兼容策略：旧迁移留下的空作用域快照与占位 `saved_context` 不再被静默当成真实数据使用，而是走兼容可见与上下文回退逻辑。

### Change Log

- 2026-03-30：根据 Epic 2 review 修复 Postgres client pool 复用问题，并补充旧 `analysis_sessions` 升级兼容说明。

### File List

- _bmad-output/implementation-artifacts/2-2-postgres-drizzle-platform-schema.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- .env.example
- compose.yaml
- docs/local-infrastructure.md
- drizzle.config.ts
- drizzle/0000_clear_senator_kelly.sql
- drizzle/meta/0000_snapshot.json
- drizzle/meta/_journal.json
- package.json
- pnpm-lock.yaml
- src/infrastructure/postgres/client.ts
- src/infrastructure/postgres/schema/analysis-sessions.ts
- src/infrastructure/postgres/schema/auth-sessions.ts
- src/infrastructure/postgres/schema/index.ts
- tests/story-2-2-postgres-drizzle-schema.test.mjs

## Change Log

- 2026-03-25：完成 Story 2.2，建立 Drizzle/Postgres 基线、独立 platform schema、最小会话表结构与首个 migration。
- 2026-03-27：为 Epic 1 review 修复追加分析会话作用域快照与 `savedContext` 持久化字段，并生成增量迁移 `0001_cuddly_cable.sql`。
