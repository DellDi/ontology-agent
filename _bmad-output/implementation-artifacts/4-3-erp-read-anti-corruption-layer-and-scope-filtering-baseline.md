# Story 4.3: ERP 只读防腐层与权限过滤数据访问基线

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 建立 ERP 只读防腐层并在服务端完成 scope 过滤,
so that 分析链路可以读取真实业务数据而不绕过既有权限边界。

## Acceptance Criteria

1. 平台读取组织、项目、区域或业务事实数据时，必须通过只读 anti-corruption layer 进入 ERP 契约，而不是让上层 story 直接依赖 ERP 表结构。
2. 返回分析链路前，系统必须基于当前会话中的组织 / 项目 / 区域 scope 完成权限过滤。
3. 当 ERP 原始数据需要清洗、映射或字段语义转换时，必须在防腐层或其上游的受控同步流程中完成，而不是让执行故事直接面对脏数据或 ERP 原始命名。

## Tasks / Subtasks

- [x] 梳理 ERP 读取契约与平台领域映射（AC: 1, 3）
  - [x] 明确当前 MVP 真正需要读取的组织、项目、区域、收费、工单、投诉、满意度等最小事实集合。
  - [x] 为 ERP 原始字段到平台领域对象建立映射，不把 ERP 内部命名泄漏给上层。
- [x] 建立只读防腐层与 scope filtering（AC: 1, 2, 3）
  - [x] 在服务端新增 ERP read adapter / repository / anti-corruption service。
  - [x] 将当前登录会话中的组织与项目 scope 纳入查询边界和结果过滤。
- [x] 定义数据清洗与 staging 边界（AC: 3）
  - [x] 若 ERP 原始表存在脏字段、历史口径差异或冗余拼接逻辑，先在受控 read model / staging / view 中完成清洗。
  - [x] 不允许把执行故事的业务逻辑建立在原始脏表直接读取之上。
- [x] 覆盖访问与权限测试（AC: 1, 2, 3）
  - [x] 验证 scope 外项目或区域无法被分析链路读取。
  - [x] 验证上层服务依赖平台领域模型而不是 ERP 表名。
  - [x] 验证数据缺失、脏值与映射失败的稳定兜底。

## Dev Notes

- 这是“真实业务数据第一次进入产品分析链路”的关键故事。
- 如果你要把公司现有业务表真正接进产品，第一落点不是 5.x 执行故事，而是本故事定义的 ERP read boundary。
- 数据清洗不是等执行层发现问题再补；最少的字段标准化、口径对齐和权限切片，应在这里或其上游 staging 层完成。

### Architecture Compliance

- 必须遵循架构中的 `ERP Read Anti-Corruption Layer` 边界。
- 平台自有表继续由 Drizzle 管理；ERP schema 仍视为外部契约。
- 浏览器端不得直连 ERP 数据源，所有 ERP 访问只能经由服务端受控边界。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/erp-read/`
  - `src/infrastructure/erp/`
  - 视需要新增受控 read model / staging schema 说明文档
  - 与权限 scope 结合的应用服务或 repository

### Testing Requirements

- 至少覆盖：
  - ERP 只读适配器存在
  - scope 过滤生效
  - 领域映射不泄露 ERP 原始结构
  - 脏数据 / 空值 / 映射失败兜底

### Previous Story Intelligence

- Story 1.2 与 2.3 已建立服务端会话和 scope 基础，4.3 要把这些权限上下文真正带入数据读取边界。
- Story 3.4 的候选因素扩展和 Story 3.5 的分析计划，后续都会依赖这里提供的真实业务事实输入。
- Story 4.4 的 Cube 语义层和 Story 4.5 的图谱同步，也需要明确哪些真实业务数据从这里进入受控清洗链路。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3: ERP 只读防腐层与权限过滤数据访问基线]
- [Source: _bmad-output/planning-artifacts/prd.md#领域要求]
- [Source: _bmad-output/planning-artifacts/prd.md#全栈产品要求]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]
- [Source: _bmad-output/planning-artifacts/architecture.md#认证与安全]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test tests/story-4-3-erp-read-acl.test.mjs`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm build`
- `node --test tests/story-4-3-erp-read-acl.test.mjs`（更新后：新增运行时 scope 过滤与组织路径继承验证）
- `pnpm db:migrate`
- `node --test --test-concurrency=1 tests/story-1-2-auth.test.mjs`

### Completion Notes List

- 已根据 `docs/humen-inejct/4-3/sprint-4-3.md` 中补充的业务字典，收敛 4.3 的 MVP 范围：组织、项目、业主、收费项目、应收、实收、工单，并将投诉/满意度继续建模为工单主题的派生视图。
- 新增 `src/domain/erp-read/models.ts`，建立 ERP 读取领域模型、`ErpPermissionScope` 和 `canAccessErpScope()`，当前按“组织 -> 下级项目组织 -> projectId / ownerId / 业务事实”的链路做服务端裁剪，不再把 `areaId` 作为权限链的一部分。
- 新增 `src/application/erp-read/ports.ts` 与 `src/application/erp-read/use-cases.ts`，确保 application 层通过 `ErpReadPort` 消费 ERP 只读能力，而不是直接依赖 Drizzle / Postgres。
- 新增 `src/infrastructure/postgres/schema/erp-staging.ts`，在 `erp_staging` schema 下定义 7 张 staging 表：组织、项目、业主、收费项目、应收、实收、工单。
- 新增 `src/infrastructure/erp/postgres-erp-read-repository.ts`，实现 Postgres 只读防腐层、字段清洗、删除态剔除、当前业主过滤，以及 scope 内结果裁剪。
- 当前 staging 物理表沿用 ERP 原始主题表名，但 application / domain 只暴露平台领域对象，不泄漏 `dw_datacenter_*` 命名到上层。
- 投诉与满意度未新增独立物理表：投诉通过 `serviceStyleName = 投诉` 从工单派生，满意度通过工单上的 `satisfaction` / `satisfactionEval` 字段承接。
- 已生成 `drizzle/0002_reflective_chronomancer.sql` 以及对应 snapshot，把 `erp_staging` 结构正式纳入迁移历史。
- Story 4.3 的专属契约测试已新增为 `tests/story-4-3-erp-read-acl.test.mjs`，覆盖 staging schema、分层边界、防腐层映射、scope 过滤和脏数据兜底。
- 本次 story 相关验证通过：`node --test tests/story-4-3-erp-read-acl.test.mjs`、`pnpm lint`、`pnpm build`。
- 根据 code review 与业务纠偏，`canAccessErpScope()` 现在只保留组织与项目链路；当会话已收窄到项目时，缺少 `projectId` 的事实记录默认拒绝，但不再使用 `areaId` 做权限判断。
- 根据 code review 反馈补强了 Postgres ERP 只读仓储：项目、业主、应收、实收、工单在过滤时都会补查组织路径，使上级组织权限可以继承访问下级 `propertyProject` 数据；`ChargeItem` 明确不做权限控制。
- `tests/story-4-3-erp-read-acl.test.mjs` 已从源码字符串检查升级为运行时验证，现可实际覆盖“缺少 projectId 的事实记录被拒绝”“ChargeItem 不做权限裁剪”和“上级组织通过路径继承访问下级项目/收费事实”三类场景。
- 当前与 4.3 直接相关的环境验证也已补齐：`pnpm db:migrate` 已通过，`tests/story-1-2-auth.test.mjs` 代表的旧登录链路也已恢复通过，不再作为本 story 的残余风险。

### File List

- _bmad-output/implementation-artifacts/4-3-erp-read-anti-corruption-layer-and-scope-filtering-baseline.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- drizzle/0002_reflective_chronomancer.sql
- drizzle/meta/0002_snapshot.json
- drizzle/meta/_journal.json
- src/application/erp-read/ports.ts
- src/application/erp-read/use-cases.ts
- src/domain/erp-read/models.ts
- src/infrastructure/erp/postgres-erp-read-repository.ts
- src/infrastructure/postgres/schema/erp-staging.ts
- src/infrastructure/postgres/schema/index.ts
- tests/story-4-3-erp-read-acl.test.mjs

## Change Log

- 2026-04-03：完成 Story 4.3 的 ERP staging schema、只读防腐层、scope 过滤规则与契约测试基线。
