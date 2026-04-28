---
project_name: 'ontology-agent'
user_name: 'Delldi'
date: '2026-04-27'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'ai_runtime_rules', 'anti_patterns']
existing_patterns_found: 8
status: 'complete'
rule_count: 38
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
- `Vercel AI SDK ai 5.0.179` 已作为 AI application runtime layer 进入 Epic 10，但不是业务编排事实源
- `OpenAI SDK 6.33.0`，通过服务端 `LLM Provider Adapter` 接入兼容协议
- 当前测试主栈是 `node:test` / `tsx --test`，story 测试以真实 `next build + next start`、真实 worker、真实 Redis/Postgres/Neo4j/Cube 链路做集成验证
- 当前已接线、已在仓库中真实使用的基础设施包括：
  - `Postgres`：平台表、会话、执行快照、follow-up、graph sync 运行时元数据
  - `Redis`：job queue、execution event stream、worker 协作
  - `Worker`：异步分析执行、执行收尾、follow-up 历史挂接
  - `Cube`：语义查询适配、收费类双口径与时间语义
  - `Neo4j`：图谱查询、baseline/org/incremental/dispatch/consistency sweep 同步链路
- 仍然是开发 stub 或待正式化的部分要明确区分：
  - ERP 登录认证仍是开发 stub，不可视为生产安全方案
  - Epic 7 的授权、审计、容器交付、观测、登录桥接已完成故事级交付，但这不等于 ERP 登录 stub 已具备生产安全属性

## 关键实现规则

### 语言与分层规则

- 业务概念优先放在 `src/domain`，应用用例与端口放在 `src/application`，外部适配器放在 `src/infrastructure`，共享格式化/辅助函数放在 `src/shared`
- 不要把权限、范围判断、输入校验直接散写在页面组件中；应抽到领域或应用层，例如当前的 `scope-boundary` 与 `analysis-session` 模型
- 所有浏览器提交的身份与权限字段都不可信；创建分析会话等写操作必须从服务端会话读取用户身份
- 统一使用项目已有的 `@/*` 别名；不要新引入相对路径地狱
- 输入文本、追问上下文、follow-up 条件调整都要走统一归一化与校验逻辑；不要在 UI 上直接拼业务语义
- 新能力默认按 `domain -> application -> infrastructure -> app` 增量扩展；不要把执行编排、图同步、审计语义塞进 route 或 component
- schema 与 migration 必须同步；任何 Drizzle schema 变更都必须同时补迁移，不允许只改 TypeScript schema

### Next.js / App Router 规则

- 默认采用服务端优先模式；只有在确实需要浏览器状态或 Web API 时才引入 Client Component
- 受保护页面沿用现有模式：页面里调用 `requireRequestSession()` 或 `requireWorkspaceSession()`，未登录通过 `redirect()` 回到 `/login`
- Route Handler 负责服务端写操作、权限解析、审计与重定向；不得信任浏览器传来的 `userId / organizationId / scope`
- 已有路由分组语义不要打乱：
  - `(auth)`：登录相关
  - `(workspace)`：PC 分析工作台
  - `(admin)`：预留后台
- 不要再尝试创建与现有 `/` 冲突的 `(workspace)/page.tsx`；当前工作台首页实际落在 `/workspace`
- Next 服务端 API 要遵守当前版本约定：如 `cookies()` 已经是异步调用
- 执行发起策略遵守 `blocking vs non-blocking`：权限冲突、核心实体冲突、核心指标冲突才阻断；普通时间/比较基线缺省应带 assumption trace 继续执行

### 测试规则

- 该项目当前以“故事级集成测试”驱动实现，每个故事对应 `tests/story-*.test.mjs` 或 `tests/story-*.test.mts`
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
- `10.x` 交互/runtime 改动要回归 execution facts -> runtime projection -> renderer 消费链路，不能只测组件静态渲染

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
  - story 测试文件名固定 `story-x-y-*.test.mjs` 或 `story-x-y-*.test.mts`
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
- 当前 sprint 状态以 `sprint-status.yaml` 为准：
  - `Epic 7` 已 done
  - `Epic 8` 已合并到 `Story 10.5`
  - `Epic 9` 仍在推进，`9.3` 当前受 `10.1` runtime 接线阻塞，`9.7` 仍处 review
  - `Epic 10` 是当前 AI-native interaction/runtime 主线

### AI Runtime 与智能体框架规则

- 当前默认策略是：**先保持自有编排边界，不提前引入重型智能体框架**。
- 当前应优先复用并扩展这些自有层：
  - `LLM Provider Adapter`
  - `Prompt Registry / Structured Output Guardrails`
  - `Tool Registry + Orchestration Bridge`
  - `Worker + Redis`
- `Vercel AI SDK` 只能作为 AI application runtime / UI streaming adapter；不能覆盖业务编排、权限、审计、本体治理或执行历史事实
- 交互层的 canonical source of truth 仍然是服务端 execution events、snapshots、result blocks、follow-up/history facts、ontology registry 与 audit，而不是 client component 的本地临时状态
- `AI runtime projection` 是从事实到 UI message/part 的投影层；不得把 projection resume 误实现成“重跑执行”或“重建事实”
- `renderer registry` 是 rich analysis blocks 的统一消费层；新增 part 时要定义 stable part kind、schema version、contract version、placement/slot 语义与 fallback 行为
- `PC` 与移动端必须共享同源 interaction schema / render schema；移动端只能做受限投影，不能维护第二套消息协议
- `Story 10.5` 吸收原 Epic 8 移动端能力：最近摘要、关键证据、轻量追问都应附着到原会话与同源 schema
- process board / side sheet 属于可隐藏的专业执行过程面板；主阅读流优先展示结论、证据、assumptions 与可追问入口，不要回退成多面板堆叠
- `reasoning-summary` 只能展示受控摘要与可审计执行解释，不得暴露原始 chain-of-thought
- 当前已完成 `Epic 5 / 6 / 7` 与部分 `Epic 10`，但仍未授权引入 `LangGraph / LangChain / AutoGen / Google ADK` 作为系统底座。
- 只有当以下真实信号出现时，才考虑升级到更重的执行图框架：
  - 需要从中间状态恢复执行
  - 需要复杂分支和重规划
  - 需要人工确认点
  - `Worker + Redis + Tool Registry` 已经不足以优雅表达执行流程
- 当前不应把 `LangChain`、`AutoGen`、Google ADK 作为主实现方向；如后续确有需要，也应先通过架构决策再引入。

### 本体治理与数据事实规则

- ontology registry / approved runtime package 是工具选择、context grounding、metric variant、factor、time semantics 的治理事实源
- `9.3` 的 grounding 契约会影响 `10.1` runtime 与 `10.6` blocking/assumption 判定；改动 issue type 或 version 绑定时必须同步 runtime projection 与测试
- `9.6` 要把 execution / follow-up / history 绑定到 ontology version；不得让历史回看随当前 ontology 漂移
- graph sync 当前采用 `baseline/org rebuild + incremental dirty scope + scheduler/dispatch + consistency sweep`，不是逐条 CDC patch 图
- graph sync 运行入口必须复用正式 use case 与 run metadata；不要绕过 `7.6 / 7.7 / 7.8` 的受控路径直接写 Neo4j

### 关键不要遗漏的规则

- 当前开发期 ERP 认证 stub 仍然过宽，任何实现都不要把它误当成生产安全方案
- `sanitizeNextPath()` 当前过滤仍偏宽；涉及登录跳转时不要继续放大这个风险
- 产品范围必须始终明确：
  - 支持：收费、工单、投诉、满意度等物业分析
  - 不支持：客服系统、CRM、营销、呼叫中心
- 任何新分析能力都不能绕过这个范围边界；优先复用 `src/domain/scope-boundary/policy.ts`
- 当前实现事实优先于早期规划文本，特别是以下差异要注意：
  - `Postgres / Redis / Worker / Cube / Neo4j / Graph Sync Runtime / Follow-up History / Audit / Observability / AI Runtime` 都已接线或进入当前主线
  - 分析执行结果、follow-up、graph sync 运行元数据都已经是数据库事实，不是内存假状态
  - 认证与服务端授权不是一回事：登录仍有开发 stub，但服务端授权、审计、观测链路已有正式故事交付
- 当前 `Epic 8` 已合并到 `10.5`；任何移动端分析能力都不要新建独立协议或独立事实存储
- 当前 `Epic 9` 未完全闭环；不要把 ontology governance 当成全部完成，也不要绕过 approved runtime package
- 当前 `Epic 10` 已经把交互主线从“页面局部状态”推进到 runtime projection / renderer registry；不要在 UI 组件里重新手写结论、状态、timeline 派生规则
- 做 code review 时，优先关注：
  - 权限绕过
  - 跨用户数据泄露
  - Route Handler 是否信任了浏览器输入
  - follow-up / execution / history 是否引用了错误轮次事实
  - runtime projection 是否覆盖或伪造 canonical facts
  - PC/mobile 是否出现第二套 render schema
  - ontology version 是否在执行、追问、历史之间漂移
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
- 当 Epic 状态、测试编排方式、graph sync 运行模型、AI runtime/schema 或授权边界发生变化时，及时替换这里的“当前事实”说明

Last Updated: 2026-04-27
