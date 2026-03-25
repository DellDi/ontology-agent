# Story 1.5: 历史分析会话列表与回看

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 查看并重新打开我的历史分析会话,
so that 我可以回看之前的问题、结果和后续追问上下文。

## Acceptance Criteria

1. 用户可以进入历史会话列表，且列表按时间倒序展示。
2. 每条会话至少显示标题摘要、最近更新时间和状态。
3. 用户点击会话后可查看已保存的问题与基础上下文。
4. 系统不展示其他用户或超出权限范围的会话内容。

## Tasks / Subtasks

- [x] 实现历史会话列表页或列表区域（AC: 1, 2）
  - [x] 在工作台首页或独立历史页提供历史会话入口。
  - [x] 查询当前用户可访问的分析会话并按时间倒序排序。
  - [x] 为每条记录展示标题摘要、更新时间和当前状态。
- [x] 让历史入口与主工作台体验一致（AC: 1, 2, 3）
  - [x] 历史入口应适配 UX 中定义的会话历史栏 / 工作台二级区语义。
  - [x] 历史列表的信息密度、标题层级和状态标签应与分析主工作台视觉体系一致。
  - [x] 不把历史页做成与主工作台完全割裂的传统列表后台。
- [x] 实现会话回看与详情加载（AC: 3）
  - [x] 复用 `src/app/(workspace)/analysis/[sessionId]/page.tsx` 作为详情页。
  - [x] 页面至少能加载原问题文本和基础上下文。
  - [x] 若后续结果尚未存在，也要展示“待分析”或等价状态。
- [x] 做好访问控制与范围过滤（AC: 4）
  - [x] 查询条件必须受当前登录用户与作用域限制。
  - [x] 直接访问他人 `sessionId` 时返回未授权或未找到，而不是泄露存在性细节。
  - [x] 对列表接口和详情接口都执行服务端权限校验。
- [x] 保持持久化扩展最小化（AC: 1, 2, 3）
  - [x] 优先复用 Story 1.4 已建立的会话表与基础字段。
  - [x] 仅在需要支持“最近更新时间”时新增必要字段，不预建未来结果表。
- [x] 完成验证（AC: 1, 2, 3, 4）
  - [x] 验证本人会话可见、他人会话不可见、空列表状态可见。
  - [x] 运行 `pnpm lint` 与 `pnpm build`。

## Dev Notes

- 本故事是 Epic 1 的“留存与回看”闭环，不要求展示完整分析执行轨迹，那是 Epic 3/4 的扩展内容。
- 历史列表不应绕过 Story 1.2 的作用域校验；“看得见列表但点不开详情”属于实现缺陷。
- 标题摘要可以从原问题截取生成，无需在本故事中引入复杂标题生成逻辑。
- 如果需要记录 `updated_at`，只补最小字段和索引，不扩展完整审计结构。
- UX 已将“会话历史栏”定义为关键自定义组件，因此本故事应避免交付一个后续无法融入主界面的孤立实现。

### Project Structure Notes

- 建议文件落点：
  - `src/app/(workspace)/history/page.tsx` 或在 `src/app/(workspace)/page.tsx` 中内嵌列表
  - `src/app/(workspace)/analysis/[sessionId]/page.tsx`
  - `src/app/api/analysis/sessions/route.ts`（如需要列表读取）
  - `src/app/api/analysis/sessions/[sessionId]/route.ts`（如需要详情读取）
  - `src/application/analysis-session/queries/`
- 若使用 Route Handlers，请保持 `page.tsx` 与 `route.ts` 不冲突，遵守 App Router 文件约定。

### References

- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#Story 1.5: 历史分析会话列表与回看]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md#FR-11 结果留存]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#认证与安全]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#前端架构]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-4-create-analysis-session.md]
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers-and-middleware)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- 先补一条会先失败的历史会话集成测试，覆盖排序、空状态和跨用户隔离三条主路径。
- 扩展分析会话模型和仓储接口，只增加 `updatedAt` 与“按 owner 查询列表”这两个 Story 1.5 必需能力。
- 在工作台首页内联接入真实“历史会话”区，复用现有会话详情页作为回看入口，不新增多余的页面层级。
- 保持详情权限校验沿用 Story 1.4 的服务端用例，确保“列表可见”和“详情可见”边界一致。

### Debug Log References

- `node --test tests/story-1-5-history.test.mjs`（先失败，后通过）
- `node --test --test-concurrency=1 tests/story-1-1-foundation.test.mjs tests/story-1-2-auth.test.mjs tests/story-1-3-workspace-home.test.mjs tests/story-1-4-analysis-session.test.mjs tests/story-1-5-history.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 本故事默认 Story 1.4 已建立最小分析会话持久化与详情页。
- 历史列表和详情都必须走相同的服务端权限边界。
- 本故事已补充 UX 对“会话历史栏”和一致性标签体系的约束。
- 会话模型新增了最小 `updatedAt` 字段，用于支持“最近更新时间”展示，但没有提前扩展结果表或审计表。
- 工作台首页已经从占位“最近分析”切换为真实“历史会话”区，列表按 `updatedAt` 倒序展示，并复用现有 `/workspace/analysis/[sessionId]` 作为回看入口。
- 历史会话只按当前登录用户进行服务端过滤；其他用户既不会出现在列表中，也不能通过直链访问详情页。
- 空历史状态会在主工作台内给出明确提示，保持与 UX 规格一致的面板语义，而不是跳转到空白列表页。
- `node --test --test-concurrency=1 tests/story-1-1-foundation.test.mjs tests/story-1-2-auth.test.mjs tests/story-1-3-workspace-home.test.mjs tests/story-1-4-analysis-session.test.mjs tests/story-1-5-history.test.mjs`、`pnpm lint`、`pnpm build` 全部通过。

### File List

- /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/1-5-analysis-session-history-and-replay.md
- /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/sprint-status.yaml
- /Users/delldi/work-code/open-code/ontology-agent/src/app/(workspace)/_components/workspace-home-shell.tsx
- /Users/delldi/work-code/open-code/ontology-agent/src/app/(workspace)/workspace/page.tsx
- /Users/delldi/work-code/open-code/ontology-agent/src/application/analysis-session/ports.ts
- /Users/delldi/work-code/open-code/ontology-agent/src/application/analysis-session/use-cases.ts
- /Users/delldi/work-code/open-code/ontology-agent/src/application/workspace/home.ts
- /Users/delldi/work-code/open-code/ontology-agent/src/domain/analysis-session/models.ts
- /Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/analysis-session/memory-analysis-session-store.ts
- /Users/delldi/work-code/open-code/ontology-agent/tests/story-1-5-history.test.mjs

## Change Log

- 2026-03-25：完成 Story 1.5，实现历史会话列表、空状态、本人回看和跨用户隔离。
