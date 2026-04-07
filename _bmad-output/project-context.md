---
project_name: 'ontology-agent'
user_name: 'Delldi'
date: '2026-03-25'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
existing_patterns_found: 7
status: 'complete'
rule_count: 23
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
- 当前测试栈是 `node:test`，以真实 `next dev` 进程做集成验证
- 当前已落地基础设施是开发期内存适配器：
  - ERP 登录：`src/infrastructure/erp-auth/dev-erp-auth-adapter.ts`
  - 会话存储：`src/infrastructure/session/memory-session-store.ts`
  - 分析会话存储：`src/infrastructure/analysis-session/memory-analysis-session-store.ts`
- 架构文档里提到的 `Postgres / Cube / Neo4j / Redis / Worker` 目前仍是规划方向，不是已接线事实；实现时必须以仓库现状为准

## 关键实现规则

### 语言与分层规则

- 业务概念优先放在 `src/domain`，应用用例与端口放在 `src/application`，外部适配器放在 `src/infrastructure`，共享格式化/辅助函数放在 `src/shared`
- 不要把权限、范围判断、输入校验直接散写在页面组件中；应抽到领域或应用层，例如当前的 `scope-boundary` 与 `analysis-session` 模型
- 所有浏览器提交的身份与权限字段都不可信；创建分析会话等写操作必须从服务端会话读取用户身份
- 统一使用项目已有的 `@/*` 别名；不要新引入相对路径地狱
- 输入文本要走统一归一化与校验逻辑，当前已有 `normalizeQuestionText()`、`validateQuestionText()` 和范围策略

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
- 这类测试会各自启动 `next dev`，所以多文件回归必须串行执行：
  - 使用 `node --test --test-concurrency=1 ...`
- 测试重点不是纯函数单测，而是用户路径：
  - 登录/登出
  - 受保护路由跳转
  - 会话创建与回看
  - 跨用户隔离
  - 产品范围边界
- 新故事实现后，至少补对应 story 测试，并跑完整回归 + `pnpm lint` + `pnpm build`

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
- story 文档里只补真实发生的实现与验证，不要伪造未执行的内容
- 当前仓库允许“架构文档与代码状态短暂不一致”，但实现时必须明确记录偏差，而不是默默改写历史
- 当用户明确指定实现路线时，以用户最新决定为准；例如本项目实际初始化已改为官方 `create-next-app`，虽然早期文档曾写“手工初始化”

### 智能体与框架规则

- 当前默认策略是：**先保持自有编排边界，不提前引入重型智能体框架**。
- 当前应优先复用并扩展这些自有层：
  - `LLM Provider Adapter`
  - `Prompt Registry / Structured Output Guardrails`
  - `Tool Registry + Orchestration Bridge`
  - `Worker + Redis`
- 在 `Epic 5` 之前，不要主动引入 `Vercel AI SDK`、`LangGraph`、`LangChain`、`AutoGen` 或 Google ADK 作为系统底座。
- 只有在 `Epic 5` 开始需要明显更强的流式 UI、token streaming、tool call 结果渲染时，才考虑引入 `Vercel AI SDK`，且只作为 **Next.js 交互层增强**，不接管服务端业务编排。
- 若在 `Epic 5` 引入 `Vercel AI SDK`，必须先定义稳定的 `execution event envelope` 与 `render block / message part schema`，不要把原始 SSE payload 直接固化为页面最终状态结构。
- `PC` 与移动端应共享同源的结果 render schema；移动端只能做受限投影，不应维护第二套独立结果协议。
- 交互层的 canonical source of truth 仍然是服务端 execution events 与持久化结果模型，而不是 client component 的本地临时状态。
- 只有当以下故事阶段暴露出“执行图状态”复杂度时，才考虑升级到 `LangGraph`：
  - `5.2` 流式执行进度与阶段结果
  - `5.4` 持久化步骤结果与最终结论
  - `6.2` 增加因素或缩小范围
  - `6.3` 用户修正后重规划
  - `6.4` 保留多轮历史
- 判断是否该引入 `LangGraph` 的真实信号是：
  - 需要从中间状态恢复执行
  - 需要复杂分支和重规划
  - 需要人工确认点
  - `Worker + Redis + Tool Registry` 已经不足以优雅表达执行流程
- 当前不应把 `LangChain`、`AutoGen`、Google ADK 作为主实现方向；如后续确有需要，也应先通过架构决策再引入。

### 关键不要遗漏的规则

- 当前开发期 ERP 认证 stub 仍然过宽，任何实现都不要把它误当成生产安全方案
- `sanitizeNextPath()` 当前过滤仍偏宽；涉及登录跳转时不要继续放大这个风险
- 目前所有持久化都是内存级别：
  - 进程重启会丢
  - 多实例不会共享
  - 不要把它当成真实数据库行为
- 产品范围必须始终明确：
  - 支持：收费、工单、投诉、满意度等物业分析
  - 不支持：客服系统、CRM、营销、呼叫中心
- 任何新分析能力都不能绕过这个范围边界；优先复用 `src/domain/scope-boundary/policy.ts`
- 当前实现事实优先于早期规划文本，特别是以下差异要注意：
  - Postgres、Redis、Worker 与服务端 LLM adapter 已经接入
  - Cube / Neo4j / ERP 只读防腐层仍未接入
  - 认证仍为开发 stub
- 做 code review 时，优先关注：
  - 权限绕过
  - 跨用户数据泄露
  - Route Handler 是否信任了浏览器输入
  - 新测试是否忘了串行跑

---

## 使用说明

**对 AI 代理：**

- 在实现任何新故事或改动前先读这份文件
- 当文档、架构和代码现状冲突时，优先以当前仓库代码和最新用户指令为准
- 有疑问时，选择更保守、更服务端边界明确的实现

**对人类维护者：**

- 当技术栈、边界规则或 BMAD 开发流程发生变化时更新本文档
- 保持精简，只记录 AI 容易做错的部分
- 当 Postgres、Redis、Worker、真实 ERP 认证等真正落地后，及时替换这里的“当前仍未接入”说明

Last Updated: 2026-03-30
