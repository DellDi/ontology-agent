# Ontology Agent (DIP3 - 智慧数据)

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js 16">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/TailwindCSS-4-38B2AC?style=flat-square&logo=tailwind-css" alt="Tailwind CSS 4">
  <img src="https://img.shields.io/badge/Java%2021-ED8B00?style=flat-square&logo=openjdk" alt="Java 21">
  <img src="https://img.shields.io/badge/Spring%20Boot%204.1-6DB33F?style=flat-square&logo=spring" alt="Spring Boot 4.1">
  <img src="https://img.shields.io/badge/Flyway-CC0200?style=flat-square&logo=flyway" alt="Flyway">
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
- **异步任务队列** — PostgreSQL durable job ledger + Redis 唤醒 + Java Worker 处理长时间分析任务

## 🏗️ 技术架构

```
Next.js 16 / React 19（仅页面渲染、Java BFF、Web 观测与 UI 映射）
  ├─ Web 工作台
  └─ 透明 API Adapter（含全部认证路由）
          │
          ▼
Java 21 / Spring Boot 4.1 / Spring AI 2.0
  ├─ 认证：登录 / 退出 / ERP 目录与权限范围解析 / Session
  ├─ Main Agent ──唯一一次 tool call──▶ Analysis Workflow
  ├─ Analysis / Follow-up / Ontology / Graph Sync / Read API
  └─ Domain → Application Ports → Infrastructure Adapters
          │
          ├─ PostgreSQL（业务与任务事实源，Flyway 迁移）
          ├─ Redis（任务唤醒）
          ├─ Cube（语义指标）
          ├─ Neo4j（受权限约束的图上下文）
          ├─ ERP（组织、项目与 ACL）
          └─ OpenAI-compatible / Alibaba DashScope Provider
```

## 🚀 快速开始

### 前置要求

- **Node.js** ≥ 24
- **pnpm** 11.7.0（由 `packageManager` + Corepack 固定）
- **JDK** 21（推荐由 mise 管理）
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
# 后台启动 PostgreSQL + Redis + Cube + Neo4j
docker compose up -d postgres redis cube neo4j
```

### 4. 数据库初始化

数据库所有权归 Java backend：初始化脚本为 `backend-java/src/main/resources/db/migration/V1__init.sql`
（由原 Drizzle 全部历史迁移合并而成，脚本本身幂等，可重复执行），由 Flyway 独立入口执行（应用启动不自动迁移）。

```bash
pnpm db:migrate   # 等价于 mvn -f backend-java/pom.xml spring-boot:run -Dspring-boot.run.profiles=migrate
```

> 定位为新库重建与初始化的 init 脚本：全新空库一次性建齐全部 schema/表/索引；
> 已初始化的库重复执行是幂等 no-op（Flyway 历史校验）；无 Flyway 历史的旧库直接补全缺失列/索引，
> 不会丢数据。后续 schema 变更新增 `V{n}__*.sql`（V2+）。

### 5. 启动开发服务器

```bash
# 终端 1: Web 服务
pnpm dev

# 终端 2: Java API + Worker（JDK 21）
mise exec java@temurin-21.0.12+8.0.LTS --% -- mvn -f backend-java/pom.xml spring-boot:run
```

访问 <http://localhost:3000> 🎉

### 全容器模式

```bash
# 一键启动全部服务（Web + Java backend/worker + 基础设施）
docker compose up -d

# 查看日志
docker compose logs -f web backend

# 停止并清理
docker compose down -v
```

## 📁 项目结构

```tree
ontology-agent/
├── src/
│   ├── app/                             # Next.js UI 与 Java API 透明代理（含认证路由）
│   ├── infrastructure/java-backend/     # Java API 客户端与跨端契约
│   └── infrastructure/observability/    # Web 观测
├── backend-java/src/main/java/          # Java features、ports 与 adapters（含认证）
├── backend-java/src/main/resources/db/migration/  # Flyway V1__init.sql（幂等初始化脚本）
├── contracts/backend/                   # Web / Java 共享契约
├── tests/                               # 跨端契约与仍有效的前端行为验证
├── docs/                                # 架构、运行与部署文档
├── compose.yaml                         # 本地联调拓扑（migrate 走 Java Flyway）
└── compose.prod.yaml                    # 生产容器拓扑
```

## ⚙️ 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `APP_PORT` | 应用端口 | `3000` |
| `JAVA_DATABASE_URL` | Java backend PostgreSQL 连接（`POSTGRES_*` 派生） | 见 `.env.example` |
| `REDIS_URL` | Redis 连接字符串（仅供 Java backend） | `redis://127.0.0.1:6379` |
| `SESSION_SECRET` | 会话签名密钥 (必填，Java backend) | - |
| `ENABLE_DEV_ERP_AUTH` | 开发联调登录开关（Java backend） | `0` |
| `ERP_API_BASE_URL` | ERP 目录认证接口（Java backend，登录必需） | - |
| `COOKIE_SECURE` | 会话 Cookie 是否 Secure（生产置 `true`） | `false` |
| `LLM_PROVIDER_BASE_URL` | OpenAI-compatible API 基础 URL | `https://api.openai.com/v1` |
| `LLM_PROVIDER_API_KEY` | Provider API Key (必填) | - |
| `LLM_PROVIDER_MODEL` | 主模型 (必填) | - |
| `LLM_PROVIDER_MODE` | `openai-compatible` 或 `dashscope` | `openai-compatible` |
| `LLM_PROVIDER_TOOL_CALLING` | Main Agent tool calling 能力门禁 | `true` |
| `LLM_PROVIDER_STRUCTURED_OUTPUT` | 结构化输出模式 | `native-json-schema` |
| `JAVA_BACKEND_URL` | Next.js 调用 Java API 的地址 | `http://127.0.0.1:8080` |
| `CUBE_API_URL` / `NEO4J_URI` | Java backend 的数据适配器地址 | 见 `.env.example` |
| `GRAPH_SYNC_OPS_SECRET` | 图同步运维接口密钥 | - |

## 🧪 常用命令

```bash
# 开发
pnpm dev                    # 启动 Next.js 开发服务器
mise exec java@temurin-21.0.12+8.0.LTS --% -- mvn -f backend-java/pom.xml spring-boot:run

# 数据库（Flyway，Java 独立迁移入口，幂等可重复执行）
pnpm db:migrate             # 执行初始化（空库建齐 / 已有库幂等补全）

# 代码质量
pnpm lint                   # ESLint 检查
pnpm lint:fix               # 自动修复 lint 问题
pnpm build                  # 生产构建
pnpm test                   # Java + 当前 Web/Java 契约门禁
pnpm test:web               # Web / Java 契约与切换边界
pnpm test:container         # 完整生产容器验收
pnpm test:live:analysis     # 真实 Provider / Cube / Neo4j 分析门禁

# 容器
docker compose up -d        # 后台启动全部容器
docker compose down -v      # 停止并清理数据卷
```

## 🧬 核心设计原则

| 原则 | 说明 |
| --- | --- |
| **Feature + Ports & Adapters** | Java 按业务 feature 组织，业务规则只依赖 application ports |
| **单一事实源** | PostgreSQL 保存会话、执行与任务事实；Redis 只负责唤醒，不保存 canonical job data |
| **Main Agent + Workflow Tool** | Main Agent 只调用一次 workflow tool，确定性工作流负责权限、取数和持久化 |
| **Fail Loud** | Provider、契约、权限或数据错误明确失败，不切模型、不生成替代答案、不返回伪成功 |
| **前端边界** | Next.js 只负责展示、Java BFF 透明代理、Web 观测与 UI 映射；认证、数据库与全部业务实现由 Java 承载 |
| **安全边界** | `sanitizeNextPath()` 防 Open Redirect；服务端强制授权 |
| **中文优先** | 错误消息面向终端用户，使用中文；代码标识符使用英文 |

## 🧪 测试

后端测试位于 `backend-java/src/test/java`；Web / Java 边界测试位于 `tests/java-*.test.mjs`；仍有效的前端行为测试继续采用 Story-based 命名：

```bash
tests/story-{epic}-{story}-{name}.test.mjs
```

**已覆盖场景:**

- Java：认证（登录/退出/ERP 目录与权限范围解析/Session）、Main Agent、Workflow、首次分析、追问、持久化、权限、Ontology Governance 与 Graph Sync；Flyway 幂等初始化脚本（合并单文件、可重复执行）。
- 真实基础设施：PostgreSQL 17、Neo4j 5、Redis job wakeup 与生产 Compose。
- 跨端契约：Draft 2020-12 JSON Schema、Next Zod、透明 Route Adapter（含认证路由与 Set-Cookie 透传）与移动端 view model。
- 前端：登录、工作台、SSE、历史轮次、权限展示与管理页面交互。

## 🔒 安全说明

`scripts/pgloader/migrate-node-fast.mjs` 曾包含硬编码的远端 MySQL 连接凭据，该文件已从仓库移除，但
**凭据已进入 Git 历史**。请立即轮换对应 MySQL 账号/密码（以及历史 PostgreSQL 开发账号密码），
并确认该连接串未出现在任何第三方日志、CI 缓存或公开镜像中。仓库未重写 Git 历史；若需要彻底清除，
需使用 `git filter-repo` 并协调所有协作者强制更新远端。

## 📝 更新日志

查看 [AGENTS.md](./AGENTS.md) 获取工程规范；三阶段目标与验收证据见 [Java 后端三阶段收口](./docs/java-backend-phase-3-operational-closure.md)。

## 🤝 贡献

欢迎提交 Issue 和 PR！

## 📄 许可证

MIT License
