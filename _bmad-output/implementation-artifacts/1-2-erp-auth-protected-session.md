# Story 1.2: ERP 身份接入与受保护会话

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 使用现有 ERP 身份进入分析平台,
so that 我不需要重新注册，并且系统能继承我的组织与权限范围。

## Acceptance Criteria

1. 用户完成 ERP 登录后，系统创建受保护的应用会话。
2. 会话中包含组织、项目或区域权限上下文。
3. 未登录用户访问受保护页面时会被拦截并引导进入登录流程。

## Tasks / Subtasks

- [x] 建立认证领域模型与 ERP 防腐层边界（AC: 1, 2）
  - [x] 在 `src/domain/auth` 定义最小会话与权限上下文模型。
  - [x] 在 `src/application/auth` 定义登录、会话读取与退出的用例接口。
  - [x] 在 `src/infrastructure/erp-auth` 建立 ERP token 校验或交换适配器，避免把 ERP 协议细节散落到页面组件。
- [x] 实现服务端登录与会话签发流程（AC: 1, 2）
  - [x] 在 `src/app/api/auth` 下建立 Route Handlers，例如 `login`、`callback`、`logout`。
  - [x] 使用 HTTP-only Cookie 承载平台会话，Cookie 只在服务端读写。
  - [x] 会话内容至少能映射用户标识与权限作用域。
- [x] 实现受保护页面拦截与登录跳转（AC: 3）
  - [x] 为 `src/app/(workspace)` 下页面增加服务端会话校验。
  - [x] 未登录访问时跳转到 `(auth)` 组内登录入口页。
  - [x] 为权限失败场景返回明确错误，不泄露敏感对象信息。
- [x] 控制数据库与状态持久化范围（AC: 1, 2）
  - [x] 如需持久化服务端会话，只创建最小会话表或会话存储结构。
  - [x] 不要在本故事中提前创建分析会话、审计、结果存储等后续表。
- [x] 完成验证（AC: 1, 2, 3）
  - [x] 验证登录成功、未登录访问拦截、退出后会话失效三条主流程。
  - [x] 运行 `pnpm lint` 与 `pnpm build`。

## Dev Notes

- 认证权威仍然是 Java ERP，本系统是服务端会话持有者，不是新的身份源。
- 不允许浏览器直连 ERP、数据库或权限数据源；所有校验必须经过服务端边界。
- 本故事核心是“防腐层 + 受保护会话”，不是完成 ERP 全量用户同步。
- 如果 ERP 真实协议尚未完全就绪，允许先做可替换的适配器接口和开发期 stub，但页面与应用层不得依赖 stub 细节。
- Story 1.1 建立的目录与 App Router 约定必须直接复用，不要重新设计工程结构。
- 登录入口与受保护壳层需要延续 UX 定义的高信任、亮色、克制表达，避免落成通用默认登录页视觉。

### Project Structure Notes

- 建议文件落点：
  - `src/app/(auth)/login/page.tsx`
  - `src/app/api/auth/login/route.ts`
  - `src/app/api/auth/callback/route.ts`
  - `src/app/api/auth/logout/route.ts`
  - `src/domain/auth/`
  - `src/application/auth/`
  - `src/infrastructure/erp-auth/`
  - `src/infrastructure/session/`
- 如果采用数据库持久化会话，推荐把 schema 和 repository 放在 `src/infrastructure` 下的认证子目录中，不要散落到页面层。

### References

- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#Story 1.2: ERP 身份接入与受保护会话]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#认证与安全]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#API 与通信模式]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#权限与组织约束]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Desired Emotional Response]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Visual Design Foundation]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-1-manual-nextjs-foundation.md]
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers-and-middleware)
- [Next.js cookies](https://nextjs.org/docs-wip/app/api-reference/functions/cookies)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- 先编写集成测试，真实启动 `next dev` 并验证未登录拦截、登录成功和退出失效三条主流程。
- 在 `domain / application / infrastructure` 分层中建立可替换的认证模型、ERP 适配器和最小会话存储边界。
- 使用服务端 Route Handlers、HTTP-only Cookie 和受保护的 `(workspace)` 壳层完成登录入口与工作台拦截。
- 保持数据库范围为零新增，仅使用最小服务端内存会话存储满足“退出后会话失效”的故事要求。

### Debug Log References

- `node --test tests/story-1-2-auth.test.mjs`（先失败，后通过）
- `node --test tests/story-1-1-foundation.test.mjs tests/story-1-2-auth.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 默认依赖 Story 1.1 已完成并提供 `src/app` 与分层目录基线。
- 已实现 `src/domain/auth`、`src/application/auth`、`src/infrastructure/erp-auth`、`src/infrastructure/session` 的最小认证分层，页面层不再直接依赖 ERP 协议细节。
- 已实现 `/api/auth/login`、`/api/auth/callback`、`/api/auth/logout` 三个 Route Handlers，并通过 HTTP-only Cookie 持有服务端会话标识。
- 会话内容已带入用户标识、组织编号、项目范围、区域范围和角色编码，满足后续 Story 对权限上下文的复用需求。
- 受保护页面改为由 `src/app/(workspace)/layout.tsx` 在服务端统一校验；未登录会跳转 `/login`，已登录但无可用范围会返回克制的权限提示，不泄露敏感对象。
- 初始版本为满足“退出后会话失效”且不提前引入数据库，曾采用最小内存会话存储；Cookie 契约始终只保存签名后的 session id，服务端可主动吊销。
- 登录页与受保护工作台延续了亮色、克制、高信任的 UX 基线，而不是落成默认后台登录页。
- `node --test tests/story-1-1-foundation.test.mjs tests/story-1-2-auth.test.mjs`、`pnpm lint`、`pnpm build` 全部通过。
- 后续 Story 2.3 已将服务端会话存储正式迁移到 Postgres，登录、退出与受保护页面的应用层契约保持不变。
- 后续 Story 2.7 与 Epic 1 review 修复已补齐开发期 ERP stub 环境门禁，并将 `next` 回跳路径收紧到受控白名单。

### File List

- _bmad-output/implementation-artifacts/1-2-erp-auth-protected-session.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/(auth)/.gitkeep
- src/app/(auth)/login/page.tsx
- src/app/(workspace)/.gitkeep
- src/app/(workspace)/layout.tsx
- src/app/(workspace)/workspace/page.tsx
- src/app/api/.gitkeep
- src/app/api/auth/callback/route.ts
- src/app/api/auth/login/route.ts
- src/app/api/auth/logout/route.ts
- src/app/globals.css
- src/application/.gitkeep
- src/application/auth/ports.ts
- src/application/auth/use-cases.ts
- src/domain/.gitkeep
- src/domain/auth/errors.ts
- src/domain/auth/models.ts
- src/infrastructure/.gitkeep
- src/infrastructure/erp-auth/dev-erp-auth-adapter.ts
- src/infrastructure/session/memory-session-store.ts
- src/infrastructure/session/server-auth.ts
- src/infrastructure/session/session-cookie.ts
- tests/story-1-2-auth.test.mjs

## Change Log

- 2026-03-25：完成 Story 1.2，实现 ERP 防腐层、服务端会话签发、登录入口、受保护工作台拦截与退出失效验证。
- 2026-03-27：结合 Story 2.3 / 2.7 与 Epic 1 review 修复，补记 Postgres 会话持久化与认证安全收口结果，并回写为 done。
