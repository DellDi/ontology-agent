# Story 7.2: 记录分析与工具调用审计日志

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台管理员,
I want 对分析请求、关键工具调用和权限失败事件进行审计,
so that 企业可以追溯系统行为并满足内部治理要求。

## Acceptance Criteria

1. 当用户发起分析、触发关键工具调用或发生权限失败时，系统必须写入可检索的审计记录。
2. 审计记录至少包含用户标识、时间、事件类型和关联会话。
3. 审计记录必须支持至少 180 天保留窗口，且普通分析用户不能直接查看全量审计明细。

## Tasks / Subtasks

- [x] 建立 audit domain model 与持久化表（AC: 1, 2, 3）
  - [x] 为用户、组织、会话、事件类型、结果、trace / correlation id 建立结构。
  - [x] 区分审计记录与普通应用日志。
- [x] 接入关键写入点（AC: 1, 2）
  - [x] 覆盖分析请求、关键工具调用、权限失败等事件。
  - [x] 审计内容需脱敏，不能写入原始敏感 payload 或密钥。
- [x] 覆盖保留与访问边界测试（AC: 2, 3）
  - [x] 验证成功与失败事件都记录。
  - [x] 验证普通业务用户不可直接查看全量审计。
- [x] 修复 Story 4.6 Code Review 遗留问题（技术债）
  - [x] [B4] 补充 `tool-validation-failed` 错误码的测试路径覆盖（`src/application/tooling/use-cases.ts` 的 `normalizeToolError`）。
  - [x] [E1] 明确"所有工具均返回 `tool-empty-result`"场景的语义：`executeStep` 返回 `completed` 但 `events` 全部 `ok: false`，需在 `buildStepResultMessage` 中给出可读提示而非静默降级。
  - [x] [E2] `buildFallbackSelection` 在 `confirm-analysis-scope` / `confirm-query-scope` 步骤中当 `platform.capability-status` 也降级时会返回空 tools 列表，需补防卫逻辑或给 orchestration 层一个明确的降级路径。
  - [x] [E3] 合并 `src/application/analysis-execution/use-cases.ts` 中的 `summarizeToolEventForConclusion` 与 `src/worker/analysis-execution-renderer.ts` 中的 `buildToolOutputBlocks` 的重复工具输出解析逻辑，提取到共享位置。

## Dev Notes

- 审计不是 console log 的别名；必须有单独可检索的数据模型。
- 当前尚未完全落地 worker / 工具执行时，可先定义事件契约和最小写入点，为后续故事复用。
- 180 天保留窗口至少要体现在 schema / retention 策略 / 文档中，不能只留在口头描述。

### Architecture Compliance

- 审计数据属于平台治理数据，应位于平台自有 Postgres schema 中。
- Route Handler 和 application service 是天然审计挂点。
- 审计与 observability 不是同一件事，不能混建成一套普通日志。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/audit/`
  - `src/application/audit/`
  - `src/infrastructure/postgres/schema/audit-events.ts`
  - `src/infrastructure/postgres/schema/index.ts`
  - 对应 migration

### Testing Requirements

- 至少覆盖：
  - 成功分析写入审计记录
  - 权限失败写入审计记录
  - 审计记录字段完整且脱敏
  - 普通用户无法读取全量审计

### Previous Story Intelligence

- Story 2.2 的 Drizzle / Postgres 基线为审计表提供直接落点。
- Story 7.1 的权限失败结果需要在这里被持续记录。
- Story 7.4 的 trace / correlation id 可与这里形成互补，但不能互相替代。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.2: 记录分析与工具调用审计日志]
- [Source: _bmad-output/planning-artifacts/prd.md#非功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#安全与权限边界]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-4-6-tool-registry.test.mjs`
- `node --test --test-concurrency=1 tests/story-7-2-audit-analysis-and-tool-events.test.mjs`
- `node --test --test-concurrency=1 tests/story-1-4-analysis-session.test.mjs tests/story-4-6-tool-registry.test.mjs tests/story-5-1-analysis-execution.test.mjs tests/story-5-3-ranked-conclusions.test.mjs tests/story-7-1-server-side-authorization.test.mjs tests/story-7-2-audit-analysis-and-tool-events.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 新增 `platform.audit_events` 审计数据模型、Drizzle schema 与迁移，按 180 天保留窗口写入用户、组织、会话、事件类型、结果、来源与 correlation id。
- 在分析请求、工具调用、权限拒绝三个关键链路接入审计写入，并对 payload 进行敏感字段脱敏，避免记录密码、token、cookie 等原始值。
- 新增平台管理员审计查询接口 `/api/admin/audit/events`，普通业务用户会被服务端拒绝访问全量审计明细。
- 补齐 Story 4.6 遗留技术债：覆盖 `tool-validation-failed` 测试路径、为全 `tool-empty-result` 返回可读提示、为确认口径步骤保留显式降级路径，并提取共享工具结果展示/摘要逻辑。
- 通过 story 级集成测试、受影响回归测试、`pnpm lint` 与 `pnpm build` 验证实现。

### File List

- `_bmad-output/implementation-artifacts/7-2-audit-analysis-and-tool-events.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `drizzle/0012_audit_events.sql`
- `drizzle/meta/_journal.json`
- `src/app/api/admin/audit/events/route.ts`
- `src/app/api/analysis/sessions/route.ts`
- `src/app/api/analysis/sessions/[sessionId]/execute/route.ts`
- `src/application/analysis-execution/use-cases.ts`
- `src/application/audit/ports.ts`
- `src/application/audit/use-cases.ts`
- `src/application/tooling/use-cases.ts`
- `src/domain/audit/models.ts`
- `src/infrastructure/audit/index.ts`
- `src/infrastructure/audit/postgres-audit-event-store.ts`
- `src/infrastructure/postgres/schema/audit-events.ts`
- `src/infrastructure/postgres/schema/index.ts`
- `src/infrastructure/tooling/index.ts`
- `src/shared/tooling/tool-event-presentation.ts`
- `src/worker/analysis-execution-renderer.ts`
- `tests/story-4-6-tool-registry.test.mjs`
- `tests/story-7-2-audit-analysis-and-tool-events.test.mjs`

## Change Log

- 2026-04-11: Code Review 通过 — 5/5 测试 pass，lint 零告警。完成 Story 7.2 审计模型、关键链路审计写入、管理员审计查询接口与回归测试，同时补齐 Story 4.6 遗留的工具错误语义与共享展示逻辑。
