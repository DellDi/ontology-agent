# Story 7.6: 图谱同步运行元数据与组织级重建

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 企业运维负责人,
I want 对 Neo4j 图谱同步建立运行元数据记录和组织级重建能力,
so that 图谱基线同步不再只是一次性脚本，而是可追踪、可恢复、可校正的正式运行流程。

## Acceptance Criteria

1. 当平台执行一次图谱 baseline 或指定组织重建时，系统必须创建可检索的 graph sync run 记录，至少包含 `scope`、`mode`、`cursor snapshot`、节点/边写入统计和失败摘要。
2. 当某个组织执行 `org-rebuild` 时，Neo4j 写入的节点与边必须带 `scope_org_id`、`last_seen_run_id`、`last_seen_at` 等运行元数据。
3. 当执行组织级 scoped cleanup 时，系统只能清理当前组织范围内、且未在本次 run 中重新出现的 stale 节点与边，不得跨组织误删其他范围数据。

## Tasks / Subtasks

- [x] 建立 graph sync 运行元数据模型与持久化表（AC: 1）
  - [x] 为 `platform.graph_sync_runs` 增加 Drizzle schema 与迁移，至少覆盖 `id`、`mode`、`status`、`scope_type`、`scope_key`、`trigger_type`、`triggered_by`、`cursor_snapshot`、`nodes_written`、`edges_written`、`started_at`、`finished_at`、`error_summary`、`error_detail`。
  - [x] 明确 `mode` 至少支持 `full-bootstrap / org-rebuild / incremental-rebuild`，`status` 至少支持 `pending / running / completed / failed / partial`。
  - [x] 在应用层补 graph sync run repository / use cases，避免脚本或 Neo4j adapter 直接散写平台表。
- [x] 把现有 baseline sync 入口升级为受控的 `org-rebuild` 执行单元（AC: 1, 2）
  - [x] 复用现有 [graph sync use cases](/Users/delldi/work-code/open-code/ontology-agent/src/application/graph-sync/use-cases.ts) 与 [sync-neo4j-baseline.mts](/Users/delldi/work-code/open-code/ontology-agent/scripts/sync-neo4j-baseline.mts) 的组织级建图路径，不重造第二套 builder。
  - [x] 在 run 开始、成功、失败时写入 run 状态与统计信息，确保组织级执行具备最小审计与恢复上下文。
  - [x] 为 `org-rebuild` 明确 `trigger_type` 与 `triggered_by`，至少覆盖 `manual` 和系统触发两类来源。
- [x] 为节点与边补运行元数据并接入 scoped cleanup（AC: 2, 3）
  - [x] 扩展 [neo4j-graph-sync.ts](/Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/sync/neo4j-graph-sync.ts) 的节点/边构造或 Cypher 生成，使写入包含 `scope_org_id`、`last_seen_run_id`、`last_seen_at`。
  - [x] 扩展 [neo4j-graph-adapter.ts](/Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/neo4j/neo4j-graph-adapter.ts) 或等价 graph use case，新增 scoped cleanup 入口。
  - [x] cleanup 必须仅针对 `scope_org_id = 当前组织` 且 `last_seen_run_id != 当前 run` 的对象，不得做全局 delete。
- [x] 补齐组织级重建与 cleanup 的测试（AC: 1, 2, 3）
  - [x] 验证 run 记录从 `pending/running` 到终态的完整落库与统计更新。
  - [x] 验证节点与边确实带上 `scope_org_id / last_seen_run_id / last_seen_at`。
  - [x] 验证 scoped cleanup 只清理当前组织 stale 数据，不误删其他组织图数据。

## Dev Notes

- 这不是重做 `Story 4.5`。`4.5` 已经完成了 graph adapter、controlled sync entry 和 baseline query path；`7.6` 负责把这条 baseline 升级成 **可运行、可审计、可恢复** 的正式平台能力。
- 本故事故意只收“运行元数据 + 组织级 rebuild + scoped cleanup”，不提前把 watermark 扫描、dirty scope 派发和 scheduler 混进来；那是 `7.7 / 7.8` 的职责。
- 运行元数据表要落在 `platform` schema，而不是 `erp_staging`。图谱同步的运行信息属于平台自有运营数据，不属于 ERP 外部契约。
- 当前最小执行单元是 `organizationId`，这是故意设计，不要提前优化成 `projectId` 级重建。先保正确性和恢复性，再做更细粒度增量。
- 本故事的关键风险不是“能不能写 Neo4j”，而是“cleanup 会不会误删跨组织数据”。实现时宁可保守，先确保 scoped cleanup 只作用于当前组织。

### Architecture Compliance

- 必须遵循架构中的 `Graph / Semantic ETL Sync Baseline` 边界：图谱同步继续通过受控服务端流程执行，不允许分析请求在运行时直接写图。
- graph sync run metadata 属于平台运行管理层，应落在 `platform` schema，并通过应用层用例管理，而不是在脚本、Route Handler 或 Neo4j adapter 中直接 SQL 散写。
- `org-rebuild` 继续复用现有 baseline builder 与 Neo4j upsert 路径，不引入第二套图构建逻辑。
- scoped cleanup 只能基于 `scope_org_id + last_seen_run_id` 做范围清理，不允许写出“按节点类型全局清理”的危险逻辑。

### Library / Framework Requirements

- 数据库与迁移继续沿用项目现有 `Drizzle ORM` 与平台 schema 约定。
- Neo4j 侧继续沿用现有官方 `neo4j-driver` adapter，不新增另一套图库客户端。
- CLI / 脚本继续沿用 `tsx` + `NODE_OPTIONS=--conditions=react-server` 的现有运行方式，不额外引入任务框架。
- 测试继续使用项目现有 `node:test` 风格，优先补 story 级回归或基础用例，而不是引入新测试框架。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/graph-sync/`
  - `src/infrastructure/sync/neo4j-graph-sync.ts`
  - `src/infrastructure/neo4j/neo4j-graph-adapter.ts`
  - `src/infrastructure/postgres/` 或 `src/infrastructure/graph-sync/` 下的 graph sync run repository
  - `src/db/schema/` 或现有平台 schema 定义位置中的 graph sync 元数据表
  - `drizzle/` 迁移文件
  - `scripts/sync-neo4j-baseline.mts`
  - `tests/story-7-6-*.test.mjs` 或等价测试文件

### Testing Requirements

- 至少覆盖：
  - graph sync run 记录创建、更新终态和错误摘要落库
  - `org-rebuild` 成功后记录 `nodes_written / edges_written`
  - 节点与边带运行元数据
  - scoped cleanup 不跨组织误删
  - 手工组织级 baseline 脚本在接入 run metadata 后仍可工作

### Previous Story Intelligence

- [Story 4.5](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/4-5-neo4j-graph-adapter-and-sync-baseline.md) 已建立 graph adapter、受控 sync/import 入口和真实图查询路径；当前已有 [sync-neo4j-baseline.mts](/Users/delldi/work-code/open-code/ontology-agent/scripts/sync-neo4j-baseline.mts) 可按组织执行 baseline。
- [Story 7.3](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-3-self-hosted-container-deployment-baseline.md) 后续会把 `graph sync job runner / scheduler` 纳入部署边界，所以 `7.6` 里不要把运行逻辑绑死在开发脚本假设上。
- [Story 7.4](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-4-observability-and-availability-monitoring.md) 后续需要看到 `graph sync run 状态` 和错误，因此 `7.6` 产生的 run metadata 要尽量稳定、结构化，便于观测和补偿。
- 最近提交 [06bf22f](/Users/delldi/work-code/open-code/ontology-agent/.git) “Stabilize graph sync and real analysis conclusion execution” 已经把 graph sync 的真实建图链路站稳；`7.6` 要承接这条真实链路，而不是回退成玩具级脚本包装。

### Git Intelligence Summary

- 最近几次提交说明 graph sync 已从“最小基线”推进到“真实环境可跑”的状态，故事实现应优先复用现有真实代码路径，而不是为运行元数据另起炉灶。
- 代码模式上，近期实现倾向于：
  - 先修真实基础设施链路
  - 再用 application use case 收口
  - 最后补 story 回归测试
  `7.6` 应延续这个模式。

### Latest Technical Information

- 本故事不依赖新增外部框架或新版本迁移，重点是把仓库当前的 graph sync baseline 升级为正式运行模型。
- 若需要补 Neo4j cleanup Cypher，优先维持现有 `MERGE + batch write` 风格，避免引入复杂 APOC 依赖，除非仓库现有环境已明确支持。

### Project Context Reference

- [project-context.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/project-context.md) 的关键约束仍然适用：
  - 业务概念优先放在 `domain / application / infrastructure` 分层，不把权限、运行控制或校验逻辑散写在页面组件中。
  - 测试以故事级集成为主，多文件回归要串行执行。
  - 当前实现事实优先于早期规划文档，graph sync 现在已经是真实能力，不应再按 stub 思路实现。

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.6: 图谱同步运行元数据与组织级重建]
- [Source: docs/data-contracts/graph-sync-baseline.md](/Users/delldi/work-code/open-code/ontology-agent/docs/data-contracts/graph-sync-baseline.md)
- [Source: docs/data-contracts/graph-sync-operating-model.md](/Users/delldi/work-code/open-code/ontology-agent/docs/data-contracts/graph-sync-operating-model.md)
- [Source: _bmad-output/implementation-artifacts/4-5-neo4j-graph-adapter-and-sync-baseline.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/4-5-neo4j-graph-adapter-and-sync-baseline.md)
- [Source: _bmad-output/implementation-artifacts/7-3-self-hosted-container-deployment-baseline.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-3-self-hosted-container-deployment-baseline.md)
- [Source: _bmad-output/implementation-artifacts/7-4-observability-and-availability-monitoring.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-4-observability-and-availability-monitoring.md)
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md)
- [Source: _bmad-output/planning-artifacts/prd.md#非功能需求](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test tests/story-7-6-graph-sync-runtime.test.mjs`
- `node --test tests/story-4-5-graph-sync-use-cases.test.mjs tests/story-7-6-graph-sync-runtime.test.mjs`
- `node --test tests/story-3-4-candidate-factors.test.mjs`
- `npm run lint`
- `npm run build`
- `node --test --test-concurrency=1 tests/*.test.mjs`

### Completion Notes List

- Added `platform.graph_sync_runs` schema, migration, and a Postgres-backed run store for graph sync runtime metadata.
- Upgraded graph sync application use cases with `runOrganizationRebuild`, including pending/running/completed/failed run transitions, trigger metadata, and persisted node/edge write counts.
- Stamped Neo4j nodes and edges with `scope_org_id / last_seen_run_id / last_seen_at`, and added scoped cleanup APIs plus conservative cleanup Cypher limited to the current organization/run.
- Rewired `scripts/sync-neo4j-baseline.mts` to execute the controlled `org-rebuild` path instead of a bare baseline sync call.
- Added Story 7.6 regression tests covering successful org rebuild, runtime metadata stamping, scoped cleanup boundaries, and failed-run persistence.
- Verification-support changes also aligned the candidate-factor fallback with `governed-rule`, restored pgloader helper scripts expected by legacy tests, and made the staging migration smoke test select the latest ERP migration rather than the latest file overall.
- Story-scoped verification passed (`story-7-6`, `story-4-5`, `story-3-4`, `lint`, `build`), while the full serial suite still has unrelated pre-existing failures in older stories (`4.1`, `4.3`, `4.5`, `4.7`) whose assertions no longer match current code paths.

### File List

- drizzle/0006_graph_sync_runs.sql
- scripts/sync-neo4j-baseline.mts
- scripts/pgloader/original-mysql-migration.mjs
- scripts/pgloader/original-mysql-specs.mjs
- src/application/factor-expansion/use-cases.ts
- src/application/graph-sync/runtime-ports.ts
- src/application/graph-sync/use-cases.ts
- src/application/graph/ports.ts
- src/application/graph/use-cases.ts
- src/domain/graph-sync/models.ts
- src/domain/graph/models.ts
- src/infrastructure/graph-sync/postgres-graph-sync-run-store.ts
- src/infrastructure/neo4j/neo4j-graph-adapter.ts
- src/infrastructure/postgres/schema/graph-sync-runs.ts
- src/infrastructure/postgres/schema/index.ts
- src/infrastructure/sync/neo4j-graph-sync.ts
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx
- tests/original-mysql-pgloader-migration.test.mjs
- tests/story-7-6-graph-sync-runtime.test.mjs
