# Story 4.5: Neo4j 图谱接入与关系/因果边同步基线

Status: ready-for-dev

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

- [ ] 建立图谱实体与边模型（AC: 1, 2, 3）
  - [ ] 明确项目、小区、楼栋、房间、收费、工单、投诉、满意度等实体的最小图谱表达。
  - [ ] 为关系边、影响边、因果边定义类型和来源字段。
- [ ] 建立 Neo4j graph adapter（AC: 1, 2）
  - [ ] 新增图谱查询 port 与 infrastructure adapter。
  - [ ] 将图谱查询结果映射为可供候选因素扩展和计划生成消费的领域结构。
- [ ] 建立最小同步基线（AC: 3）
  - [ ] 明确哪些关系来自 ERP 主数据，哪些边来自规则增强或治理后的因果知识。
  - [ ] 新增最小 sync/import 入口，避免后续手工往图谱里写散乱节点和边。
- [ ] 覆盖图谱读取与同步测试（AC: 1, 2, 3）
  - [ ] 验证候选因素扩展走真实 graph adapter。
  - [ ] 验证返回结构包含边类型或来源说明。
  - [ ] 验证未经过同步流程的写入不会成为默认路径。

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

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.5: Neo4j 图谱接入与关系/因果边同步基线]
- [Source: _bmad-output/planning-artifacts/prd.md#领域要求]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]
- [Source: _bmad-output/planning-artifacts/architecture.md#基础设施与部署]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/4-5-neo4j-graph-adapter-and-sync-baseline.md
