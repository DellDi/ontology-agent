# Ontology Agent (DIP3 - 智慧数据)

面向物业分析团队的 AI 原生数据工作台。行为规范见 [`AGENTS.md`](./AGENTS.md)，本文件仅作技术参考。

## Project Structure

```
ontology-agent/
├── src/                        # Next.js：页面渲染 + Java BFF 代理 + 观测 + UI 映射
│   ├── app/(auth|workspace|admin)/   # 路由组；登录页由 Java /api/auth/me + /api/auth/config 驱动
│   ├── app/api/                # 全部为 Java 透明代理（含 6 个认证路由）
│   ├── domain/ + application/  # 纯模型 / 纯 read-model（UI 映射用）
│   └── infrastructure/
│       ├── java-backend/       # Java API 客户端与跨端契约
│       └── observability/      # Web 观测
├── backend-java/               # Java 21 后端（全部业务实现）
│   └── src/main/resources/db/migration/  # Flyway V1__init.sql（幂等初始化脚本）
├── contracts/backend/          # Web / Java 共享契约（JSON Schema + OpenAPI）
├── tests/                      # 前端/契约测试
├── compose.yaml / compose.prod.yaml
└── Dockerfile.java             # Java 镜像（backend 与 migrate 共用）
```

## Architecture

Clean Architecture（六边形），依赖方向：`domain ← application ← infrastructure ← app`。

详细现状、目标包边界与渐进迁移门禁见 [`docs/architecture/java-architecture-baseline.md`](./docs/architecture/java-architecture-baseline.md)；跨领域 Capability、Domain Pack 与 EasyV 前置顺序见 [`docs/architecture/multi-domain-runtime-architecture.md`](./docs/architecture/multi-domain-runtime-architecture.md)。两份文档描述目标与迁移规则，不代表当前源码已经完成多领域改造。

| 层 | 职责 |
|---|---|
| `domain` / `application`（Web） | 纯模型与 read-model，无外部依赖，仅 UI 映射 |
| `backend-java` | 按 feature 组织：认证、分析、Ontology、Graph Sync、Flyway 迁移 |
| `app` | Next.js App Router，只做展示与透明代理 |

- 路径别名 `@/*` → `./src/*`
- 安全：`sanitizeNextPath()` 防 Open Redirect，仅允许 `/workspace`、`/admin` 返回路径（Java 与 Next 同一语义）
- 权限：`PermissionScope` 四维边界（组织/项目/区域/角色）；ERP 目录解析在 Java（组织路径 → propertyProject → precinct），目录账号只授予 `PROPERTY_ANALYST`，无账号名特判

## Tech Stack

- Frontend：Next.js 16 + React 19 + TypeScript 5（strict）
- Backend：Java 21 + Spring Boot 4.1 + MyBatis-Plus + Spring AI 2.0
- Database：PostgreSQL 18 + Flyway 12（`V1__init.sql` 幂等初始化，可重复执行）
- Cache：Redis 8（仅 Java backend）
- Styling / Package：Tailwind CSS 4 / pnpm
- Runtime：Node.js 24（仅 Web）+ JVM 21（全部业务与迁移）

## Setup & Commands

```bash
pnpm install && cp .env.example .env
docker compose up -d postgres redis   # 基础设施
mise exec java@temurin-21.0.12+8.0.LTS -- mvn -f backend-java/pom.xml -q spring-boot:run -Dspring-boot.run.profiles=migrate  # Flyway 初始化
pnpm dev                              # Web
mise exec java@temurin-21.0.12+8.0.LTS --% -- mvn -f backend-java/pom.xml spring-boot:run  # Java API + Worker

pnpm build / pnpm lint                # Web 门禁
mvn -f backend-java/pom.xml test      # Java 测试（Testcontainers）
```

## Testing

- Java：`backend-java/src/test/java`（Testcontainers；覆盖认证、Flyway、Main Agent、Ontology、Graph Sync）
- Web/Java 契约：`tests/java-*.test.mjs`（JSON Schema + Zod + 透明代理，含认证路由与 Set-Cookie 透传）
- 前端行为：`tests/story-*.test.mjs`；CI 门禁 = `pnpm test:web` + `mvn -f backend-java/pom.xml test` + tsc + lint + build

## Environment Variables

| 变量 | 说明 | 默认值 |
|---|---|---|
| `APP_PORT` / `POSTGRES_PORT` | 应用端口 / PG 宿主端口 | `3000` / `55432` |
| `JAVA_DATABASE_URL` | Java backend JDBC（由 `POSTGRES_*` 派生） | 见 `.env.example` |
| `REDIS_URL` / `REDIS_KEY_PREFIX` | Redis（仅 Java backend） | `redis://127.0.0.1:6379` / `dip3` |
| `SESSION_SECRET` | 会话 Cookie 签名密钥（Java backend） | 本地设置 |
| `ENABLE_DEV_ERP_AUTH` | 开发联调登录开关（仅本地） | `0` |
| `ERP_API_BASE_URL` | ERP 目录认证接口（Java backend 登录必需） | - |
| `COOKIE_SECURE` | 会话 Cookie Secure（生产置 `true`） | `false` |

## Backend Errors（Java）

- `BackendException(code, message)` 统一业务错误；认证相关：`INVALID_ERP_CREDENTIALS`、`DEV_AUTH_DISABLED`、`AUTH_REQUIRED`、`AUTH_SCOPE_INVALID`。
- 登录/退出/回调/桥接失败一律 303 重定向 `/login?error=...`；其余接口按 `ApiExceptionHandler` 返回 JSON（`code + traceId`）。

## Coding Disciplines

- 先想后写：陈述假设、不确定就问、有更简方案时明确提出
- 极简优先：最小代码解决问题，不做推测性实现
- 手术式改动：只改必要代码，不顺手重构未损坏的代码
- 目标驱动：任务转可验证目标（写测试 → 使其通过）

## Conventions

- 标识符英文，注释与 UI 中文
- 基础设施端口仅绑定 `127.0.0.1`；路由组 `(auth)`、`(workspace)`、`(admin)`
- 新增领域概念沿 `domain → application → infrastructure → app`
