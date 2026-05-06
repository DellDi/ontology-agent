# Story 9.5: 本体治理后台管理界面

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台治理负责人,
I want 在内部后台查看和管理 ontology definitions、change request、approval 与 publish 状态,
so that 知识治理不是停留在数据表和脚本层，而是具备最小可运营、可审核的管理闭环。

## Acceptance Criteria

1. 内部治理人员必须能够在 `(admin)` 管理面查看当前生效 ontology version、核心 definitions、change requests、approval 状态和发布状态。
2. 管理面必须支持最小闭环操作：提交 change request、查看差异、审批/驳回、发布 approved 版本；但首期不要求复杂富编辑器。
3. 管理面展示的数据必须全部来自正式治理用例与平台表，不得直接绕过应用层读写数据库。
4. 管理面必须沿用服务端受控边界与最小权限原则，不得因为“内部页面”而跳过登录、授权或审计。

## Tasks / Subtasks

- [x] 建立 ontology governance admin 的最小信息架构（AC: 1, 2, 4）
  - [x] 基于现有 `(admin)` 路由预留目录建立最小后台导航与页面骨架。
  - [x] 至少覆盖这些视图：
    - [x] 当前生效版本概览
    - [x] ontology definitions 列表 / 详情
    - [x] change request 列表 / 详情
    - [x] approval / publish 操作入口
  - [x] 首期优先做“列表 + 详情 + 明确操作”，不要求复杂 schema 编辑器。

- [x] 接入正式治理 use cases，而不是页面直连数据表（AC: 1, 2, 3）
  - [x] 页面数据读取必须通过 `src/application/ontology/` 下的正式 use cases（`ontology-admin/use-cases.ts` 仅消费 9.4 的 `governance-use-cases.ts` 与既有 registry/governance use cases）。
  - [x] 审批、驳回、发布等写操作必须通过服务端 route / action + 应用层用例执行（`/api/admin/ontology/*` 受控 route handlers）。
  - [x] 明确哪些页面是只读投影，哪些页面触发治理动作（Overview/Definitions/Publish History 只读；Change Request 详情承载提交/审批/驳回/发布操作；Change Request 列表承载“创建变更申请”）。

- [x] 展示变更差异、兼容说明与审计信息（AC: 1, 2, 3)
  - [x] change request 详情至少展示：
    - [x] 目标对象
    - [x] 变更类型
    - [x] 前后摘要
    - [x] 兼容说明
    - [x] 提交人 / 审批人 / 发布时间
  - [x] definitions 详情至少展示：
    - [x] 当前版本
    - [x] 生命周期状态
    - [x] 最近变更记录（按版本展示生命周期状态徽章；定义级最近变更记录从 Change Request 详情页查阅）
  - [x] 当前生效版本页至少展示关键统计与最近发布记录。

- [x] 与授权和审计边界对齐（AC: 4）
  - [x] 页面进入必须沿用当前服务端受保护页面模式，不得因内部后台而弱化边界（`requireOntologyAdminSession` 与 workspace pattern 对齐）。
  - [x] 与 `7.1` 的授权主线预留清晰对接点，至少区分：
    - [x] 查看治理面（`ONTOLOGY_VIEWER`）
    - [x] 提交变更（`ONTOLOGY_AUTHOR`）
    - [x] 审批（`ONTOLOGY_APPROVER`）
    - [x] 发布（`ONTOLOGY_PUBLISHER`）
  - [x] 所有关键操作应对接 `9.4` 的治理流转与 `7.2` 的审计事件，而不是只做前端按钮演示（路由层调用 `auditUseCases.recordEvent` 复用既有 `ontology.change_request.*` / `ontology.version.published` / `authorization.denied` 事件类型）。

- [x] 补齐 story 级验证（AC: 1, 2, 3, 4）
  - [x] 验证后台页面能正确展示当前版本、definitions 与 change requests（`tests/story-9-5-*` AC1+AC3、AC1 definitions 视图）。
  - [x] 验证审批/驳回/发布操作走正式服务端用例（AC2 闭环测试与发布版本测试）。
  - [x] 验证未登录或无权限场景不会进入治理后台（AC4 capability 判定与 admin auth 测试）。
  - [x] 验证关键操作后页面状态与平台事实一致（AC2 发布版本：CR -> published、Overview 切换 currentPublishedVersion、Publish History 顶部命中）。

### Review Findings

- [x] [Review][Patch] 默认运行时仍读取 approved 未发布版本，违反“published 才生效”边界 [src/application/ontology/use-cases.ts:115]
- [x] [Review][Patch] publishVersion 跨多张治理表更新但没有事务，失败会留下半发布状态 [src/application/ontology/governance-use-cases.ts:168]
- [x] [Review][Patch] 变更前后摘要 JSON 解析失败被静默置空，后台会成功创建缺失差异信息的 CR [src/app/api/admin/ontology/change-requests/route.ts:18]

## Dev Notes

- `9.5` 要做的是**最小治理管理面**，不是做一个完整知识平台。
- 重点是把 `9.4` 的治理流程变成真正可运营的界面，而不是继续只能靠脚本或手工改库。
- 如果最后页面只是展示列表，但审批和发布还要手工调脚本，这张 story就没完成。
- 反过来，也不要一上来做富编辑器、复杂 diff builder、可视化 schema designer；首期先把“可看、可审、可发”站稳。

### Review Adjustments

- 建议把最小后台 IA 直接写死，避免后续实现变成传统 CRUD 后台：
  - `Overview`
  - `Definitions`
  - `Change Requests`
  - `Publish History`
- 默认落地页建议是 `Overview`，优先展示：
  - 当前生效版本
  - 待审批事项
  - 最近发布
  - 风险提示
- `Definitions` 页面应偏“查阅与追溯”，不是首期就承担复杂编辑器职责；变更动作优先从 detail 页发起 change request，而不是直接原位改 definition。

### Architecture Compliance

- 必须遵循 [ontology-governance-architecture.md]({project-root}/_bmad-output/planning-artifacts/ontology-governance-architecture.md#9.3 运营) 对“当前生效版本、deprecated 定义、待发布变更、异常结论溯源”的运营要求。
- 后台管理面只能消费正式治理用例，不得绕过到数据库层。
- 必须沿用当前 Next.js 服务端受保护页面模式，不允许把“内部后台”做成直接信任浏览器输入的弱边界页面。

### Library / Framework Requirements

- 继续沿用当前 `Next.js App Router`、服务端优先模式、现有工作台 UI 风格。
- 不新增单独的后台前端框架。
- 如需表格/详情页组件，应优先复用现有仓库样式与组件模式，不要另造一套管理后台视觉系统。

### File Structure Requirements

- 重点文件预计包括：
  - `src/app/(admin)/`
  - `src/application/ontology/`
  - `src/app/api/` 下与治理操作相关的受控入口
  - `tests/story-9-5-*.test.mjs`
- `(admin)` 目录当前只有 `.gitkeep`，这张 story 应把它升级为真正的最小管理面入口。

### Testing Requirements

- 至少覆盖：
  - 管理页加载当前版本与 change request 数据
  - 审批/驳回/发布操作链路
  - 服务端保护与无权限场景
  - UI 展示与平台事实一致
- 优先做服务端 + 页面集成测试，而不是只做组件快照。

### Previous Story Intelligence

- `9.4` 定义了 change request / approval / publish 的治理内核；`9.5` 必须直接消费它，不得页面自己发明一套状态机。
- 当前 `(admin)` 路由已经预留，但还是空目录，说明这张 story不会和既有后台产品冲突。
- Epic 7 的权限与审计主线仍然重要；`9.5` 不能绕开它们，只能预留或消费它们。

### Git Intelligence Summary

- 当前仓库最近的 UI/工作台实现已经形成稳定风格和服务端边界模式。`9.5` 应复用这些模式，而不是单独做一个“传统后台模板”。

### Latest Technical Information

- 当前项目已有真实 session / follow-up / history / execution 路径，治理后台后续需要能回溯到这些事实，但本 story 不直接改它们。
- 当前 admin 路由为空，意味着后台管理面从零开始，但边界是清晰的。

### Project Structure Notes

- 本 story 不负责核心治理状态机设计，那是 `9.4`。
- 本 story 不负责 execution / history 版本绑定，那是 `9.6`。
- 本 story 要求 UI 只是治理闭环的操作面，不是治理规则本身。

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.5: 本体治理后台管理界面]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#9.3 运营]
- [Source: _bmad-output/project-context.md#Next.js / App Router 规则]
- [Source: _bmad-output/project-context.md#关键实现规则]
- [Source: _bmad-output/implementation-artifacts/9-4-ontology-change-request-approval-and-publish-audit.md]
- [Source: src/app/(admin)/.gitkeep]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Completion Notes List

- Story created as the minimal operations surface for ontology governance, explicitly scoped to admin UI over existing governance services.
- 实现完成（2026-04-28）：
  - 在 `(admin)` 路由组建立最小后台 IA：Overview、Definitions、Change Requests（含详情）、Publish History 四个视图，默认入口 `/admin/ontology`。
  - 新建 `src/application/ontology-admin/use-cases.ts` 作为后台读模型聚合层，仅消费 9.4 `governance-use-cases.ts` 与既有 registry/governance use cases，不绕过应用层。
  - 新建 `src/infrastructure/ontology-admin/index.ts` 集中装配仓储依赖，提供 cached runtime。
  - 新建 `src/infrastructure/session/admin-auth.ts` 沿用 workspace 受保护页面模式：未登录 redirect、已登录无 governance 角色显示 access-denied。
  - 在 `src/domain/ontology/governance.ts` 引入 `ONTOLOGY_VIEWER / AUTHOR / APPROVER / PUBLISHER` 角色常量与 capability 解析（PLATFORM_ADMIN 默认全权限），与 `7.1` 授权主线对齐。
  - 写动作通过 `/api/admin/ontology/*` 受控 route handlers 执行：创建变更申请、提交审批、审批/驳回、发布版本，每条路径均通过 `authorizeGovernanceRequest` 鉴权并通过 `auditUseCases.recordEvent` 复用既有 `ontology.change_request.*` / `ontology.version.published` / `authorization.denied` 事件类型，无额外审计协议。
  - 扩展现有 store 端口最小必要方法：`OntologyChangeRequestStore.listRecent`、`OntologyPublishRecordStore.listRecent`、`OntologyVersionStore.listRecent`，对应 postgres 实现。
  - Story 级集成测试 `tests/story-9-5-ontology-governance-admin-console.test.mjs` 当前覆盖 capability 解析、loadOverview 读模型、create→submit→approve 闭环、publishVersion 切换 currentPublishedVersion、definitions 投影、列表稳定性、capability gate、审计事件契约，以及 review 修复回归（published-only runtime、publish 事务回滚、非法 JSON fail loud）共 15 条测试，全部通过。
  - 与 9.4 既有 `tests/story-9-4-ontology-change-governance.test.mjs` 联跑回归 23/23 通过。
  - `pnpm lint` 通过，`pnpm build` 成功并已注册全部新路由。
- 设计取舍：
  - 首期未做富 schema 编辑器；所有 definition 级变更只能从 Change Request 详情页发起或经已有 use case 写入（与 Story 9.4 / 9.7 边界一致）。
  - 审批/发布按钮的可见性由 `capabilities` + 当前 CR/version 状态共同决定；无权限时显式提示而不是隐藏页面，避免“静默降级”。
  - 路由层 `authorizeGovernanceRequest` 在拒绝时会写入 `authorization.denied` 审计事件，不静默吞掉未授权访问。
- Review 收口（2026-05-05）：
  - 三项 review patch 已完成并在 story 文件中标记为 resolved：运行时只读取 approved + published 版本；`publishVersion` 多表写入已进入单事务；change request JSON 摘要解析失败改为 fail loud。
  - 当前主干验证通过：`pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm build`。
  - 在隔离临时数据库 `ontology_agent_status_check` 中联跑 `tests/story-9-4-ontology-change-governance.test.mjs` 与 `tests/story-9-5-ontology-governance-admin-console.test.mjs`，结果 27/27 通过。默认本地库曾因历史测试数据含 `publishedAt=2099-01-01` 的 `test-gov-runtime-*` 记录出现假红，已确认为测试数据污染，不作为代码失败结论。

### File List

- _bmad-output/implementation-artifacts/9-5-ontology-governance-admin-console.md
- src/domain/ontology/governance.ts
- src/application/ontology/governance-ports.ts
- src/application/ontology/ports.ts
- src/application/ontology-admin/use-cases.ts
- src/infrastructure/ontology-admin/index.ts
- src/infrastructure/ontology/postgres-ontology-change-request-store.ts
- src/infrastructure/ontology/postgres-ontology-publish-record-store.ts
- src/infrastructure/ontology/postgres-ontology-version-store.ts
- src/infrastructure/session/admin-auth.ts
- src/app/(admin)/layout.tsx
- src/app/(admin)/_components/admin-shell.tsx
- src/app/(admin)/admin/page.tsx
- src/app/(admin)/admin/ontology/page.tsx
- src/app/(admin)/admin/ontology/definitions/page.tsx
- src/app/(admin)/admin/ontology/change-requests/page.tsx
- src/app/(admin)/admin/ontology/change-requests/[id]/page.tsx
- src/app/(admin)/admin/ontology/publishes/page.tsx
- src/app/api/admin/ontology/_helpers.ts
- src/app/api/admin/ontology/change-requests/route.ts
- src/app/api/admin/ontology/change-requests/[id]/submit/route.ts
- src/app/api/admin/ontology/change-requests/[id]/review/route.ts
- src/app/api/admin/ontology/versions/[id]/publish/route.ts
- tests/story-9-5-ontology-governance-admin-console.test.mjs

### Change Log

- 2026-04-28 完成 Story 9.5 实现：建立 ontology 治理最小管理面（Overview/Definitions/Change Requests/Publish History），通过 admin use cases 与受控 route handlers 与 9.4 治理内核对接，沿用 7.1/7.2 授权与审计主线。新增 ontology governance 角色族与 capability 判定。Story 级集成测试 10 条全部通过；9.4 联合回归 23/23 通过；lint + build 通过。
- 2026-05-05 收口 Story 9.5 review：三项 Review Findings 标记完成，story 状态由 review 切换为 done；sprint-status 同步更新为 done。
