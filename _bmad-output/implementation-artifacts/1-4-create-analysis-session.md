# Story 1.4: 创建新的分析会话

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在工作台中发起一个新的分析会话并输入自然语言问题,
so that 我可以从一个明确的分析上下文开始后续分析流程。

## Acceptance Criteria

1. 用户可从工作台点击“新建分析”并输入自然语言问题。
2. 系统创建新的分析会话记录，并保存问题原文、创建时间和用户标识。
3. 创建成功后，系统跳转到该分析会话页。
4. 在后续分析能力尚未执行前，问题文本作为会话起点被保留。

## Tasks / Subtasks

- [x] 建立分析会话领域模型与最小持久化结构（AC: 2, 4）
  - [x] 在 `src/domain/analysis-session` 定义会话实体或等价模型。
  - [x] 只创建本故事必需的最小持久化结构，例如 `analysis_sessions`。
  - [x] 会话记录至少包含 `id`、`owner_user_id`、`question_text`、`status`、`created_at`。
- [x] 提供创建会话的服务端入口（AC: 1, 2）
  - [x] 在 `src/app/api/analysis/sessions/route.ts` 提供创建接口或等价 Server Action。
  - [x] 服务端必须从当前会话读取用户身份，不信任浏览器提交的用户标识。
  - [x] 对空问题、超长问题或超范围主题返回明确错误。
- [x] 建立分析会话页面路由（AC: 3, 4）
  - [x] 创建 `src/app/(workspace)/analysis/[sessionId]/page.tsx`。
  - [x] 创建成功后从工作台跳转到该页面。
  - [x] 页面初始状态至少显示原问题文本和“待分析/未开始”状态。
- [x] 预留分析画布布局骨架（AC: 3, 4）
  - [x] 会话页初始结构应与 UX 中定义的 PC 三段式工作台方向兼容。
  - [x] 至少为“主分析区 / 证据辅助区 / 会话或导航区”预留稳定容器关系。
  - [x] 不用在本故事中完成完整证据与计划组件，但不能把会话页做成未来难以演进的单栏页面。
- [x] 接入范围边界与权限检查（AC: 1, 2, 4）
  - [x] 创建会话前校验用户已登录且处于受保护工作台上下文。
  - [x] 对明显超出物业分析范围的问题，可复用 Story 1.6 的边界判断能力或留出接入点。
- [x] 完成验证（AC: 1, 2, 3, 4）
  - [x] 验证创建成功、空输入失败、未登录失败三个主流程。
  - [x] 运行 `pnpm lint` 与 `pnpm build`。

## Dev Notes

- 这是第一次引入平台自有业务数据持久化，必须遵守“只为当前故事创建必要表”的原则。
- 不要在本故事里提前创建完整对话消息表、执行步骤表、审计表或结果表；后续故事再逐步补。
- 该故事要为 Epic 2 的意图识别和计划生成预留清晰入口，因此会话页至少要有稳定 `sessionId` 和原始问题文本。
- 数据库存储方向已按当前产品决定切换为 Postgres；这与部分早期架构文本仍写作 `MySQL/posgres` 的地方存在不一致，实施时以当前 Epic 文档和用户最新决定为准。
- UX 已明确会话页将发展为“分析输入 + 计划 + 证据 + 归因”的主工作区，因此本故事的布局骨架必须为该演进留空间。

### Project Structure Notes

- 建议文件落点：
  - `src/app/(workspace)/analysis/[sessionId]/page.tsx`
  - `src/app/api/analysis/sessions/route.ts`
  - `src/domain/analysis-session/`
  - `src/application/analysis-session/`
  - `src/infrastructure/db/`
  - `drizzle/`（如采用 Drizzle 迁移输出目录）
- 会话创建按钮建议由工作台首页发起，但创建逻辑必须落在服务端边界，而不是纯客户端本地状态。

### References

- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#Story 1.4: 创建新的分析会话]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#FR-01 自然语言问题输入]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#FR-11 结果留存]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#数据架构]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#API 与通信模式]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Defining Core Interaction]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#User Journey Flows]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-3-scoped-analysis-workspace-home.md]
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers-and-middleware)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- 先编写会先失败的集成测试，验证创建成功、空输入失败、未登录失败和超范围问题拦截四条主路径。
- 建立分析会话的最小领域模型、应用层用例和最小仓储边界，让会话对象先具备稳定 `id`、状态和原问题文本。
- 在工作台首页接入真实“新建分析”表单，通过服务端 Route Handler 创建会话并跳转到会话页。
- 为会话页铺设三段式工作台兼容骨架，只保留主分析区与证据辅助区容器，不提前实现 Epic 2 组件。

### Debug Log References

- `node --test tests/story-1-4-analysis-session.test.mjs`（先失败，后通过）
- `node --test --test-concurrency=1 tests/story-1-1-foundation.test.mjs tests/story-1-2-auth.test.mjs tests/story-1-3-workspace-home.test.mjs tests/story-1-4-analysis-session.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 本故事默认 Story 1.1-1.3 已建立项目骨架、受保护会话和工作台入口。
- 已新增 `src/domain/analysis-session`、`src/application/analysis-session` 与 `src/infrastructure/analysis-session`，建立最小分析会话模型和服务端用例。
- 会话记录已包含 `id`、`ownerUserId`、`questionText`、`status`、`createdAt`，并通过服务端仓储统一创建和读取。
- 初始版本的“最小持久化结构”先采用了内存仓储实现，以便在当时不新增数据库依赖和迁移配置的前提下先满足故事闭环；后续已迁移到 Postgres 并保留同一应用层边界。
- 工作台首页已接入真实“新建分析”表单，服务端创建会话时只使用当前受保护会话中的用户身份，不信任浏览器提交的用户标识。
- 对空问题、超长问题和明显超出物业分析范围的问题，服务端会返回明确错误并带回工作台首页。
- 创建成功后会跳转到 `/workspace/analysis/[sessionId]`，页面已保留原问题文本和“待分析”状态，作为后续意图识别和计划生成的稳定起点。
- 会话页整体结构已与 PC 三段式方向兼容：左侧导航继续承载身份与权限，主区承载分析主内容，右侧承载证据辅助区。
- `node --test --test-concurrency=1 tests/story-1-1-foundation.test.mjs tests/story-1-2-auth.test.mjs tests/story-1-3-workspace-home.test.mjs tests/story-1-4-analysis-session.test.mjs`、`pnpm lint`、`pnpm build` 全部通过。
- Epic 1 review 修复后，创建会话前已追加“当前必须具备项目或区域范围”的服务端校验，和首页空状态提示保持一致。
- Epic 1 review 修复后，分析会话已补充组织/项目/区域作用域快照与 `savedContext` 基础上下文快照，并在意图识别下游失败时自动回滚，避免留下幽灵会话。

### File List

- _bmad-output/implementation-artifacts/1-4-create-analysis-session.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/(workspace)/_components/workspace-home-shell.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/app/(workspace)/workspace/page.tsx
- src/app/api/analysis/sessions/route.ts
- src/application/analysis-session/ports.ts
- src/application/analysis-session/use-cases.ts
- src/domain/analysis-session/models.ts
- src/infrastructure/analysis-session/memory-analysis-session-store.ts
- src/infrastructure/session/server-auth.ts
- tests/story-1-4-analysis-session.test.mjs

## Change Log

- 2026-03-25：完成 Story 1.4，实现分析会话创建、最小会话持久化结构、会话页路由与三段式画布骨架。
- 2026-03-27：完成 Epic 1 review 修复回写，补充无范围创建拦截、会话作用域快照、基础上下文快照与失败回滚逻辑，并回写为 done。
