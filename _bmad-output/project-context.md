---
project_name: 'ontology-agent'
user_name: 'Delldi'
date: '2026-04-09'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
existing_patterns_found: 7
status: 'complete'
rule_count: 29
optimized_for_llm: true
---

# AI 代理项目上下文

_本文档用于记录 AI 代理在本项目中实现代码时必须遵守的关键规则、模式和边界。仅保留容易被忽略、但会影响实现一致性的内容。_

---

## 技术栈与版本

- `Next.js 16.2.1` + `React 19.2.4` + `React DOM 19.2.4`
- `TypeScript 5`，`tsconfig` 开启 `strict: true`，使用 `@/* -> src/*` 路径别名
- `ESLint 9` + `eslint-config-next 16.2.1`
- `Tailwind CSS 4`（通过 `@tailwindcss/postcss`）
- `Drizzle ORM 0.45.1` + `PostgreSQL 8.20.0` + `Redis 5.11.0` + `neo4j-driver 6.0.1`
- `OpenAI SDK 6.33.0`，通过服务端 `LLM Provider Adapter` 接入兼容协议
- 当前测试主栈是 `node:test`，story 测试以真实 `next build + next start`、真实 worker、真实 Redis/Postgres/Neo4j/Cube 链路做集成验证
- 当前已接线、已在仓库中真实使用的基础设施包括：
  - `Postgres`：平台表、会话、执行快照、follow-up、graph sync 运行时元数据
  - `Redis`：job queue、execution event stream、worker 协作
  - `Worker`：异步分析执行、执行收尾、follow-up 历史挂接
  - `Cube`：语义查询适配、收费类双口径与时间语义
  - `Neo4j`：图谱查询、baseline/org/incremental/dispatch/consistency sweep 同步链路
- 仍然是开发 stub 或待正式化的部分要明确区分：
  - ERP 登录认证仍是开发 stub，不可视为生产安全方案
  - Epic 7 主线中的服务端授权、审计、容器交付、观测、登录桥接尚未完成

## 关键实现规则

### 语言与分层规则

- 业务概念优先放在 `src/domain`，应用用例与端口放在 `src/application`，外部适配器放在 `src/infrastructure`，共享格式化/辅助函数放在 `src/shared`
- 不要把权限、范围判断、输入校验直接散写在页面组件中；应抽到领域或应用层，例如当前的 `scope-boundary` 与 `analysis-session` 模型
- 所有浏览器提交的身份与权限字段都不可信；创建分析会话等写操作必须从服务端会话读取用户身份
- 统一使用项目已有的 `@/*` 别名；不要新引入相对路径地狱
- 输入文本、追问上下文、follow-up 条件调整都要走统一归一化与校验逻辑；不要在 UI 上直接拼业务语义
- 新能力默认按 `domain -> application -> infrastructure -> app` 增量扩展；不要把执行编排、图同步、审计语义塞进 route 或 component

### Next.js / App Router 规则

- 默认采用服务端优先模式；只有在确实需要浏览器状态或 Web API 时才引入 Client Component
- 受保护页面沿用现有模式：页面里调用 `requireRequestSession()` 或 `requireWorkspaceSession()`，未登录通过 `redirect()` 回到 `/login`
- Route Handler 负责服务端写操作与重定向，例如 `/api/analysis/sessions`
- 已有路由分组语义不要打乱：
  - `(auth)`：登录相关
  - `(workspace)`：PC 分析工作台
  - `(admin)`：预留后台
- 不要再尝试创建与现有 `/` 冲突的 `(workspace)/page.tsx`；当前工作台首页实际落在 `/workspace`
- Next 服务端 API 要遵守当前版本约定：如 `cookies()` 已经是异步调用

### 测试规则

- 该项目当前以“故事级集成测试”驱动实现，每个故事对应一个 `tests/story-*.test.mjs`
- `5.x / 6.x` 这类故事测试会走真实 `next build + next start` 路径，并串起 worker / Redis / Postgres / 外部适配器
- 这些 story 测试要串行执行：
  - 使用 `node --test --test-concurrency=1 ...`
- 多个 story 测试文件共享构建时，必须复用 `tests/helpers/ensure-next-build-ready.mjs`
  - 不要在每个测试文件里直接裸跑 `pnpm build`
  - 目标是避免 `Another next build process is already running` 这类假红
- 测试重点不是纯函数单测，而是用户路径：
  - 登录/登出
  - 受保护路由跳转
  - 会话创建与回看
  - 跨用户隔离
  - 产品范围边界
- 新故事实现后，至少补对应 story 测试，并跑与影响范围匹配的回归 + `pnpm lint` + `pnpm build`
- 交付前的“已完成”结论必须基于真实验证结果，而不是基于代码阅读或局部 smoke 判断

### 代码质量与风格规则

- 产品与文档输出语言当前统一为中文；新增页面文案、错误提示、帮助说明默认写中文
- 视觉和信息架构要延续 `DIP3 - 智慧数据` 的现有 UX 方向：
  - 明亮、高级、克制
  - PC 工作台三段式 / 指挥台语义
  - 不要做成传统 ERP 密集表格页
- 新增 UI 时要优先复用现有工作台语气：
  - `hero-panel`
  - `glass-panel`
  - `status-banner`
  - 品牌蓝白体系
- 命名保持现有模式：
  - 文件多用 kebab-case
  - 类型/组件用 PascalCase
  - story 测试文件名固定 `story-x-y-*.test.mjs`
- 尽量保持 ASCII 代码；只有中文产品文案和必要内容使用中文字符

### 开发工作流规则

- 如果是按 BMAD story 开发，代码完成后要同步更新：
  - 对应的 `_bmad-output/implementation-artifacts/*.md`
  - `_bmad-output/implementation-artifacts/sprint-status.yaml`
- Epic 完成后，要补 retrospective 工件；当前已有：
  - `epic-6-retro-2026-04-09.md`
- story 文档里只补真实发生的实现与验证，不要伪造未执行的内容
- 当前仓库允许“架构文档与代码状态短暂不一致”，但实现时必须明确记录偏差，而不是默默改写历史
- 当用户明确指定实现路线时，以用户最新决定为准；例如本项目实际初始化已改为官方 `create-next-app`，虽然早期文档曾写“手工初始化”
- 规划与交付顺序要以当前 sprint 工件为准；不要再引用已经过期的阶段性限制

### 智能体与框架规则

- 当前默认策略是：**先保持自有编排边界，不提前引入重型智能体框架**。
- 当前应优先复用并扩展这些自有层：
  - `LLM Provider Adapter`
  - `Prompt Registry / Structured Output Guardrails`
  - `Tool Registry + Orchestration Bridge`
  - `Worker + Redis`
- `PC` 与移动端应共享同源的结果 render schema；移动端只能做受限投影，不应维护第二套独立结果协议。
- 交互层的 canonical source of truth 仍然是服务端 execution events 与持久化结果模型，而不是 client component 的本地临时状态。
- 当前已完成 `Epic 5` 与 `Epic 6`，但仍未授权引入 `LangGraph / LangChain / AutoGen / Google ADK` 作为系统底座。
- 只有当以下真实信号出现时，才考虑升级到更重的执行图框架：
  - 需要从中间状态恢复执行
  - 需要复杂分支和重规划
  - 需要人工确认点
  - `Worker + Redis + Tool Registry` 已经不足以优雅表达执行流程
- 当前不应把 `LangChain`、`AutoGen`、Google ADK 作为主实现方向；如后续确有需要，也应先通过架构决策再引入。

### 关键不要遗漏的规则

- 当前开发期 ERP 认证 stub 仍然过宽，任何实现都不要把它误当成生产安全方案
- `sanitizeNextPath()` 当前过滤仍偏宽；涉及登录跳转时不要继续放大这个风险
- 产品范围必须始终明确：
  - 支持：收费、工单、投诉、满意度等物业分析
  - 不支持：客服系统、CRM、营销、呼叫中心
- 任何新分析能力都不能绕过这个范围边界；优先复用 `src/domain/scope-boundary/policy.ts`
- 当前实现事实优先于早期规划文本，特别是以下差异要注意：
  - `Postgres / Redis / Worker / Cube / Neo4j / Graph Sync Runtime / Follow-up History` 都已接线
  - 分析执行结果、follow-up、graph sync 运行元数据都已经是数据库事实，不是内存假状态
  - 认证与服务端授权不是一回事：登录仍有开发 stub，但 Epic 7 主线的真正授权与审计还没做完
- 当前 `Epic 7` 的执行顺序要明确区分主线与支线：
  - 主线优先级：`7.1 -> 7.2 -> 7.3/7.4 -> 7.5`
  - `7.6 ~ 7.8` 是图谱同步运行化支线，已完成，但不代表 Epic 7 主线已完成
- 图谱同步当前采用“baseline/org rebuild + incremental dirty scope + scheduler/dispatch”路线，不是逐条 CDC patch 图
- 做 code review 时，优先关注：
  - 权限绕过
  - 跨用户数据泄露
  - Route Handler 是否信任了浏览器输入
  - follow-up / execution / history 是否引用了错误轮次事实
  - graph sync 是否存在跨组织误删、cursor 前移过早、dirty scope 重建风暴
  - 新测试是否复用了共享构建入口、是否避免假红

---

## 使用说明

**对 AI 代理：**

- 在实现任何新故事或改动前先读这份文件
- 当文档、架构和代码现状冲突时，优先以当前仓库代码和最新用户指令为准
- 有疑问时，选择更保守、更服务端边界明确的实现

**对人类维护者：**

- 当技术栈、边界规则或 BMAD 开发流程发生变化时更新本文档
- 保持精简，只记录 AI 容易做错的部分
- 当 Epic 状态、测试编排方式、graph sync 运行模型或授权边界发生变化时，及时替换这里的“当前事实”说明

Last Updated: 2026-04-09
