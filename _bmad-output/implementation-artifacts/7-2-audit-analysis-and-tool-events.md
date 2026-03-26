# Story 7.2: 记录分析与工具调用审计日志

Status: ready-for-dev

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

- [ ] 建立 audit domain model 与持久化表（AC: 1, 2, 3）
  - [ ] 为用户、组织、会话、事件类型、结果、trace / correlation id 建立结构。
  - [ ] 区分审计记录与普通应用日志。
- [ ] 接入关键写入点（AC: 1, 2）
  - [ ] 覆盖分析请求、关键工具调用、权限失败等事件。
  - [ ] 审计内容需脱敏，不能写入原始敏感 payload 或密钥。
- [ ] 覆盖保留与访问边界测试（AC: 2, 3）
  - [ ] 验证成功与失败事件都记录。
  - [ ] 验证普通业务用户不可直接查看全量审计。

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

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/7-2-audit-analysis-and-tool-events.md
