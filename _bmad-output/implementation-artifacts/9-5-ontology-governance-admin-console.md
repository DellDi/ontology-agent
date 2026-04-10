# Story 9.5: 本体治理后台管理界面

Status: ready-for-dev

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

- [ ] 建立 ontology governance admin 的最小信息架构（AC: 1, 2, 4）
  - [ ] 基于现有 `(admin)` 路由预留目录建立最小后台导航与页面骨架。
  - [ ] 至少覆盖这些视图：
    - [ ] 当前生效版本概览
    - [ ] ontology definitions 列表 / 详情
    - [ ] change request 列表 / 详情
    - [ ] approval / publish 操作入口
  - [ ] 首期优先做“列表 + 详情 + 明确操作”，不要求复杂 schema 编辑器。

- [ ] 接入正式治理 use cases，而不是页面直连数据表（AC: 1, 2, 3）
  - [ ] 页面数据读取必须通过 `src/application/ontology/` 下的正式 use cases。
  - [ ] 审批、驳回、发布等写操作必须通过服务端 route / action + 应用层用例执行。
  - [ ] 明确哪些页面是只读投影，哪些页面触发治理动作。

- [ ] 展示变更差异、兼容说明与审计信息（AC: 1, 2, 3)
  - [ ] change request 详情至少展示：
    - [ ] 目标对象
    - [ ] 变更类型
    - [ ] 前后摘要
    - [ ] 兼容说明
    - [ ] 提交人 / 审批人 / 发布时间
  - [ ] definitions 详情至少展示：
    - [ ] 当前版本
    - [ ] 生命周期状态
    - [ ] 最近变更记录
  - [ ] 当前生效版本页至少展示关键统计与最近发布记录。

- [ ] 与授权和审计边界对齐（AC: 4）
  - [ ] 页面进入必须沿用当前服务端受保护页面模式，不得因内部后台而弱化边界。
  - [ ] 与 `7.1` 的授权主线预留清晰对接点，至少区分：
    - [ ] 查看治理面
    - [ ] 提交变更
    - [ ] 审批
    - [ ] 发布
  - [ ] 所有关键操作应对接 `9.4` 的治理流转与 `7.2` 的审计事件，而不是只做前端按钮演示。

- [ ] 补齐 story 级验证（AC: 1, 2, 3, 4）
  - [ ] 验证后台页面能正确展示当前版本、definitions 与 change requests。
  - [ ] 验证审批/驳回/发布操作走正式服务端用例。
  - [ ] 验证未登录或无权限场景不会进入治理后台。
  - [ ] 验证关键操作后页面状态与平台事实一致。

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

### File List

- _bmad-output/implementation-artifacts/9-5-ontology-governance-admin-console.md
