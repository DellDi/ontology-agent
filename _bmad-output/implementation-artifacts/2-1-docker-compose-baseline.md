# Story 2.1: 建立 Docker Compose 本地基础设施基线

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 通过 Docker Compose 启动 web、Postgres 和 Redis 的本地开发环境,
so that 后续平台持久化和后台执行能力可以在统一且可重复的环境中开发与验证。

## Acceptance Criteria

1. 通过单一 Compose 配置即可拉起 `web`、`postgres`、`redis` 三个服务，本地环境不依赖手工逐个启动。
2. 基线环境具备清晰的连接方式、环境变量约定和健康检查入口，并为后续 `worker` 接入保留明确扩展位。

## Tasks / Subtasks

- [ ] 建立 Compose 与环境变量基线（AC: 1, 2）
  - [ ] 在仓库根目录新增官方推荐的 `compose.yaml`，采用 Compose Specification，不再添加遗留的顶层 `version` 字段。
  - [ ] 在 Compose 中定义 `web`、`postgres`、`redis` 三个服务，并为 Postgres / Redis 建立命名卷。
  - [ ] 新增可提交的环境变量样例文件，例如 `.env.example`，并同步调整 `.gitignore` 允许提交该样例文件。
  - [ ] 明确约定至少这些变量：`APP_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_PORT`、`REDIS_PORT`、`DATABASE_URL`、`REDIS_URL`、`SESSION_SECRET`、`ENABLE_DEV_ERP_AUTH`。
- [ ] 为 `web` 服务建立开发期容器运行方式（AC: 1, 2）
  - [ ] 采用单独的开发容器定义，例如 `Dockerfile.dev` 或 `docker/web/Dockerfile.dev`，基于 `Node.js 24` 的 Debian 系镜像而不是 Alpine 变体。
  - [ ] 在容器内显式启用 `corepack` / `pnpm`，并以 `pnpm dev --hostname 0.0.0.0 --port ${APP_PORT}` 运行当前 Next.js App Router 项目。
  - [ ] 采用源码 bind mount + 独立 `node_modules` / `pnpm store` volume 的方式，避免宿主和容器相互污染依赖目录。
  - [ ] `web` 容器不应在 Story 2.1 中强依赖尚未落地的 Drizzle schema、真实数据库查询或 Redis 读写逻辑；当前目标只是环境基线可启动。
- [ ] 为 Postgres 与 Redis 建立健康检查和安全边界（AC: 1, 2）
  - [ ] 采用官方镜像并固定明确版本标签，不使用 `latest`。
  - [ ] Postgres 服务使用 `pg_isready` 健康检查，Redis 服务使用 `redis-cli ping` 健康检查。
  - [ ] `web` 对依赖服务使用基于 `depends_on.condition: service_healthy` 的启动顺序，而不是假设数据库一启动就可用。
  - [ ] 端口发布默认绑定到 `127.0.0.1`，避免本地开发态把 Postgres / Redis 无意暴露到局域网。
  - [ ] 记录 Redis 仅为本地开发暴露端口，当前阶段不引入密码、ACL 或公网暴露场景。
- [ ] 补充本地开发说明与后续扩展位（AC: 2）
  - [ ] 在 `docs/` 下新增本地基础设施说明文档，明确 `up`、`down`、`logs`、`ps`、`config`、清理 volume 等常用命令。
  - [ ] 在文档中写明当前 `ENABLE_DEV_ERP_AUTH=1` 仅用于本地联调，不能被复制为生产或试点环境默认值。
  - [ ] 在 Compose 或说明文档中明确保留后续 `worker` 服务名与扩展位置，但本故事不提前接入 `worker`、`neo4j`、`cube`。
- [ ] 完成验证并建立最小回归（AC: 1, 2）
  - [ ] 新增 `tests/story-2-1-compose-baseline.test.mjs`，验证 Compose 相关工件存在且包含 `web`、`postgres`、`redis`、healthcheck、命名卷和基础环境变量约定。
  - [ ] 运行 `docker compose config` 作为配置合法性验证。
  - [ ] 如果当前环境可访问 Docker daemon，运行 `docker compose up -d`，并通过 `docker compose ps` / 健康状态确认三个服务可用。
  - [ ] 运行 `pnpm lint` 与 `pnpm build`，确认新增 Compose 与文档工件未破坏现有应用工程。

## Dev Notes

- 这是 Epic 2 的“环境底座故事”，不是数据库接线故事。Story 2.1 只负责把本地基础设施运行面搭起来，不负责引入 Drizzle、表结构、会话迁移或分析会话迁移。
- 当前仓库的真实状态仍然是：
  - 登录会话：`src/infrastructure/session/memory-session-store.ts`
  - 分析会话：`src/infrastructure/analysis-session/memory-analysis-session-store.ts`
  - ERP 登录：开发期 stub，且现在必须显式开启 `ENABLE_DEV_ERP_AUTH=1` 才能在本地使用联调入口
- Story 2.1 必须为 Story 2.2、2.3、2.4、2.5 建立稳定约定，但不能把这些故事的工作提前做完：
  - 不创建 Drizzle schema
  - 不迁移 session / analysis session 到 Postgres
  - 不接入 Redis 客户端封装
  - 不新增 worker 进程
  - 不提前加入 `neo4j` 或 `cube`

### Technical Requirements

- `compose.yaml` 放在仓库根目录，优先遵循当前 Docker Compose 推荐的 Compose Specification 与默认文件名约定。
- 建议在 Compose 顶层声明稳定项目名，例如 `name: ontology-agent`，避免不同目录名造成资源名漂移。
- `web` 服务应继续复用当前项目脚本与目录结构，不要复制第二套 Web 工程。
- 如果开发容器需要安装额外工具，优先使用 Debian 系基础镜像，避免 Alpine / musl 变体在 Next.js 原生依赖或调试工具上引入额外不确定性。
- 明确固定镜像版本标签，而不是直接使用 `postgres:latest` 或 `redis:latest`。实现时应以官方镜像页的当前稳定标签为准，并在完成说明里记录最终选型。
- `web` 容器应保留 Story 1.x 已经建立的行为：
  - Next.js App Router
  - `pnpm dev`
  - `/workspace` 为工作台入口
  - 本地联调若要走开发期 ERP 登录，需要显式提供 `ENABLE_DEV_ERP_AUTH=1`

### Architecture Compliance

- 本故事直接对应架构文档中的分阶段基础设施接入策略：
  - Phase 1：`web + postgres + redis + docker compose`
  - Phase 2 才是 `worker skeleton`
  - `neo4j` 与 `cube` 继续延后
- 自托管容器化是架构要求的一部分，因此 Compose 文件不应只服务个人机器临时调试，也要具备向试点环境演进的清晰结构。
- 浏览器仍不得直连 Postgres 或 Redis；Story 2.1 的 Compose 基线只是建立服务，不改变服务端受控边界。

### File Structure Requirements

- 推荐本故事的新增工件如下：
  - `compose.yaml`
  - `.env.example`
  - `Dockerfile.dev` 或 `docker/web/Dockerfile.dev`
  - `docs/local-infrastructure.md`
  - `tests/story-2-1-compose-baseline.test.mjs`
- 如选择 `docker/web/Dockerfile.dev`，需保持目录职责清晰，不要把数据库初始化脚本与 web 容器文件混放。
- 如果新增 `.env.example`，记得同步调整当前 [.gitignore](/Users/delldi/work-code/open-code/ontology-agent/.gitignore)，因为仓库现在默认忽略 `.env*`。

### Testing Requirements

- 新故事应继续遵循当前项目“故事级验证”习惯，但 Story 2.1 的重点会从页面集成测试转向基础设施工件契约测试。
- `tests/story-2-1-compose-baseline.test.mjs` 建议至少覆盖：
  - `compose.yaml` 存在
  - 存在 `web` / `postgres` / `redis` 服务块
  - Postgres / Redis 具备 healthcheck
  - 存在命名卷
  - 存在 `DATABASE_URL` / `REDIS_URL` / `ENABLE_DEV_ERP_AUTH` 等关键约定
  - 本故事没有提前加入 `worker` / `neo4j` / `cube`
- 命令级验证建议顺序：
  - `node --test tests/story-2-1-compose-baseline.test.mjs`
  - `docker compose config`
  - `docker compose up -d`
  - `docker compose ps`
  - `pnpm lint`
  - `pnpm build`
- 如果当前执行环境没有 Docker daemon，可完成文件契约测试与 `docker compose config`，并在故事完成说明中如实记录限制。

### Previous Story Intelligence

- Story 1.1 已确定当前项目实际是基于官方 `create-next-app` 初始化的 Next.js 16.2.1 工程，后续容器基线必须围绕这个现实，而不是围绕早期“手工初始化”讨论。
- Story 1.2 与后续安全修复已经把开发期 ERP 登录 stub 收紧为“必须显式开启环境变量”，因此本地 Compose 联调如果要走现有登录路径，必须在示例环境变量中显式体现该约定，并把它标记为仅限本地开发。
- Story 1.3 到 1.6 已经在工作台侧建立了受保护会话、分析会话、历史回看和范围边界，这些都还在使用内存存储。Story 2.1 的 Compose 基线要为这些功能后续迁移到 Postgres / Redis 铺路，但不能提前改写它们的行为。

### Latest Tech Guidance

- Docker Docs 当前推荐采用 Compose Specification；旧的 2.x / 3.x 版本格式已经合并，不需要再在文件里写遗留 `version`。
- Docker Compose 默认会在当前目录向上查找 `compose.yaml` 或 `docker-compose.yaml`；本项目建议直接使用 `compose.yaml`。
- Docker Docs 明确指出 Compose 在依赖服务“运行中”时并不等于“已就绪”，需要结合 `depends_on.condition: service_healthy` 与服务自身 `healthcheck` 使用。
- Redis 官方镜像文档提示：当端口被暴露到主机外部时，默认配置并不适合公网暴露。本故事应把暴露范围限制在本机回环地址。
- Docker 官方 Postgres 指南建议固定具体版本标签而不是 `latest`，并通过环境变量和 volume 管理初始化与持久化。

### Project Structure Notes

- 当前 `implementation-artifacts` 仍按 BMAD 官方默认平铺；本故事文件也保持平铺命名，不引入子目录。
- `docs/` 目录当前基本为空，适合作为本故事的本地基础设施说明落点。
- 本故事不应触碰现有 `src/domain` / `src/application` / `src/infrastructure` 里的业务逻辑，除非仅为了读取环境变量或为容器运行暴露必要脚本。

### References

- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#Story 2.1: 建立 Docker Compose 本地基础设施基线]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#基础设施与部署]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#决策影响分析]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/project-context.md#技术栈与版本]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/project-context.md#关键实现规则]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-1-manual-nextjs-foundation.md]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-6-unsupported-domain-boundary-prompt.md]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/package.json]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/.gitignore]
- [Compose file reference](https://docs.docker.com/compose/compose-file/)
- [docker compose CLI reference](https://docs.docker.com/compose/reference/)
- [Control startup order](https://docs.docker.com/compose/how-tos/startup-order/)
- [Postgres Docker Official Image guide](https://www.docker.com/blog/how-to-use-the-postgres-docker-official-image/)
- [Redis Docker Official Image](https://hub.docker.com/_/redis)
- [Postgres Docker Official Image](https://hub.docker.com/_/postgres)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 待开发时填写

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- 待开发时填写
