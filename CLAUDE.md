# Ontology Agent (DIP3 - 智慧数据)

面向物业分析团队的 AI 原生数据工作台。行为规范见 [`AGENTS.md`](./AGENTS.md)，本文件侧重项目技术参考。

## Project Structure

```
ontology-agent/
├── src/
│   ├── app/                        # Next.js App Router (presentation + Java BFF 代理)
│   │   ├── (auth)/login/           # 登录页（Java /api/auth/me + /api/auth/config 驱动）
│   │   ├── (workspace)/            # 工作台路由组 + layout
│   │   ├── api/
│   │   │   ├── auth/               # 认证 API 透明代理 (login, logout, callback, ...)
│   │   │   └── analysis/sessions/  # 分析会话 API 透明代理
│   ├── domain/                     # 领域层 — 纯模型（UI 映射用）
│   ├── application/                # 应用层 — 纯 read-model 用例（UI 映射用）
│   ├── infrastructure/
│   │   ├── java-backend/           # Java API 客户端与跨端契约
│   │   └── observability/          # Web 观测
│   └── shared/                     # 共享工具
├── backend-java/                   # Java 21 / Spring Boot 4.1 后端（全部业务实现）
│   └── src/main/resources/db/migration/  # Flyway V1~V6（数据库唯一迁移事实源）
├── tests/                          # 前端/契约测试
├── contracts/backend/              # Web / Java 共享契约
├── docs/                           # 项目文档
├── compose.yaml                    # Docker Compose (web + backend + migrate + 基础设施)
└── Dockerfile.java                 # Java 镜像（backend 与 migrate 共用）
```

## Architecture

Clean Architecture (六边形架构)，依赖方向：`domain` ← `application` ← `infrastructure` ← `app`

| 层 | 职责 | 备注 |
|---|---|---|
| `domain` | 纯 TS 模型和业务策略 | 无外部依赖 |
| `application` | ports (接口) + use-cases | 每个模块含 `ports.ts` / `use-cases.ts` |
| `infrastructure` | 适配器实现 (Postgres, Redis, ERP) | Session / AnalysisSession 提供 memory + postgres 双实现 |
| `app` | Next.js App Router | 组装依赖，处理 HTTP |

- 路径别名: `@/*` → `./src/*`
- 安全: `sanitizeNextPath()` 防止 Open Redirect，重定向限 `/workspace`、`/admin` 下（Java `AuthLoginService` 与 Next 登录页共用同一语义）
- 权限: `PermissionScope` 定义组织、项目、区域、角色四维边界；ERP 目录解析在 Java（组织路径 → propertyProject → precinct），目录账号只授予 `PROPERTY_ANALYST`，无账号名特判

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + React 19 + TypeScript 5, strict mode
- **Backend**: Java 21 + Spring Boot 4.1 + MyBatis-Plus 3.5.17 + Spring AI 2.0
- **Database**: PostgreSQL 18 + Flyway 12（迁移脚本 V1~V6 收编自原 Drizzle 0000~0005）
- **Cache**: Redis 8（仅供 Java backend）
- **Styling**: Tailwind CSS 4
- **Package Manager**: pnpm
- **Runtime**: Node.js 24（仅 Web 展示/代理/观测）+ JVM 21（全部业务与迁移）
- **Container**: Docker Compose

## Setup & Commands

```bash
pnpm install                    # 安装依赖
cp .env.example .env            # 创建环境变量
docker compose up -d postgres redis  # 启动基础设施
pnpm db:migrate                 # Flyway 迁移（Java migrate profile；老库自动严格核对后 baseline 6）
pnpm dev                        # 开发服务器（Web）
mise exec java@temurin-21.0.12+8.0.LTS --% -- mvn -f backend-java/pom.xml spring-boot:run  # Java API + Worker
```

```bash
pnpm build                      # 生产构建
pnpm lint                       # ESLint 检查
pnpm lint:fix                   # 自动修复 lint
mvn -f backend-java/pom.xml test  # Java 测试（Testcontainers）
docker compose up -d            # 全容器模式
docker compose down -v          # 停止并清理数据卷
```

数据库迁移只允许新增 `backend-java/src/main/resources/db/migration/V{n}__*.sql`（V7+）；禁止改 V1~V6 内容。

## Testing

测试文件: `tests/story-{epic}-{story}-{name}.test.mjs`（前端/契约）+ `backend-java/src/test/java`（Java 全量）

已有覆盖:
- Java: 认证（登录/退出/ERP 目录解析/Session）、Flyway 迁移策略、Main Agent、Workflow、Ontology Governance、Graph Sync
- Web/Java 契约: `tests/java-*.test.mjs`（JSON Schema + Zod + 透明代理含认证路由与 Set-Cookie 透传）
- 前端行为: story-* 测试（登录、工作台、SSE、权限展示等）

## Environment Variables

| 变量 | 说明 | 默认值 |
|---|---|---|
| `APP_PORT` | 应用端口 | `3000` |
| `POSTGRES_PORT` | 宿主机暴露的 PG 端口 | `55432` |
| `JAVA_DATABASE_URL` | Java backend JDBC 地址（由 `POSTGRES_*` 派生） | 见 `.env.example` |
| `REDIS_URL` | Redis 连接字符串（仅供 Java backend） | `redis://127.0.0.1:6379` |
| `SESSION_SECRET` | 会话签名密钥（Java backend） | 本地自行设置 |
| `ENABLE_DEV_ERP_AUTH` | 开发联调登录开关 (仅本地，Java backend) | `0` |
| `ERP_API_BASE_URL` | ERP 目录认证接口（Java backend 登录必需） | - |
| `COOKIE_SECURE` | 会话 Cookie 是否 Secure（生产置 `true`） | `false` |

## Backend Errors（Java）

Java 侧错误语义（中文消息，面向终端用户）:

- `BackendException(code, message)` — 统一业务错误；认证相关 code：`INVALID_ERP_CREDENTIALS`（凭证错误，含具体原因）、`DEV_AUTH_DISABLED`（开发联调入口未开放）、`AUTH_REQUIRED`、`AUTH_SCOPE_INVALID`。
- 登录/退出/回调/桥接失败一律 303 重定向到 `/login?error=...`（与历史行为一致）；其余接口按 `ApiExceptionHandler` 映射 JSON 错误（`code + traceId`）。

## Coding Disciplines

> 与 AGENTS.md 的产品标准 / 根因策略互补，此处聚焦日常编码行为。

### 1. 先想后写

- 明确陈述假设，不确定时提问，不隐藏困惑
- 多种解释时主动呈现选项，不静默选择
- 有更简方案时明确提出，必要时反驳过度设计

### 2. 极简优先

- 最小代码解决问题，不做推测性实现
- 单次使用不抽象，未请求的"灵活性"不加
- 200 行能缩到 50 行就重写

### 3. 手术式改动

- 仅改必要代码，不"顺手改进"相邻代码、注释或格式
- 不重构未损坏的代码，匹配现有风格
- 无关死代码仅提及不删除；自己造成的孤儿代码必须清理

### 4. 目标驱动执行

- 将任务转化为可验证目标（写测试 → 使其通过）
- 多步骤任务先列计划，每步附验证标准

## Conventions

- 代码标识符英文，注释和 UI 中文
- 基础设施端口仅绑定 `127.0.0.1`
- 路由组: `(auth)`, `(workspace)`, `(admin)`
- 新增领域概念按 `domain → application → infrastructure → app` 顺序实现
- Schema 变更必须同步生成迁移（`drizzle-kit generate`）
