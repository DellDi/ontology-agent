# Story 7.3: 建立自托管容器化部署基线

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 企业运维负责人,
I want 使用标准化容器方式部署平台核心能力,
so that 我们可以在自有环境中运行系统而不依赖公有云专属托管能力。

## Acceptance Criteria

1. 运维团队按交付说明部署时，核心服务必须能够以容器方式启动。
2. 核心功能运行不能依赖公有云专属托管平台。
3. 部署基线必须清晰表达 Web、Worker 和基础设施依赖的组件边界，并为后续向 Kubernetes 演进保留清晰边界。

## Tasks / Subtasks

- [x] 在现有 Compose 基线之上补齐交付型部署边界（AC: 1, 2, 3）
  - [x] 明确区分开发容器与生产 / 试点部署镜像。
  - [x] 为 web、worker、postgres、redis 表达清晰边界。
- [x] 收敛配置与运行说明（AC: 1, 2）
  - [x] 区分宿主机地址与容器内部地址。
  - [x] 去掉仅适合 `next dev` 的交付假设。
- [x] 覆盖部署基线验证（AC: 1, 2, 3）
  - [x] 运行 `docker compose config` 与容器启动冒烟验证。
  - [x] 校验健康检查与依赖顺序。

## Dev Notes

- 这不是重做 Story 2.1，而是在开发基线之上补“可交付部署边界”。
- 不应把开发便利配置、宽松 secrets 或 stub 登录默认值直接带入部署基线。
- 当前仓库尚无完整 CI/CD；本故事聚焦“可部署基线清晰”，不假装已有成熟发布流水线。

### Architecture Compliance

- 继续沿用模块化单体 + 独立 worker 进程边界。
- 自托管要求核心能力不依赖公有云专属服务。
- 配置边界要清晰，避免 host / container 地址混用再次引发故障。

### File Structure Requirements

- 重点文件预计包括：
  - `compose.yaml`
  - 生产镜像文件，如 `Dockerfile` 或等价构建工件
  - `.env.example`
  - `docs/local-infrastructure.md` 或新增部署文档
  - 部署契约测试

### Testing Requirements

- 至少覆盖：
  - `docker compose config`
  - `web` / `worker` / `postgres` / `redis` 能启动
  - 健康检查通过
  - 如新增生产镜像，构建冒烟成功

### Previous Story Intelligence

- Story 2.1 已建立本地 Compose 基线，但仍偏开发环境。
- Story 2.6 的 worker skeleton 会成为这里容器边界的一部分。
- Story 7.4 的观测组件最好在这套容器基线上继续接入。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.3: 建立自托管容器化部署基线]
- [Source: _bmad-output/planning-artifacts/architecture.md#基础设施与部署]
- [Source: _bmad-output/planning-artifacts/prd.md#非功能需求]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `docker compose -f compose.prod.yaml --env-file .env.example config --quiet` — OK
- `docker build -f Dockerfile --target runner` — 构建成功（含 dummy DATABASE_URL 修复 build 阶段报错）
- `docker build -f Dockerfile.worker` — 构建成功，tsx 确认存在于镜像
- `docker run --rm ontology-agent-worker:... node -e "require('tsx')"` — tsx_found
- `RUN_CONTAINER_TESTS=1 node --test ...` — 12/12 pass（含 postgres+redis 健康启动、migrate 退出码 0）
- `pnpm lint` — 零错误
- `pnpm build` — 通过

### Completion Notes List

- 新增 `Dockerfile`（multi-stage: deps/builder/runner），启用 `output: 'standalone'`，builder stage 传 dummy DATABASE_URL 避免 pg client 在构建阶段报错，runner stage 以 `node server.js` 启动，非 root 用户运行。
- 新增 `Dockerfile.worker`：安装全量依赖（含 tsx、drizzle-kit 等 devDeps），拷贝 `drizzle.config.ts` 和 `drizzle/` 迁移目录，确保 worker 和 migrate 容器均可真实启动。
- 修复 `compose.prod.yaml` migrate 命令：直接调用 `node_modules/.bin/drizzle-kit migrate`，不加 `--import tsx/esm`（drizzle-kit 内部处理 TS config）。
- 新增 `.dockerignore`，排除 `node_modules`、`.next`、`.pnpm-store` 等，build context 从 3GB 降至 < 20KB。
- 新增 `compose.prod.yaml`，明确 web/worker/migrate/postgres/redis/cube/neo4j 七个服务边界，`ENABLE_DEV_ERP_AUTH` 硬编码为 `0`，所有服务配置 `restart: unless-stopped`，web 服务有 healthcheck。
- 新增 `.env.prod.example`，区分生产环境变量，不含开发便利配置。
- 新增 `docs/deployment.md`，包含快速部署步骤、开发 vs 生产差异对比、K8s 演进路径。
- `next.config.ts` 启用 `output: 'standalone'`。

### File List

- `_bmad-output/implementation-artifacts/7-3-self-hosted-container-deployment-baseline.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `Dockerfile`
- `Dockerfile.worker`
- `.dockerignore`
- `compose.prod.yaml`
- `.env.prod.example`
- `next.config.ts`
- `docs/deployment.md`
- `tests/story-7-3-container-deployment.test.mjs`

## Change Log

- 2026-04-11: 建立生产容器部署基线，multi-stage Dockerfile（含 dummy DB URL 修复 build 阶段报错），独立 worker 镜像（全量依赖含 tsx），修复 migrate 命令（去掉错误的 --import tsx/esm），补 .dockerignore 降低 build context，compose.prod.yaml 生产边界，部署文档，12/12 测试通过（含真实容器启动验证）。
