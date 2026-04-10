# Story 7.7: 图谱增量扫描与脏范围派发

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 企业运维负责人,
I want 平台按 watermark 识别变更并派发 dirty scope 重建,
so that Neo4j 图谱可以持续跟上 ERP staging 的变化，而不是长期依赖手工全量重刷。

## Acceptance Criteria

1. 当增量扫描任务运行时，系统必须基于各 source 的 watermark 识别变更记录，并将受影响的 `organizationId` 写入 dirty scope 队列。
2. 当 dirty scope 被消费时，系统必须以 `organizationId` 为最小增量单元派发 `org-rebuild`，而不是按单条记录直接 patch 图边。
3. 当增量处理完成时，系统只能在对应 dirty scope 成功落完并确认后推进相应 cursor，不得因单次失败或部分成功导致 cursor 错误前移。

## Tasks / Subtasks

- [x] 建立增量 cursor 模型与持久化表（AC: 1, 3）
  - [x] 为 `platform.graph_sync_cursors` 增加 Drizzle schema 与迁移，至少覆盖 `source_name`、`cursor_time`、`cursor_pk`、`last_run_id`、`updated_at`。
  - [x] 为每个 source 明确初始命名与候选字段，至少包括 `erp.organizations / projects / owners / charge_items / receivables / payments / service_orders`。
  - [x] 统一采用“时间戳 + 主键”复合游标语义；若某 source 只能退化为主键扫描，必须记录在 run error/detail 或等价诊断上下文中。
- [x] 建立 dirty scope 队列表与语义去重（AC: 1, 2, 3）
  - [x] 为 `platform.graph_sync_dirty_scopes` 增加 Drizzle schema 与迁移，至少覆盖 `id`、`scope_type`、`scope_key`、`reason`、`source_name`、`source_pk`、`first_detected_at`、`last_detected_at`、`status`、`attempt_count`、`last_run_id`。
  - [x] 保证 pending 状态下的 `(scope_type, scope_key)` 语义去重，避免同一组织因短时间多条变更无限堆积重复任务。
  - [x] 明确状态流转最少包含 `pending / processing / completed / failed`。
- [x] 实现 watermark 扫描与组织范围提取（AC: 1）
  - [x] 新增 graph sync incremental scanner use case，按 source 读取 cursor、扫描变更并提取受影响 `organizationId`。
  - [x] 组织范围提取遵循 [graph-sync-operating-model.md]({project-root}/docs/data-contracts/graph-sync-operating-model.md) 中定义的 source 规则，特别是：
    - `projects` 取 `org_id` 或修正后的 `organization_id`
    - `receivables / payments / service_orders` 直接取 `organization_id`
    - `charge_items` 若无稳定组织归属，不得单独直接派发全局范围
  - [x] 对扫描结果写入 dirty scope，而不是在 scanner 阶段直接触发 Neo4j rebuild。
- [x] 实现 dirty scope dispatcher 与 cursor 推进边界（AC: 2, 3）
  - [x] dispatcher 必须消费 pending dirty scope，并调用 `7.6` 提供的 `org-rebuild` 正式执行单元。
  - [x] cursor 推进必须发生在成功派发并完成对应组织重建之后，不能在“只扫描到变更”后立即前移。
  - [x] 若某组织 rebuild 失败，dirty scope 必须保留失败状态与重试信息，cursor 不得跳过该 source 的未完成处理。
- [x] 补齐增量扫描与派发测试（AC: 1, 2, 3）
  - [x] 验证按复合游标只扫描新变更，避免同一窗口重复或漏扫。
  - [x] 验证多条变更命中同一组织时只生成一个 pending dirty scope。
  - [x] 验证 dirty scope 成功后才推进 cursor，失败时 cursor 保持不变。
  - [x] 验证 dispatcher 最终调用的是组织级 `org-rebuild`，而不是单记录 patch。

## Dev Notes

- 这张 story 是 graph sync 运行化的“增量入口”，但它仍然**不负责 scheduler 与周期调度**；那部分属于 `7.8`。`7.7` 只负责：
  - 如何扫描
  - 如何派发
  - cursor 什么时候能前进
- 不要把 `7.7` 做成“扫描到一条记录就立刻写一条边”的 CDC patch 系统。当前路线已经明确选择：
  - 变更发现用 watermark
  - 图修复用 `org-rebuild`
- 这一层最危险的 bug 有两个：
  - cursor 提前推进，导致漏同步
  - dirty scope 不去重，导致同一组织 rebuild 风暴
  这两个都应按 blocker 级别防守。
- 当前最小增量单元仍然是 `organizationId`。不要在 `7.7` 里提前引入 `projectId` 级调度优化，否则会把 `7.6` 的 run/cleanup 设计打碎。
- 如果某些 source 时间字段质量差，允许先保守退化，但必须把降级路径显式记录出来，不能静默“扫描不到就算了”。

### Architecture Compliance

- 必须遵循 [graph-sync-operating-model.md]({project-root}/docs/data-contracts/graph-sync-operating-model.md) 的路线：增量阶段优先按 `organizationId` 重建，避免逐条 CDC patch 图边。
- scanner、dirty scope queue、dispatcher 都属于 graph sync 运行管理层，应位于 `application / infrastructure` 受控边界内，不得散落在脚本中拼接。
- cursor 推进语义必须与 `7.6` 的 run 记录联动，确保“扫描成功”与“组织重建成功”不是同一件事。
- dispatch 最终必须调用受控 `org-rebuild` 执行单元，而不是绕过运行元数据直接再次拼 baseline 脚本。

### Library / Framework Requirements

- 数据库与迁移继续沿用现有 `Drizzle ORM` 与平台 schema。
- 增量扫描暂不引入外部调度器、队列框架或 CDC 平台；保持仓库当前轻量、受控的实现边界。
- 测试继续使用项目现有 `node:test` 风格；涉及多个 story 测试的回归继续串行执行。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/graph-sync/`
  - `src/infrastructure/graph-sync/` 或等价目录中的 cursor / dirty scope repository
  - `src/db/schema/` 或现有平台 schema 定义位置中的 `graph_sync_cursors` / `graph_sync_dirty_scopes`
  - `drizzle/` 迁移文件
  - `scripts/` 下的 incremental 或 dispatch 入口脚本
  - `tests/story-7-7-*.test.mjs` 或等价测试文件

### Testing Requirements

- 至少覆盖：
  - 复合游标扫描
  - dirty scope 去重
  - 成功后推进 cursor
  - 失败不推进 cursor
  - dispatcher 调用 `org-rebuild`

### Previous Story Intelligence

- [Story 7.6]({project-root}/_bmad-output/implementation-artifacts/7-6-graph-sync-run-metadata-and-org-rebuild.md) 应先提供正式 `org-rebuild` 单元与 graph sync run metadata；`7.7` 必须建立在它之上，而不是重复实现 run 逻辑。
- [Story 4.5]({project-root}/_bmad-output/implementation-artifacts/4-5-neo4j-graph-adapter-and-sync-baseline.md) 已站稳 baseline builder 与 controlled sync path，所以增量派发必须复用既有 graph sync use case。
- [graph-sync-operating-model.md]({project-root}/docs/data-contracts/graph-sync-operating-model.md) 已明确 source 提取规则、cursor 语义和 dirty scope 路线，`7.7` 的实现不应偏离该文档。
- 最近提交 [06bf22f]({project-root}/.git) 说明 graph sync 和真实分析执行已经进入真实环境链路；因此 `7.7` 要按“生产可靠性”标准做，而不是临时脚本。

### Git Intelligence Summary

- 当前仓库最近的 graph sync 工作已经走向“真实环境可用 + 真数据回归”，说明 `7.7` 应优先补可靠性和幂等控制，而不是发明新概念层。
- 近期实现模式仍是：
  - 先把运行边界做真
  - 再补 story 级回归
  `7.7` 应继续沿用。

### Latest Technical Information

- 本故事不要求新增外部依赖，重点是把已有 baseline sync 升成增量发现与派发能力。
- 如需做唯一去重或状态更新，优先依赖 Postgres 自身约束与事务语义，不要先上复杂分布式协调。

### Project Context Reference

- [project-context.md]({project-root}/_bmad-output/project-context.md) 仍要求：
  - 业务和运行逻辑优先放到 `domain / application / infrastructure` 分层
  - 测试以故事级集成路径为主
  - 当前实现事实优先，不能把 graph sync 再当成 stub

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.7: 图谱增量扫描与脏范围派发]
- [Source: docs/data-contracts/graph-sync-operating-model.md]({project-root}/docs/data-contracts/graph-sync-operating-model.md)
- [Source: docs/data-contracts/graph-sync-baseline.md]({project-root}/docs/data-contracts/graph-sync-baseline.md)
- [Source: _bmad-output/implementation-artifacts/7-6-graph-sync-run-metadata-and-org-rebuild.md]({project-root}/_bmad-output/implementation-artifacts/7-6-graph-sync-run-metadata-and-org-rebuild.md)
- [Source: _bmad-output/implementation-artifacts/4-5-neo4j-graph-adapter-and-sync-baseline.md]({project-root}/_bmad-output/implementation-artifacts/4-5-neo4j-graph-adapter-and-sync-baseline.md)
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]({project-root}/_bmad-output/planning-artifacts/architecture.md)
- [Source: _bmad-output/planning-artifacts/prd.md#非功能需求]({project-root}/_bmad-output/planning-artifacts/prd.md)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `git log --oneline -5`
- `sed -n '1,320p' docs/data-contracts/graph-sync-operating-model.md`
- `sed -n '1,280p' _bmad-output/implementation-artifacts/7-6-graph-sync-run-metadata-and-org-rebuild.md`
- `node --test tests/story-7-7-graph-sync-incremental.test.mjs`
- `node --test tests/story-4-5-graph-sync-use-cases.test.mjs tests/story-7-6-graph-sync-runtime.test.mjs tests/story-7-7-graph-sync-incremental.test.mjs`
- `pnpm lint`
- `pnpm build`
- `node --test --test-concurrency=1 tests/*.test.mjs`

### Completion Notes List

- 新增 graph sync 增量运行模型，落地复合游标、dirty scope 聚合与按组织派发的 application 层 use case。
- 新增 Postgres cursor / dirty scope schema、迁移与 repository，实现 pending 语义去重、source 级状态流转与成功后 cursor 推进。
- 新增 source scan port 与增量执行脚本，按 operating model 的 source 规则提取 `organizationId`，并复用 `7.6` 的正式 `org-rebuild` 执行单元。
- 补齐 `7.7` 故事回归测试，并验证 `4.5 + 7.6 + 7.7` 定向回归、`lint` 与 `build` 通过。
- 全量串行回归仍存在仓库既有失败，主要集中在登录/工作台链路和依赖 `pnpm db:migrate` 的早期 stories，不属于本次 `7.7` 改动引入。

### File List

- _bmad-output/implementation-artifacts/7-7-graph-sync-incremental-scan-and-dirty-scope-dispatch.md
- drizzle/0007_graph_sync_incremental_runtime.sql
- package.json
- scripts/sync-neo4j-incremental.mts
- src/application/graph-sync/incremental-use-cases.ts
- src/application/graph-sync/runtime-ports.ts
- src/domain/graph-sync/models.ts
- src/infrastructure/graph-sync/postgres-graph-sync-cursor-store.ts
- src/infrastructure/graph-sync/postgres-graph-sync-dirty-scope-store.ts
- src/infrastructure/graph-sync/postgres-graph-sync-source-scan-port.ts
- src/infrastructure/postgres/schema/graph-sync-cursors.ts
- src/infrastructure/postgres/schema/graph-sync-dirty-scopes.ts
- src/infrastructure/postgres/schema/index.ts
- tests/story-7-7-graph-sync-incremental.test.mjs

### Change Log

- 2026-04-08: 实现 graph sync 增量扫描、dirty scope 派发、cursor 推进控制与 story 级回归验证。
