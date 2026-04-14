# Ontology Agent (DIP3 - 智慧数据)

面向物业分析团队的 AI 原生数据工作台。行为规范见 [`AGENTS.md`](./AGENTS.md)，本文件侧重项目技术参考。

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

Clean Architecture (六边形架构)，依赖方向：`domain` ← `application` ← `infrastructure` ← `app`

| 层 | 职责 | 备注 |
|---|---|---|
| `domain` | 纯 TS 模型和业务策略 | 无外部依赖 |
| `application` | ports (接口) + use-cases | 每个模块含 `ports.ts` / `use-cases.ts` |
| `infrastructure` | 适配器实现 (Postgres, Redis, ERP) | Session / AnalysisSession 提供 memory + postgres 双实现 |
| `app` | Next.js App Router | 组装依赖，处理 HTTP |

- 路径别名: `@/*` → `./src/*`
- 安全: `sanitizeNextPath()` 防止 Open Redirect，重定向限 `/workspace` 下
- 权限: `PermissionScope` 定义组织、项目、区域、角色四维边界

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19
- **Language**: TypeScript 5, strict mode
- **Database**: PostgreSQL 18 + Drizzle ORM 0.45
- **Cache**: Redis 8
- **Styling**: Tailwind CSS 4
- **Package Manager**: pnpm
- **Runtime**: Node.js 24
- **Container**: Docker Compose

## Setup & Commands

```bash
pnpm install                    # 安装依赖
cp .env.example .env            # 创建环境变量
docker compose up -d postgres redis  # 启动基础设施
pnpm db:migrate                 # 数据库迁移
pnpm dev                        # 开发服务器
```

```bash
pnpm build                      # 生产构建
pnpm lint                       # ESLint 检查
pnpm lint:fix                   # 自动修复 lint
pnpm db:generate                # 生成 Drizzle 迁移
pnpm db:studio                  # Drizzle Studio
docker compose up -d            # 全容器模式
docker compose down -v          # 停止并清理数据卷
```

## Testing

测试文件: `tests/story-{epic}-{story}-{name}.test.mjs`

已有覆盖:
- Story 1.1-1.6: 认证、工作台、分析会话、历史、权限边界
- Story 2.1-2.4: Docker Compose、Drizzle schema、会话持久化
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

## Domain Errors

领域层专用错误类（中文消息，面向终端用户）:

- `InvalidErpCredentialsError` — ERP 身份校验失败
- `WorkspaceAuthorizationError` — 账号无分析权限
- `DevErpAuthDisabledError` — 开发认证入口未开放

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
