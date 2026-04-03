# Story 4.5: Neo4j 图谱接入与关系/因果边同步基线

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 建立 Neo4j 图谱查询适配器和最小同步基线,
so that 候选因素扩展和关系推理可以基于真实图谱而不是静态 stub。

## Acceptance Criteria

1. 当系统需要扩展实体关系或候选影响因素时，必须通过 Neo4j graph adapter 查询真实关系与因果边。
2. 图谱查询结果必须带最小可解释信息，例如边类型、方向、来源或关联说明。
3. 图谱数据必须来自受控同步或增强流程，不允许分析请求在运行时任意写入未经治理的图谱结构。

## Tasks / Subtasks

- [x] 建立图谱实体与边模型（AC: 1, 2, 3）
  - [x] 明确项目、小区、楼栋、房间、收费、工单、投诉、满意度等实体的最小图谱表达。
  - [x] 为关系边、影响边、因果边定义类型和来源字段。
- [x] 建立 Neo4j graph adapter（AC: 1, 2）
  - [x] 新增图谱查询 port 与 infrastructure adapter。
  - [x] 将图谱查询结果映射为可供候选因素扩展和计划生成消费的领域结构。
- [x] 建立最小同步基线（AC: 3）
  - [x] 明确哪些关系来自 ERP 主数据，哪些边来自规则增强或治理后的因果知识。
  - [x] 新增最小 sync/import 入口，避免后续手工往图谱里写散乱节点和边。
- [x] 覆盖图谱读取与同步测试（AC: 1, 2, 3）
  - [x] 验证候选因素扩展走真实 graph adapter。
  - [x] 验证返回结构包含边类型或来源说明。
  - [x] 验证未经过同步流程的写入不会成为默认路径。

## Dev Notes

- Neo4j 不是拿来做指标聚合的；它主要承接“实体关系”和“候选影响因素 / 因果边”的查询。
- 如果你的业务数据里已经有项目、楼栋、房间、工单、收费对象之间的主数据关系，这一故事就是把这些关系和治理后的因果边真正导入产品的入口。
- 图谱同步不一定一次做大，但最少要先站稳“从哪来、怎么映射、谁能写入”的基线。

### Architecture Compliance

- 必须遵循架构中的 `Neo4j Graph Adapter` 与 `Graph / Semantic ETL Sync Baseline` 边界。
- 图谱写入来自受控同步流程，不由在线分析请求临时写图。
- 浏览器端不得直连 Neo4j，所有读取与同步均经由服务端边界。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/graph/`
  - `src/infrastructure/neo4j/`
  - `src/infrastructure/sync/` 或等价同步目录
  - 视需要新增图谱同步说明文档

### Testing Requirements

- 至少覆盖：
  - graph adapter 存在
  - 候选因素扩展可消费图谱结果
  - 边类型 / 来源可解释
  - 最小同步入口与写入约束

### Previous Story Intelligence

- Story 3.4 的候选因素扩展当前仍可基于规则 / stub 站稳契约；4.5 负责把这层切到真实图谱读路径。
- Story 4.3 已经明确真实业务主数据如何进入平台，4.5 需要在其基础上定义哪些字段进一步投影成图谱节点与边。
- Story 4.4 已确认收费与工单的首批业务口径：收缴率分母使用 `chargeSum`；工单时效后续同时保留“响应时长”和“关闭时长”；满意度主题除 `satisfaction` 外，还应保留 `satisfactionEval` 作为客户评价满意度语义。这些确认项应直接影响 4.5 中的图谱节点属性、候选因素语义和因果边说明。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.5: Neo4j 图谱接入与关系/因果边同步基线]
- [Source: _bmad-output/planning-artifacts/prd.md#领域要求]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]
- [Source: _bmad-output/planning-artifacts/architecture.md#基础设施与部署]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test tests/story-4-5-neo4j-graph.test.mjs`
- `node --test tests/story-3-4-candidate-factors.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 新增 `src/domain/graph/` 与 `src/application/graph/`，建立图谱节点、关系边、候选因素查询与受控同步的领域模型、port 和 use case。
- 新增 `src/infrastructure/neo4j/`，建立 Neo4j 配置、错误模型、官方 `neo4j-driver` adapter 与统一入口，所有图谱读取和同步均保持服务端边界。
- 新增 `src/infrastructure/sync/neo4j-graph-sync.ts`，把 ERP staging 中的组织、项目、业主、收费项目、应收、实收、工单映射成受控的节点与边批次，并统一走 `MERGE` 同步路径。
- `Story 3.4` 的候选因素扩展已接入图谱读路径：复杂归因问题优先尝试 Neo4j 候选因素，未配置 Neo4j 或无命中时再回退到治理规则。
- 当前候选因素展示已显式暴露 `relationType / direction / source` 的最小可解释信息，满足图谱结果可解释性基线。
- 当前不需要你再补充额外真实业务信息才能继续推进 4.5；如果后续要把图谱从“baseline”升级到“业务可信的因果图”，再补实际房屋实体表、已确认因果边和更细的主数据关系会更有价值。
- 根据 4.4 / 4.5 联合 code review，Neo4j 读路径已从只查 `causal` 边调整为消费当前同步基线真实写入的关系边，不再因为图谱真实启用而普遍退回静态候选因素。
- 候选因素扩展链路现在对 Neo4j 故障做了显式降级保护：图谱不可用时回退到治理规则候选方向，不再让分析会话页直接 500。
- 旧的 `Story 3.4` 端到端页面测试已按真实图谱/规则降级双路径校准；当前仍有一条独立后续项：本地 `neo4j` 服务加入 `compose.yaml` 由 `Story 4.7` 负责，不在本次 4.5 修复批次内一并处理。

### File List

- _bmad-output/implementation-artifacts/4-5-neo4j-graph-adapter-and-sync-baseline.md
- .env.example
- docs/data-contracts/graph-sync-baseline.md
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/candidate-factor-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/application/factor-expansion/use-cases.ts
- src/application/graph/ports.ts
- src/application/graph/use-cases.ts
- src/domain/graph/models.ts
- src/infrastructure/factor-expansion/index.ts
- src/infrastructure/neo4j/config.ts
- src/infrastructure/neo4j/errors.ts
- src/infrastructure/neo4j/index.ts
- src/infrastructure/neo4j/neo4j-graph-adapter.ts
- src/infrastructure/sync/neo4j-graph-sync.ts
- src/shared/types/graph.ts
- tests/story-3-4-candidate-factors.test.mjs
- tests/story-4-5-neo4j-graph.test.mjs

## Change Log

- 2026-04-03：完成 Story 4.5 的 Neo4j adapter、受控同步基线、图谱候选因素读路径接入与专属测试回归。
- 2026-04-03：根据 code review 修复真实图谱关系读取与页面降级保护，复跑 `tests/story-4-5-neo4j-graph.test.mjs`、`pnpm lint`、`pnpm build`；`tests/story-3-4-candidate-factors.test.mjs` 已同步校准为真实图谱/规则降级兼容断言。
