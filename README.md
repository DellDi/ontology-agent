# Ontology Agent (DIP3 - 智慧数据)

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js 16">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/TailwindCSS-4-38B2AC?style=flat-square&logo=tailwind-css" alt="Tailwind CSS 4">
  <img src="https://img.shields.io/badge/Drizzle%20ORM-0.45-C5F74F?style=flat-square&logo=drizzle" alt="Drizzle ORM">
  <img src="https://img.shields.io/badge/PostgreSQL-18-336791?style=flat-square&logo=postgresql" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Redis-8-DC382D?style=flat-square&logo=redis" alt="Redis">
</p>

<p align="center">
  <b>面向物业分析团队的 AI 原生数据工作台</b>
</p>

<p align="center">
  <a href="#-核心特性">核心特性</a> •
  <a href="#-技术架构">技术架构</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-项目结构">项目结构</a> •
  <a href="#-环境变量">环境变量</a>
</p>

---

## 🎯 核心特性

- **AI 驱动分析** — 集成 LLM 智能体，支持结构化分析意图解析与多步推理
- **对话式数据探索** — 自然语言交互，自动提取分析上下文与候选因素
- **可视化分析流程** — 生成并展示分析计划，实时流式输出执行进度
- **因果结论推理** — 基于证据的排名因果结论生成与置信度评估
- **多轮会话支持** — 支持追问、修正因素、重新规划，完整保留历史上下文
- **企业级权限** — 四维权限模型（组织/项目/区域/角色），服务端授权强制
- **可扩展架构** — Clean Architecture + 六边形架构，领域与基础设施完全解耦
- **异步任务队列** — Redis 队列 + Worker 处理长时间分析任务

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         App Layer (Next.js)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  (auth)  │  │(workspace)│  │   API    │  │  Analysis    │   │
│  │  Login   │  │   Home   │  │  Routes  │  │   Sessions   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                        │
│  ┌─────────────┐ ┌───────────┐ ┌───────────┐ ┌────────────┐   │
│  │   Postgres  │ │   Redis   │ │  Session  │ │ERP Auth ACL│   │
│  │  (Drizzle)  │ │   Cache   │ │   Store   │ │  Adapter   │   │
│  └─────────────┘ └───────────┘ └───────────┘ └────────────┘   │
│  ┌─────────────┐ ┌───────────┐ ┌───────────┐ ┌────────────┐   │
│  │Job Queue    │ │ Neo4j     │ │ Cube.js   │ │ LLM        │   │
│  │ (Redis)    │ │ (Graph)   │ │ Semantic  │ │ Providers  │   │
│  └─────────────┘ └───────────┘ └───────────┘ └────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Application Layer                            │
│                    (Use Cases & Ports)                         │
│         Analysis Session  │  Auth  │  Job Queue  │  Workspace  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Domain Layer                               │
│              Pure Models, Business Rules, Policies             │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 前置要求

- **Node.js** ≥ 24
- **pnpm** ≥ 9
- **Docker** & **Docker Compose**

### 1. 克隆与安装

```bash
git clone https://github.com/your-org/ontology-agent.git
cd ontology-agent
pnpm install
```

### 2. 环境配置

```bash
cp .env.example .env
# 编辑 .env，配置你的 LLM API Key 和会话密钥
```

### 3. 启动基础设施

```bash
# 后台启动 PostgreSQL + Redis
docker compose up -d postgres redis
```

### 4. 数据库迁移

```bash
pnpm db:migrate
```

### 5. 启动开发服务器

```bash
# 终端 1: Web 服务
pnpm dev

# 终端 2: Worker 队列处理器
pnpm worker:dev
```

访问 <http://localhost:3000> 🎉

### 全容器模式

```bash
# 一键启动全部服务 (Web + Worker + Postgres + Redis)
docker compose up -d

# 查看日志
docker compose logs -f web worker

# 停止并清理
docker compose down -v
```

## 📁 项目结构

```tree

ontology-agent/
├── src/
│   ├── app/                    # Next.js App Router (表现层)
│   │   ├── (auth)/login/       # 认证入口
│   │   ├── (workspace)/        # 工作台路由组
│   │   │   ├── workspace/      # 分析会话主界面
│   │   │   └── _components/    # 工作台私有组件
│   │   └── api/                # API 路由
│   │       ├── auth/           # 登录/登出/回调
│   │       └── analysis/       # 分析会话 API
│   ├── domain/                 # 领域层 — 纯模型与策略
│   │   ├── auth/               # 认证模型 & 错误定义
│   │   ├── analysis-session/   # 分析会话聚合根
│   │   └── scope-boundary/     # 数据权限边界策略
│   ├── application/            # 应用层 — 用例与端口
│   │   ├── auth/               # ports.ts + use-cases.ts
│   │   ├── analysis-session/   # 分析会话用例
│   │   └── job/                # 任务队列用例
│   ├── infrastructure/         # 基础设施层 — 适配器实现
│   │   ├── postgres/           # Drizzle client & schema
│   │   ├── redis/              # Redis 客户端与队列
│   │   ├── session/            # 会话存储 (memory/postgres)
│   │   └── erp-auth/           # ERP 认证开发适配器
│   ├── shared/                 # 共享工具
│   │   └── permissions/        # 权限摘要格式化
│   └── worker/                   # 后台任务处理器
│       ├── main.ts             # Worker 入口
│       └── handlers/           # 任务处理器注册表
├── drizzle/                    # 数据库迁移文件
├── tests/                      # Story-based 测试
├── docs/                       # 项目文档
└── compose.yaml                # Docker Compose 编排
```

## ⚙️ 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `APP_PORT` | 应用端口 | `3000` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | 见 `.env.example` |
| `REDIS_URL` | Redis 连接字符串 | `redis://127.0.0.1:6379` |
| `SESSION_SECRET` | 会话签名密钥 (必填) | - |
| `ENABLE_DEV_ERP_AUTH` | 开发联调登录开关 | `1` |
| `LLM_PROVIDER_BASE_URL` | LLM API 基础 URL | DashScope |
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key (必填) | - |
| `LLM_PROVIDER_MODEL` | 主模型 | `bailian/kimi-k2.5` |
| `LLM_FALLBACK_MODELS` | 降级模型列表 | 见配置 |
| `LLM_REQUEST_TIMEOUT_MS` | 请求超时 | `15000` |
| `LLM_RATE_LIMIT_MAX_REQUESTS` | 速率限制 | `20/60s` |

## 🧪 常用命令

```bash
# 开发
pnpm dev                    # 启动 Next.js 开发服务器
pnpm worker:dev             # 启动 Worker 队列处理器

# 数据库
pnpm db:generate            # 生成 Drizzle 迁移
pnpm db:migrate             # 执行数据库迁移
pnpm db:studio              # 打开 Drizzle Studio 数据浏览器

# 代码质量
pnpm lint                   # ESLint 检查
pnpm lint:fix               # 自动修复 lint 问题
pnpm build                  # 生产构建

# 容器
docker compose up -d        # 后台启动全部容器
docker compose down -v      # 停止并清理数据卷
```

## 🧬 核心设计原则

| 原则 | 说明 |
| --- | --- |
| **Clean Architecture** | `domain` → `application` → `infrastructure` → `app` 单向依赖 |
| **Ports & Adapters** | 应用层定义接口(ports)，基础设施层提供适配器实现 |
| **双存储策略** | Session 和 AnalysisSession 均支持 memory (开发) 和 postgres (生产) |
| **安全边界** | `sanitizeNextPath()` 防 Open Redirect；服务端强制授权 |
| **中文优先** | 错误消息面向终端用户，使用中文；代码标识符使用英文 |

## 🧪 测试

测试采用 Story-based 命名规范:

```bash
tests/story-{epic}-{story}-{name}.test.mjs
```

**已覆盖场景:**

- Story 1.1-1.6: 基础功能 (认证、工作台、分析会话、历史、权限边界)
- Story 2.1-2.7: 基础设施 (Docker、Drizzle、会话持久化、Worker 骨架)
- Story 3.1-3.5: 分析意图 (结构化意图、上下文提取、因素扩展、分析计划)
- Story 4.1-4.6: 数据集成 (LLM 适配器、ERP ACL、Cube 语义层、Neo4j 图适配)
- Story 5.1-5.4: 执行引擎 (计划提交、流式进度、因果结论、结果持久化)
- Story 6.1-6.4: 多轮对话 (追问、修正、重新规划、历史保留)
- Story 7.1-7.4: 安全与运维 (授权、审计、部署、监控)

## 📝 更新日志

查看 [CLAUDE.md](./CLAUDE.md) 获取详细的项目架构说明和开发规范。

## 🤝 贡献

欢迎提交 Issue 和 PR！

## 📄 许可证

MIT License
