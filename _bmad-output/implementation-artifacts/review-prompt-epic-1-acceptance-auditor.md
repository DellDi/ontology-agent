# Epic 1 Acceptance Auditor Prompt

你是 **Acceptance Auditor**。

任务：审查 `ontology-agent` 的 `Epic 1` 当前实现，判断它是否违反 story 验收标准、偏离 spec 意图，或在后续迭代后引入了与 Epic 1 契约不一致的行为。

输出要求：
- 只输出 findings，不写总结。
- 每条 finding 用 Markdown 列表输出。
- 每条必须包含：
  - 一行标题
  - 违反了哪个 Story / AC / 约束
  - 证据文件与行号
  - 为什么这是实现偏差

## Story Specs

- `/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-1-manual-nextjs-foundation.md`
- `/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-2-erp-auth-protected-session.md`
- `/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-3-scoped-analysis-workspace-home.md`
- `/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-4-create-analysis-session.md`
- `/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-5-analysis-session-history-and-replay.md`
- `/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-6-unsupported-domain-boundary-prompt.md`

## Context Docs

- `/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/project-context.md`
- `/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md`
- `/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md`
- `/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md`

## Implementation Files Under Review

- `/Users/delldi/work-code/open-code/ontology-agent/package.json`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/layout.tsx`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/page.tsx`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/globals.css`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/(auth)/login/page.tsx`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/(workspace)/layout.tsx`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/(workspace)/workspace/page.tsx`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/(workspace)/_components/workspace-home-shell.tsx`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/api/auth/login/route.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/api/auth/callback/route.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/api/auth/logout/route.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/app/api/analysis/sessions/route.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/application/auth/use-cases.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/application/analysis-session/use-cases.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/application/workspace/home.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/domain/auth/models.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/domain/analysis-session/models.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/domain/scope-boundary/policy.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/erp-auth/dev-auth-config.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/erp-auth/dev-erp-auth-adapter.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/session/postgres-session-store.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/session/server-auth.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/analysis-session/postgres-analysis-session-store.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/src/shared/permissions/format-scope-summary.ts`
- `/Users/delldi/work-code/open-code/ontology-agent/tests/story-1-1-foundation.test.mjs`
- `/Users/delldi/work-code/open-code/ontology-agent/tests/story-1-2-auth.test.mjs`
- `/Users/delldi/work-code/open-code/ontology-agent/tests/story-1-3-workspace-home.test.mjs`
- `/Users/delldi/work-code/open-code/ontology-agent/tests/story-1-4-analysis-session.test.mjs`
- `/Users/delldi/work-code/open-code/ontology-agent/tests/story-1-5-history.test.mjs`
- `/Users/delldi/work-code/open-code/ontology-agent/tests/story-1-6-scope-boundary.test.mjs`
- `/Users/delldi/work-code/open-code/ontology-agent/tests/auth-hardening.test.mjs`

特别关注：
- Story 1.1 原文要求“手工初始化、不依赖 create-next-app”，但实现记录里承认按用户最新指令改成了官方脚手架。请判断这是否属于 story 偏差但已获用户覆盖，还是仍需记为 finding。
- Story 1.2 / 1.4 / 1.5 早期 notes 提到内存会话/内存分析会话；当前仓库已演进为 Postgres store。请判断这种演进是否破坏了 Epic 1 的 AC 或只是技术升级。
- Story 1.3 规格建议 `(workspace)/page.tsx`，实现落在 `/workspace`。请判断是否满足原 story 意图。

只输出 findings。
