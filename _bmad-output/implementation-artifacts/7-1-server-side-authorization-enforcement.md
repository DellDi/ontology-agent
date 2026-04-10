# Story 7.1: 服务端权限校验与越权拦截

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台管理员,
I want 所有分析请求都在服务端完成权限校验,
so that 系统不会返回超出用户项目、区域或组织边界的数据。

## Acceptance Criteria

1. 用户发起分析请求进入服务端分析边界时，系统必须根据当前会话中的作用域权限完成校验。
2. 未授权的数据主题、项目或区域不得进入查询或分析流程。
3. 当权限校验失败时，系统必须返回明确且去敏的权限失败结果，不能泄露越权对象的具体敏感数据。

## Tasks / Subtasks

- [x] 建立统一服务端权限策略入口（AC: 1, 2, 3）
  - [x] 复用当前会话中的 scope 与角色信息，不信任浏览器提交的 `userId` 或范围参数。
  - [x] 将策略集中到 domain / application 层，不散落在页面组件中。
- [x] 接入分析写入与读取边界（AC: 1, 2, 3）
  - [x] 覆盖创建分析、读取会话详情、后续执行入口和移动端只读入口。
  - [x] 确保越权数据不会进入查询或分析流程。
- [x] 覆盖越权回归测试（AC: 1, 2, 3）
  - [x] 测越权读、越权写、跨用户访问和失败信息去敏。

## Dev Notes

- 当前代码主要依赖“本人 owner”隔离；本故事要把它扩展为“本人 + scope”双重约束。
- 权限失败应稳定，但不能泄露“目标对象确实存在”的额外信号。
- 这是 Epic 7 移动端只读能力的安全前置。

### Architecture Compliance

- 所有分析请求继续通过服务端会话与 application 层校验。
- 不允许浏览器直接提交可信的权限主体或范围对象。
- SSE、follow-up、移动端 read model 都必须复用同一权限边界。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/analysis-session/use-cases.ts`
  - `src/domain/scope-boundary/policy.ts`
  - `src/infrastructure/session/server-auth.ts`
  - `src/app/api/analysis/sessions/route.ts`
  - 新增 `tests/story-7-1-server-side-authorization.test.mjs`

### Testing Requirements

- 至少覆盖：
  - 越权创建分析失败
  - 越权读取详情失败
  - 跨用户访问失败
  - 失败信息去敏

### Previous Story Intelligence

- Story 1.x 与 2.x 已建立受保护会话和本人 owner 隔离。
- Story 7.1 需要把服务端 session scope 真正纳入分析入口，而不仅是登录门禁。
- Story 7.2 审计会复用这里的权限失败事件。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.1: 服务端权限校验与越权拦截]
- [Source: _bmad-output/planning-artifacts/architecture.md#安全与权限边界]
- [Source: _bmad-output/planning-artifacts/prd.md#非功能需求]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-7-1-server-side-authorization.test.mjs`
- `node --test --test-concurrency=1 tests/story-5-1-analysis-execution.test.mjs`
- `node --test --test-concurrency=1 tests/story-6-1-follow-up-on-existing-conclusion.test.mjs`
- `npm run lint`
- `npm run build`

### Completion Notes List

- 新增统一的分析作用域授权策略，显式约束 owner + organization + projectIds + areaIds。
- 现有 analysis session 可访问性判断改为复用统一策略，消除重复且分散的 scope 判定逻辑。
- 补充 Story 7.1 真实集成回归，覆盖伪造范围写入、跨组织回看/执行/追问拒绝、跨项目越权拒绝、跨用户去敏失败语义。
- 相关主链回归与质量门槛已通过，未发现对 Epic 5/6 的执行与 follow-up 链路回归。

### File List

- _bmad-output/implementation-artifacts/7-1-server-side-authorization-enforcement.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/domain/analysis-session/models.ts
- src/domain/scope-boundary/policy.ts
- tests/story-7-1-server-side-authorization.test.mjs
