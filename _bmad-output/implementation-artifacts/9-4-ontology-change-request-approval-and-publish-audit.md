# Story 9.4: 本体变更申请、审批与发布审计

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台治理负责人,
I want 对 ontology 变更建立 change request、approval 和 publish 流程,
so that 口径、关系、计划模板和证据定义具备正式治理与审计能力。

## Acceptance Criteria

1. 当某个 ontology definition 需要新增、修改、废弃或发布时，系统必须记录正式的 change request，而不是直接改 canonical definitions 表。
2. 每个 ontology change request 必须至少记录：目标对象、变更类型、变更前后摘要、影响范围、兼容说明、提交人、审批状态、发布状态和时间戳。
3. 只有通过审批并正式发布的 ontology version 或 definition 变更，才能进入默认运行时路径；未审批、未发布或被驳回的内容不得静默生效。
4. 变更流程与审计语义必须能够与 Epic 7 的服务端授权和审计主线对齐，避免形成第二套孤立治理协议。

## Tasks / Subtasks

- [x] 建立 ontology change governance 的平台表结构（AC: 1, 2, 3, 4）
  - [x] 在 `src/infrastructure/postgres/schema/` 下新增以下表：
    - [x] `platform.ontology_change_requests`
    - [x] `platform.ontology_approval_records`
    - [x] `platform.ontology_publish_records`
  - [x] 明确定义最小状态机，覆盖：
    - [x] `draft`
    - [x] `submitted`
    - [x] `approved`
    - [x] `rejected`
    - [x] `published`
    - [x] `superseded`
  - [x] 状态模型通过 FK 与 `ontology_versions` 关联。

- [x] 建立 change request / approval / publish 的领域模型与应用层用例（AC: 1, 2, 3）
  - [x] 在 `src/domain/ontology/` 下增加变更申请、审批记录、发布记录及生命周期模型。
  - [x] 在 `src/application/ontology/` 下建立最小用例，至少覆盖：
    - [x] 提交 change request
    - [x] 审批 / 驳回
    - [x] 发布 approved 版本
    - [x] 查询当前待审与已发布记录
  - [x] 发布时必须显式更新“当前生效版本”或等价指针，不允许依赖隐式最新版本规则。

- [x] 建立兼容与发布约束（AC: 2, 3）
  - [x] 为 change request 增加兼容性说明字段或等价结构，明确：
    - [x] 向后兼容
    - [x] 非兼容变更
    - [x] 影响哪些 metrics / factors / plan steps / tool bindings
  - [x] 对未 `approved` 或未 `published` 的变更，运行时读取路径必须 fail loud 或明确忽略，不得静默进入默认执行。
  - [x] 若当前代码仍需要兼容“直接读 approved definition”的路径，也必须明确 publish 语义的最终权威位置。

- [x] 与授权与审计主线对齐（AC: 4）
  - [x] 在 story 设计中明确与 `7.1` 的权限边界对接点，至少区分：
    - [x] 提交权限
    - [x] 审批权限
    - [x] 发布权限
  - [x] 在 story 设计中明确与 `7.2` 的审计对接点，至少记录：
    - [x] 谁提交
    - [x] 谁审批
    - [x] 谁发布
    - [x] 变更对象和影响范围
  - [x] 本 story 不实现管理后台页面，那属于 `9.5`；但必须提供 UI 可消费的稳定服务端契约。

- [x] 补齐 story 级验证（AC: 1, 2, 3, 4）
  - [x] 验证 change request 的创建、审批、驳回、发布状态流转。
  - [x] 验证只有 approved + published 的变更进入默认运行时。
  - [x] 验证审计字段和责任归属字段被正确记录。
  - [x] 验证当前生效版本的切换不依赖“最新时间戳即生效”这种隐式逻辑。

## Dev Notes

- `9.4` 是治理闭环第一次真正成形的 story。重点不是“再多加几张表”，而是把“知识变更必须经过正式流程”这件事做成系统规则。
- 这张 story 解决的是：
  - 谁能提
  - 谁能审
  - 谁能发
  - 发布后什么才算默认生效
- 如果最后只是有几张 change request 表，但运行时仍然直接读最新 definition，这张 story就算没完成。

### Review Adjustments

- 发布语义建议明确为“默认运行时只认 `published ontology version`”，不要让 definition 级零散发布直接进入默认路径，否则后续很容易出现半发布状态。
- 如必须支持 definition 级变更，也应把它归并到某个 version 的发布批次内，并定义原子切换点，避免 metric、time semantic、factor 组合不完整。
- 文档应明确 `approved != published`。审批通过只代表可发布，默认运行时是否生效应以 publish record 或当前生效版本指针为准。

### Architecture Compliance

- 必须遵循 [ontology-governance-architecture.md]({project-root}/_bmad-output/planning-artifacts/ontology-governance-architecture.md#8.3 变更流程) 与 [ontology-governance-architecture.md]({project-root}/_bmad-output/planning-artifacts/ontology-governance-architecture.md#8.4 审计要求)。
- 必须与 `Epic 7.1 / 7.2` 对齐，不得形成“本体治理自己一套权限、自己一套审计”的孤岛。
- 发布状态必须是运行时是否可见的正式边界，不能继续依赖代码里散落的“approved 即可用”隐含假设。

### Library / Framework Requirements

- 继续沿用 `Drizzle ORM`、`Postgres platform schema` 和当前 application use case 模式。
- 不引入单独的 workflow engine 或审批引擎。
- 通过正式领域模型表达状态流转，不在页面或脚本里硬编码审批逻辑。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/ontology/`
  - `src/application/ontology/`
  - `src/infrastructure/postgres/schema/ontology-*.ts`
  - `src/infrastructure/ontology/`
  - `drizzle/` 后续迁移
  - `tests/story-9-4-*.test.mjs`
- 本 story 不要求增加 `(admin)` 页面文件。

### Testing Requirements

- 至少覆盖：
  - change request 提交
  - approval / rejection
  - publish 切换当前生效版本
  - 未审批 / 未发布定义无法进入默认运行时
  - 审计字段完整记录

### Previous Story Intelligence

- `9.1` 提供 canonical registry 与版本模型。
- `9.2` 提供受治理 definitions。
- `9.4` 在它们之上建立“怎么改、谁批准、何时生效”的正式流程。
- `9.5` 将消费本 story 暴露的服务端契约，因此本 story 要优先把接口和状态语义站稳。

### Git Intelligence Summary

- 当前仓库近期实现模式偏向“先建平台事实，再接运行层，再补 UI”。`9.4` 应继续这个顺序，不要反过来先做管理页面再补治理内核。

### Latest Technical Information

- 当前项目已经有真实 execution / follow-up / graph sync 运行元数据，说明平台对“运行事实 + 状态流转”已有成熟模式可复用。
- ontology governance 应延续这种“平台表 + 应用层用例 + story 级验证”的做法。

### Project Structure Notes

- `(admin)` 路由目前只有预留目录，`9.4` 不需要先把 UI 填起来。
- 当前项目强调 Root-Cause First 与可审计性；本 story 应把“发布才生效”定义成正式系统规则，而不是人为约定。

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.4: 本体变更申请、审批与发布审计]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#4.5 Policy & Governance Registry]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#8.3 变更流程]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#8.4 审计要求]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#9.1 权限]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#9.2 审计]
- [Source: _bmad-output/implementation-artifacts/9-1-minimal-ontology-registry-and-version-model.md]
- [Source: _bmad-output/implementation-artifacts/9-2-govern-metric-variant-factor-and-time-semantics.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Completion Notes List

- Story created as the governance workflow core for Epic 9, intentionally excluding admin UI while defining the lifecycle that later UI must consume.

### File List

- _bmad-output/implementation-artifacts/9-4-ontology-change-request-approval-and-publish-audit.md
- src/domain/ontology/governance.ts
- src/application/ontology/governance-ports.ts
- src/application/ontology/governance-use-cases.ts
- src/infrastructure/postgres/schema/ontology-change-requests.ts
- src/infrastructure/postgres/schema/ontology-approval-records.ts
- src/infrastructure/postgres/schema/ontology-publish-records.ts
- src/infrastructure/postgres/schema/index.ts
- src/infrastructure/ontology/postgres-ontology-change-request-store.ts
- src/infrastructure/ontology/postgres-ontology-approval-record-store.ts
- src/infrastructure/ontology/postgres-ontology-publish-record-store.ts
- src/infrastructure/ontology/postgres-ontology-version-store.ts
- src/application/ontology/ports.ts
- src/domain/audit/models.ts
- drizzle/0004_9-4-ontology-change-governance.sql
- drizzle/meta/_journal.json
- tests/story-9-4-ontology-change-governance.test.mjs
