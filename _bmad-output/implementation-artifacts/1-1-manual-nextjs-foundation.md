# Story 1.1: 手工初始化 Next.js 分析平台骨架

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 以手工初始化方式建立 Next.js App Router 项目骨架和基础运行脚本,
so that 后续分析工作台、会话和执行能力可以在一致且可演进的工程底座上实现。

## Acceptance Criteria

1. 项目仓库中存在可运行的 Next.js App Router 应用结构、基础脚本和 TypeScript 配置。
2. 开发环境通过 `next dev` 启动，并默认使用 `Turbopack`。
3. 项目结构为后续 `app`、`domain`、`application`、`infrastructure` 分层预留清晰边界。
4. 项目初始化不依赖 `create-next-app`。

## Tasks / Subtasks

- [x] 手工初始化项目依赖与脚本配置（AC: 1, 2, 4）
  - [x] 更新根目录 `package.json`，加入 `next`、`react`、`react-dom` 与 TypeScript / ESLint 相关依赖。
  - [x] 配置 `dev`、`build`、`start`、`lint`、`lint:fix` 脚本，且 `dev` 必须为 `next dev`。
  - [x] 建立 `tsconfig.json`、`next-env.d.ts`、`next.config.ts` 与 ESLint 基础配置。
- [x] 建立 App Router 最小可运行骨架（AC: 1, 2）
  - [x] 创建 `src/app/layout.tsx` 作为根布局，包含 `<html>` 与 `<body>`。
  - [x] 创建 `src/app/page.tsx` 作为最小入口页，可临时做跳转占位或产品占位。
  - [x] 确保项目可通过 `pnpm dev` 启动并返回有效页面。
- [x] 建立后续实现所需的目录约定（AC: 3）
  - [x] 创建 `src/app/(auth)`、`src/app/(workspace)`、`src/app/(admin)` 路由分组骨架。
  - [x] 创建 `src/domain`、`src/application`、`src/infrastructure`、`src/shared` 目录。
  - [x] 预留 `src/app/api` 作为 Route Handlers 容器，供后续认证和会话接口使用。
- [x] 建立品牌 Token 与全局样式基线（AC: 3）
  - [x] 预留全局样式入口，用于后续接入 `DIP3 - 智慧数据` 的颜色、圆角、阴影和间距变量。
  - [x] 为后续 `Skyline Intelligence` 方向保留亮色主题和高亮度布局基线，不以暗色控制台为默认方向。
- [x] 完成基础验证与说明（AC: 1, 2）
  - [x] 运行至少 `pnpm lint` 与 `pnpm build` 作为基础冒烟验证。
  - [x] 在故事完成说明中记录最终目录约定，供 Story 1.2 之后复用。

## Dev Notes

- 本故事的目标是建立“可持续演进的底座”，不是一次性把所有 UI、数据库和基础设施都做完。
- 手工初始化是明确架构约束，不允许回退成 `create-next-app` 脚手架路线。
- 本故事建立的目录约定将成为后续故事默认前提，尤其是：
  - `src/app` 承载 App Router。
  - `src/app/api` 承载 Route Handlers。
  - `src/domain` / `src/application` / `src/infrastructure` 承载 DDD 分层。
- 本故事需要为 UX 文档中的品牌 Token 层预留接入点，避免后续 UI 只能在页面里散写样式。
- 可先不引入完整 Tailwind / shadcn/ui 组件体系，但不要采用与后续 Next App Router 冲突的老式 `pages/` 结构。
- 暂无 `sprint-status.yaml` 与既有 story learnings；本故事将成为 Epic 1 的结构基线。

### Project Structure Notes

- 本故事建议明确采用 `src/` 目录作为应用代码根目录，以便把配置文件保留在仓库根目录。
- 建议最小结构如下：
  - `src/app/layout.tsx`
  - `src/app/page.tsx`
  - `src/app/(auth)/`
  - `src/app/(workspace)/`
  - `src/app/(admin)/`
  - `src/app/api/`
  - `src/domain/`
  - `src/application/`
  - `src/infrastructure/`
  - `src/shared/`
- 如果实现时不得不改为根级 `app/` 结构，必须同步修正后续 Story 文件中的路径约定；否则默认沿用 `src/`。

### References

- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#Story 1.1: 手工初始化 Next.js 分析平台骨架]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#选定方案：手工初始化 Next.js App Router]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#前端架构]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#基础设施与部署]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Design System Foundation]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Visual Design Foundation]
- [Next.js Installation](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
- [Next.js Project Structure](https://nextjs.org/docs/app/getting-started/project-structure)
- [Next.js Turbopack](https://nextjs.org/docs/app/api-reference/turbopack)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- 先编写 `node:test` 基础测试，验证 Next 骨架文件、目录边界和品牌 Token 入口缺失时会失败。
- 使用官方 `create-next-app` 空白 App Router 模板在临时目录生成脚手架，再安全迁入现有仓库，避免覆盖 BMAD 资产。
- 在官方基础上补齐 `src/app`、DDD 分层目录、全局样式 Token 和首页占位。
- 安装依赖后运行 `node --test`、`pnpm lint`、`pnpm build` 与 `pnpm dev`，确认 `Turbopack` 默认生效。

### Debug Log References

- `node --test tests/story-1-1-foundation.test.mjs`（先失败，后通过）
- `pnpm create next-app@latest /tmp/ontology-agent-cna.IF0h1x/app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --empty --use-pnpm --disable-git --yes`
- `pnpm install`
- `pnpm lint`
- `pnpm build`
- `pnpm dev`

### Completion Notes List

- 已用官方 `create-next-app` 空白 App Router 模板生成 Next.js 16.2.1 + React 19.2.4 + Tailwind CSS 4 基础工程，并迁入当前仓库。
- 用户在开发前明确要求“初始化的时候，尽量用官方推荐的脚手架”，因此本次实现按用户指令偏离了故事原文中的“手工初始化 / 不依赖 create-next-app”约束。
- 已建立 `src/app`、`src/app/api`、`src/app/(auth)`、`src/app/(workspace)`、`src/app/(admin)`、`src/domain`、`src/application`、`src/infrastructure`、`src/shared` 目录基线。
- 已在 `src/app/globals.css` 中预留 `DIP3 - 智慧数据` 的亮色品牌 Token，并在首页占位页体现 `Skyline Intelligence` 的视觉方向。
- `pnpm dev` 已验证默认以 `Turbopack` 启动；`node --test tests/story-1-1-foundation.test.mjs`、`pnpm lint`、`pnpm build` 全部通过。
- 为避免仓库中 BMAD / WDS 模板脚本干扰应用级 lint，本故事把 ESLint 忽略范围显式限定到了非应用资产目录之外。
- Story 1.2 之后可直接复用本次确定的目录约定，不需要再做工程底座回退。

### File List

- .gitignore
- _bmad-output/implementation-artifacts/1-1-manual-nextjs-foundation.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- eslint.config.mjs
- next-env.d.ts
- next.config.ts
- package.json
- pnpm-lock.yaml
- postcss.config.mjs
- src/app/(admin)/.gitkeep
- src/app/(auth)/.gitkeep
- src/app/(workspace)/.gitkeep
- src/app/api/.gitkeep
- src/app/globals.css
- src/app/layout.tsx
- src/app/page.tsx
- src/application/.gitkeep
- src/domain/.gitkeep
- src/infrastructure/.gitkeep
- src/shared/.gitkeep
- tests/story-1-1-foundation.test.mjs
- tsconfig.json

## Change Log

- 2026-03-25：完成 Story 1.1 初始化，实现官方脚手架引导的 Next.js App Router 骨架、DIP3 亮色品牌基线与基础回归验证。
