# Story 4.3: ERP 只读防腐层与权限过滤数据访问基线

Status: ready-for-dev

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

- [ ] 梳理 ERP 读取契约与平台领域映射（AC: 1, 3）
  - [ ] 明确当前 MVP 真正需要读取的组织、项目、区域、收费、工单、投诉、满意度等最小事实集合。
  - [ ] 为 ERP 原始字段到平台领域对象建立映射，不把 ERP 内部命名泄漏给上层。
- [ ] 建立只读防腐层与 scope filtering（AC: 1, 2, 3）
  - [ ] 在服务端新增 ERP read adapter / repository / anti-corruption service。
  - [ ] 将当前登录会话中的组织与项目 scope 纳入查询边界和结果过滤。
- [ ] 定义数据清洗与 staging 边界（AC: 3）
  - [ ] 若 ERP 原始表存在脏字段、历史口径差异或冗余拼接逻辑，先在受控 read model / staging / view 中完成清洗。
  - [ ] 不允许把执行故事的业务逻辑建立在原始脏表直接读取之上。
- [ ] 覆盖访问与权限测试（AC: 1, 2, 3）
  - [ ] 验证 scope 外项目或区域无法被分析链路读取。
  - [ ] 验证上层服务依赖平台领域模型而不是 ERP 表名。
  - [ ] 验证数据缺失、脏值与映射失败的稳定兜底。

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

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/4-3-erp-read-anti-corruption-layer-and-scope-filtering-baseline.md
