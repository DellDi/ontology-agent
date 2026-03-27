# Story 2.7: 收紧认证与跳转安全边界

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台管理员,
I want 开发期认证入口和登录跳转路径受到明确限制,
so that 在继续更多故事前不会把临时安全风险继续放大。

## Acceptance Criteria

1. 开发期 stub 认证入口必须受到环境或配置门禁保护，不能在所有环境下默认公开可伪造身份的登录方式。
2. 登录流程中的 `next` 返回路径必须只允许受控白名单内的内部页面，不允许外部跳转、循环跳转或副作用型路径。
3. 正常的站内登录回跳体验必须保留，不能因为收紧边界而破坏已有受保护工作台入口。

## Tasks / Subtasks

- [x] 收紧开发期认证入口（AC: 1）
  - [x] 明确 dev stub 启用条件，避免在非开发环境默认暴露。
  - [x] 若当前通过环境变量或配置控制，补充默认安全值与失败行为。
- [x] 加强 `next` 跳转校验（AC: 2, 3）
  - [x] 只允许站内相对路径或显式白名单路径。
  - [x] 拦截外部 URL、协议相对路径、双斜杠、编码绕过和副作用型跳转。
  - [x] 保持登录成功后回到受保护页面的正常体验。
- [x] 建立安全回归测试（AC: 1, 2, 3）
  - [x] 覆盖正常站内回跳。
  - [x] 覆盖恶意 `next`、未登录访问受保护路径和无效环境配置。

## Dev Notes

- 本故事优先级高于“更多功能”，因为它决定后续所有分析入口是否继续建立在安全边界之上。
- 如果 2.3 已先完成，必须在 Postgres-backed session 模式下回归安全逻辑，避免只在 memory 模式通过。
- 开发期 stub 仍可保留，但只能在受控环境中可用，且行为需可解释。

### Architecture Compliance

- 所有受保护路径继续统一通过服务端鉴权，不允许页面自行信任 query 参数。
- `next` 校验必须是服务端规则，不能仅依赖客户端路由跳转约束。
- 安全失败结果应稳定且去敏，不能借报错泄露内部页面或越权目标细节。

### File Structure Requirements

- 重点文件预计包括：
  - `src/infrastructure/session/server-auth.ts`
  - `src/infrastructure/session/session-cookie.ts`
  - `src/app/api/auth/login/route.ts`
  - `src/app/api/auth/callback/route.ts`
  - `tests/auth-hardening.test.mjs`
  - `tests/story-1-2-auth.test.mjs`

### Testing Requirements

- 至少覆盖：
  - 正常站内 `next` 回跳
  - 外部 URL / 协议相对 URL / 双斜杠 / 编码绕过被拒绝
  - 未登录访问 workspace 时正确重定向
  - dev stub 在不允许环境下不可用

### Previous Story Intelligence

- Story 1.2 已建立 ERP stub 登录链路；本故事要在此基础上补安全门禁，而不是重做认证协议。
- Story 2.3 若已完成，会让真实会话持久化到 Postgres；2.7 必须对这种真实持久化模式做回归。
- 后续 Epic 6 的权限治理会在这里的认证边界之上继续扩展。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.7: 收紧认证与跳转安全边界]
- [Source: _bmad-output/planning-artifacts/architecture.md#安全与权限边界]
- [Source: _bmad-output/project-context.md#关键实现规则]
- [Source: _bmad-output/implementation-artifacts/1-2-erp-auth-protected-session.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Story 2.7 新增 12 个安全测试全部通过
- 现有 auth-hardening.test.mjs 3/3 回归通过
- ESLint 零错误，TypeScript 零错误

### Completion Notes List

- `isDevErpAuthEnabled` 新增 production 安全门禁：NODE_ENV=production 时无条件返回 false
- `sanitizeNextPath` 强化：新增 trim() 防空白前缀绕过、replace(/\\/g, '/') 防反斜杠绕过
- 12 个安全测试覆盖：正常回跳、外部 URL、协议相对路径、反斜杠、空白前缀、非 workspace 路径、路径穿越、空路径、未登录重定向、代码安全检查
- 保持现有 auth-hardening.test.mjs（ENABLE_DEV_ERP_AUTH=0 场景）完全兼容
- 结合 Epic 1 review 修复，详情页未登录访问现在会保留 `/workspace/analysis/[sessionId]` 深链回跳，安全收紧未破坏真实站内分析回看路径。

### File List

- src/infrastructure/erp-auth/dev-auth-config.ts（修改：新增 production 安全门禁）
- src/domain/auth/models.ts（修改：sanitizeNextPath 强化 trim + 反斜杠防护）
- tests/story-2-7-auth-hardening.test.mjs（新增：12 个安全回归测试）

### Change Log

- 2026-03-26: Story 2.7 实现完成 — 认证入口 production 门禁 + next 跳转安全强化 + 12 个安全测试
- 2026-03-27：补记深链分析页登录回跳的联动验证结果。
