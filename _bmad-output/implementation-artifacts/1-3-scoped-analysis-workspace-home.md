# Story 1.3: 权限范围内的分析工作台首页

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 进入一个只展示我权限范围内分析入口的工作台首页,
so that 我能从正确的数据范围开始分析，而不会误入不支持或无权限的领域。

## Acceptance Criteria

1. 登录后的用户可以进入分析工作台首页。
2. 首页展示分析入口、最近分析入口和当前权限范围提示。
3. 页面不展示客服系统或其他非物业分析范围的入口。
4. 用户只能看到自己有权访问的项目或区域范围信息。

## Tasks / Subtasks

- [x] 建立 `(workspace)` 首页路由与服务端加载流程（AC: 1, 2）
  - [x] 创建 `src/app/(workspace)/page.tsx` 作为工作台首页。
  - [x] 在服务端读取当前会话和权限上下文，未登录则复用 Story 1.2 的拦截逻辑。
  - [x] 渲染基础工作台卡片或入口区，至少包含“新建分析”和“最近分析”入口占位。
- [x] 落实首页品牌与布局基调（AC: 1, 2）
  - [x] 首页首屏应体现 `DIP3 - 智慧数据` 的品牌母题与 `Skyline Intelligence` 方向。
  - [x] 使用高亮度、清透、空气感布局，而不是传统 ERP 宫格或表格式首页。
  - [x] 为后续三段式工作台入口保留清晰视觉过渡，不把首页做成孤立风格。
- [x] 实现权限范围提示与限定展示（AC: 2, 4）
  - [x] 将项目、区域或组织范围整理为可读提示信息。
  - [x] 在页面中只展示当前会话可访问的范围摘要，不泄露超范围名称。
  - [x] 为“无可用项目范围”的用户准备空状态提示。
- [x] 明确产品范围边界（AC: 3）
  - [x] 不出现客服系统、CRM、营销、呼叫中心等入口文案或导航。
  - [x] 在首页或帮助说明中明确“当前版本仅支持物业分析”。
- [x] 保持服务端优先与后续演进空间（AC: 1, 2）
  - [x] 优先使用 Server Components 渲染权限相关信息。
  - [x] 仅在确有交互需求时引入 Client Component，不预先加入全局状态管理。
- [x] 完成验证（AC: 1, 2, 3, 4）
  - [x] 验证有权限用户、无权限范围用户、未登录用户三种入口表现。
  - [x] 运行 `pnpm lint` 与 `pnpm build`。

## Dev Notes

- 工作台首页是 Epic 1 的产品入口，不需要在这一故事里完成完整分析能力。
- 权限范围展示应来自会话上下文，而不是前端静态假设。
- 该页面要服务于后续 Story 1.4 的“新建分析会话”，因此要预留清晰入口和后续可跳转区域。
- 按架构要求，路由分组建议使用 `(workspace)`；避免把工作台页面混入 `(auth)` 或根级公共入口。
- 该页面需要吸收 UX 中定义的品牌语言、首页气质和“最近分析 / 快速提问 / 范围提示”结构，而不是仅做技术占位页。

### Project Structure Notes

- 建议文件落点：
  - `src/app/(workspace)/page.tsx`
  - `src/app/(workspace)/_components/`（如需要局部 UI 组件）
  - `src/application/workspace/`（若需要首页组装逻辑）
  - `src/shared/permissions/`（如需通用作用域格式化工具）
- 若实现帮助说明页，可放在 `src/app/(workspace)/help/page.tsx`，但保持范围清晰即可，不必扩展成完整帮助中心。

### References

- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#Story 1.3: 权限范围内的分析工作台首页]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#平台范围]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#明确不做]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#前端架构]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#认证与安全]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Executive Summary]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Design Direction Decision]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Visual Design Foundation]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-2-erp-auth-protected-session.md]
- [Next.js Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
- [Next.js Project Structure](https://nextjs.org/docs/app/getting-started/project-structure)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- 先编写会先失败的集成测试，验证 `/workspace` 首页需要展示分析入口、最近分析、权限范围提示与空状态。
- 在应用层组装工作台首页模型，在共享层集中格式化权限范围展示，避免页面直接拼接会话数据。
- 使用 Server Component 把现有 `/workspace` 从技术占位页升级为品牌首页，同时保持 Story 1.2 的受保护壳层不变。
- 通过串行测试、`pnpm lint` 和 `pnpm build` 做回归，避免多份 Next dev 测试并发导致的伪失败。

### Debug Log References

- `node --test tests/story-1-3-workspace-home.test.mjs`（先失败，后通过）
- `node --test --test-concurrency=1 tests/story-1-1-foundation.test.mjs tests/story-1-2-auth.test.mjs tests/story-1-3-workspace-home.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 本故事默认复用 Story 1.2 的服务端会话与权限上下文读取能力。
- 该故事不应提前引入完整分析页面、客服模块或移动端范围。
- 已将 `/workspace` 升级为工作台首页，展示“新建分析”“最近分析”“当前权限范围”和“当前版本仅支持物业分析”等首页关键结构。
- 由于 Story 1.1 已保留根级 `src/app/page.tsx` 占位，而 Next.js 不允许再增加会解析到同一路径的 `src/app/(workspace)/page.tsx`，本次将首页能力落在现有受保护的 `/workspace` 路由上，并保留故事语义不变。
- 已新增应用层首页模型与共享权限格式化工具，把权限范围整理为可读摘要，避免页面直接散写会话解析逻辑。
- 对只有组织和角色、但暂无项目/区域范围的用户，首页现在会给出空状态提示，而不是误导用户直接进入后续分析。
- 页面中未出现客服系统、CRM、营销或呼叫中心等非物业分析入口文案，范围边界改为正向提示“当前版本仅支持物业分析”。
- 本故事继续保持 Server Components 优先，没有引入额外 Client Component 或全局状态管理。
- `node --test --test-concurrency=1 tests/story-1-1-foundation.test.mjs tests/story-1-2-auth.test.mjs tests/story-1-3-workspace-home.test.mjs`、`pnpm lint`、`pnpm build` 全部通过。

### File List

- _bmad-output/implementation-artifacts/1-3-scoped-analysis-workspace-home.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/(workspace)/_components/workspace-home-shell.tsx
- src/app/(workspace)/workspace/page.tsx
- src/application/.gitkeep
- src/application/workspace/home.ts
- src/domain/auth/models.ts
- src/shared/.gitkeep
- src/shared/permissions/format-scope-summary.ts
- tests/story-1-3-workspace-home.test.mjs

## Change Log

- 2026-03-25：完成 Story 1.3，实现权限范围内的工作台首页、品牌化入口布局、范围摘要与空状态提示。
