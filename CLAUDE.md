# Ontology Agent (DIP3 - 智慧数据)

面向物业分析团队的 AI 原生数据工作台基础骨架。

## Project Structure

```
ontology-agent/
├── src/
│   ├── app/                        # Next.js App Router (presentation)
│   │   ├── (admin)/                # 管理后台路由组 (planned)
│   │   ├── (auth)/login/           # 登录页
│   │   ├── (workspace)/            # 工作台路由组 + layout
│   │   │   ├── workspace/          # 工作台首页 & 分析会话页
│   │   │   └── _components/        # 工作台私有组件
│   │   ├── api/
│   │   │   ├── auth/               # 认证 API (login, logout, callback)
│   │   │   └── analysis/sessions/  # 分析会话 API
│   │   ├── layout.tsx              # Root layout (lang=zh-CN)
│   │   └── globals.css             # Tailwind CSS 入口
│   ├── domain/                     # 领域层 — 纯模型与策略
│   │   ├── auth/                   # 认证模型 & 错误
│   │   ├── analysis-session/       # 分析会话模型
│   │   └── scope-boundary/         # 数据权限边界策略
│   ├── application/                # 应用层 — 用例与端口
│   │   ├── auth/                   # ports.ts + use-cases.ts
│   │   ├── analysis-session/       # ports.ts + use-cases.ts
│   │   └── workspace/             # home.ts
│   ├── infrastructure/             # 基础设施层 — 适配器实现
│   │   ├── postgres/               # Drizzle client & schema
│   │   ├── session/                # 会话存储 (memory / postgres / cookie)
│   │   ├── analysis-session/       # 分析会话存储 (memory / postgres)
│   │   └── erp-auth/               # ERP 认证开发适配器
│   └── shared/                     # 共享工具
│       └── permissions/            # 权限摘要格式化
├── tests/                          # Story-based 测试
├── drizzle/                        # Drizzle 迁移文件
├── docs/                           # 项目文档
├── compose.yaml                    # Docker Compose (web + postgres + redis)
├── Dockerfile.dev                  # 开发容器 (Node 24 + pnpm)
└── drizzle.config.ts               # Drizzle Kit 配置
```

## Architecture

采用 **Clean Architecture (六边形架构)**，分层依赖方向：`domain` ← `application` ← `infrastructure` ← `app`

- **domain**: 纯 TypeScript 模型和业务策略，无外部依赖
- **application**: 定义 ports (接口) 和 use-cases，依赖 domain
- **infrastructure**: 实现 ports 的具体适配器 (Postgres, Redis, ERP Auth)
- **app**: Next.js App Router，组装依赖并处理 HTTP

路径别名: `@/*` → `./src/*`

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19
- **Language**: TypeScript 5, strict mode
- **Database**: PostgreSQL 18 + Drizzle ORM 0.45
- **Cache**: Redis 8
- **Styling**: Tailwind CSS 4
- **Package Manager**: pnpm
- **Runtime**: Node.js 24
- **Container**: Docker Compose

## Setup & Installation

```bash
# 1. 安装依赖
pnpm install

# 2. 创建环境变量
cp .env.example .env

# 3. 启动基础设施 (Postgres + Redis)
docker compose up -d postgres redis

# 4. 运行数据库迁移
pnpm db:migrate

# 5. 启动开发服务器
pnpm dev
```

全容器模式:

```bash
docker compose up -d          # 启动 web + postgres + redis
docker compose logs -f web    # 查看日志
docker compose down -v        # 停止并清理数据卷
```

## Common Commands

```bash
pnpm dev                # 启动 Next.js 开发服务器
pnpm build              # 生产构建
pnpm lint               # ESLint 检查
pnpm lint:fix           # 自动修复 lint 问题
pnpm db:generate        # 生成 Drizzle 迁移
pnpm db:migrate         # 执行数据库迁移
pnpm db:studio          # 打开 Drizzle Studio 数据浏览器
docker compose up -d    # 后台启动全部容器
docker compose down     # 停止容器
```

## Testing

测试文件按 Story 编号命名，使用 `.mjs` 扩展名:

```
tests/story-{epic}-{story}-{name}.test.mjs
```

示例: `tests/story-1-2-auth.test.mjs`, `tests/story-2-3-session-persistence.test.mjs`

已有测试覆盖:
- Story 1.1-1.6: 基础功能 (认证、工作台、分析会话、历史、权限边界)
- Story 2.1-2.4: 基础设施 (Docker Compose、Drizzle schema、会话持久化)
- `tests/auth-hardening.test.mjs`: 认证安全加固

## Environment Variables

| 变量 | 说明 | 默认值 |
|---|---|---|
| `APP_PORT` | 应用端口 | `3000` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | 见 `.env.example` |
| `REDIS_URL` | Redis 连接字符串 | `redis://127.0.0.1:6379` |
| `POSTGRES_PORT` | 宿主机暴露的 PG 端口 | `55432` |
| `SESSION_SECRET` | 会话签名密钥 | 本地自行设置 |
| `ENABLE_DEV_ERP_AUTH` | 开发联调登录开关 (仅本地) | `1` |

## Error Handling

领域层定义专用错误类，继承 `Error` 并设置 `name` 属性:

- `InvalidErpCredentialsError` — ERP 身份校验失败
- `WorkspaceAuthorizationError` — 账号无分析权限
- `DevErpAuthDisabledError` — 开发认证入口未开放

错误消息使用中文，面向终端用户展示。

## Core Principles

- **Clean Architecture 边界**: domain 层禁止引入外部依赖；application 层通过 ports (接口) 解耦基础设施
- **Ports & Adapters**: 每个 application 模块定义 `ports.ts` (接口) 和 `use-cases.ts` (实现)；infrastructure 层提供具体适配器
- **双存储策略**: Session 和 AnalysisSession 均提供 memory (开发快速启动) 和 postgres (持久化) 两种实现
- **安全边界**: `sanitizeNextPath()` 防止 Open Redirect；所有重定向限制在 `/workspace` 路径下
- **权限模型**: `PermissionScope` 定义组织、项目、区域、角色四维权限边界

## Development Workflow

- 测试文件按 Story 编号命名: `tests/story-{epic}-{story}-{name}.test.mjs`
- 数据库 schema 定义在 `src/infrastructure/postgres/schema/`，通过 `drizzle-kit generate` 生成迁移
- 本地 Postgres 端口默认 55432 (避免与系统 Postgres 冲突)
- `ENABLE_DEV_ERP_AUTH=1` 仅用于本地开发联调
- 新增领域概念时，按 `domain → application → infrastructure → app` 顺序依次实现

## Key Conventions

- 语言: 代码注释和 UI 使用中文，代码标识符使用英文
- 错误消息使用中文，面向最终用户
- 所有基础设施端口仅绑定 `127.0.0.1`，不暴露到局域网
- Session 存储支持 memory (开发) 和 postgres (持久化) 两种实现
- 分析会话存储同样支持 memory 和 postgres 双实现
- Next.js 路由使用括号路由组: `(auth)`, `(workspace)`, `(admin)`
