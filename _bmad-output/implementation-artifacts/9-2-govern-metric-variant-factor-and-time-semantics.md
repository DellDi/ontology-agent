# Story 9.2: 指标口径、因素与时间语义治理化

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台架构团队,
I want 将 metric / variant / factor / time semantics 正式治理化,
so that Cube 口径、候选因素和结论证据不再依赖隐式代码约定。

## Acceptance Criteria

1. 当平台处理收费类指标、候选因素和时间语义时，系统必须优先从 ontology registry 读取正式定义，而不是继续只依赖 `metric-catalog.ts`、候选因素扩展逻辑或 prompt 内隐式约定。
2. 指标口径治理必须至少覆盖当前真实业务中已经存在的关键结构：`MetricDefinition`、`MetricVariantDefinition`、`TimeSemanticDefinition`、`FactorDefinition`、`CausalityEdgeDefinition`、`EvidenceTypeDefinition`。
3. 当前已落地的收费类“双口径 + 多时间语义”必须进入正式治理模型，至少覆盖“项目口径 / 尾欠口径”以及 `receivable-accounting-period / billing-cycle-end-date / payment-date` 三类时间语义。
4. conclusion renderer、candidate factor 扩展、Cube 语义查询等运行时能力在读取这些对象时，必须能够识别版本与生命周期状态；未 `approved` 的定义不得进入默认运行时路径。

## Tasks / Subtasks

- [x] 扩展 ontology registry 表结构，纳入治理对象骨架（AC: 1, 2, 3, 4）
  - [x] 在 `9.1` 的最小 registry 基础上补充至少以下表或等价结构：
    - [x] `platform.ontology_metric_variants`
    - [x] `platform.ontology_time_semantics`
    - [x] `platform.ontology_causality_edges`
    - [x] `platform.ontology_evidence_type_definitions`
  - [x] 为 `MetricDefinition / MetricVariantDefinition / TimeSemanticDefinition / FactorDefinition / CausalityEdgeDefinition / EvidenceTypeDefinition` 建立稳定业务键、版本引用和生命周期状态。
  - [x] 保持 `platform` schema 为 canonical source；不要把运行时 catalog 直接升级成事实源。

- [x] 把收费类双口径与时间语义收进正式治理模型（AC: 1, 2, 3）
  - [x] 从当前真实收费语义实现中抽取并治理化这些对象：
    - [x] `项目口径`
    - [x] `尾欠口径`
    - [x] `receivable-accounting-period`
    - [x] `billing-cycle-end-date`
    - [x] `payment-date`
  - [x] 明确这些定义与现有 Cube 语义查询适配层之间的映射关系。
  - [x] 不在本 story 中重写全部 Cube adapter，只需要把治理定义和运行时映射边界站稳。

- [x] 把候选因素、因果边与证据类型拉入正式治理对象（AC: 1, 2, 4）
  - [x] 将当前真实候选因素扩展中已经稳定存在的核心因素定义纳入 registry。
  - [x] 为 Neo4j 因果关系查询建立 `CausalityEdgeDefinition` 语义骨架，明确“图谱关系”与“允许作为归因路径的治理关系”不是一回事。
  - [x] 为 conclusion renderer 与 execution result block 定义 `EvidenceTypeDefinition`，至少覆盖：
    - [x] 表格证据
    - [x] 图谱证据
    - [x] ERP 事实证据
    - [x] 模型摘要证据

- [x] 建立治理化读取路径并限制未审批定义进入运行时（AC: 1, 4）
  - [x] 在 `src/application/ontology/` 下补充读取 use cases，使运行时可以按版本和生命周期读取上述定义。
  - [x] 为默认运行时路径明确“仅 `approved` 定义可用”的规则。
  - [x] 若当前旧代码仍需要兼容硬编码 catalog，必须明确其为 transitional path，并提供替换点；不要把兼容逻辑伪装成正式方案。

- [x] 补齐 story 级验证（AC: 1, 2, 3, 4）
  - [x] 验证双口径与时间语义已进入 registry，并可按版本读取。
  - [x] 验证 factor / causality edge / evidence type 可被正式读取。
  - [x] 验证未 `approved` 定义不会进入默认运行时选择。
  - [x] 验证旧运行时映射层至少可消费治理后的 canonical definitions。

## Dev Notes

- `9.2` 的目标不是“把 grounding 一起做掉”，而是把后面会被运行时消费的知识对象先治理化。先把定义收拢，再谈 context/planner/tooling 全面接线。
- 当前仓库里最成熟、最值得先治理化的就是收费类 metric semantics 和候选因素/证据类型，因为它们已经同时出现在：
  - Cube 查询
  - 因果扩展
  - 计划生成
  - 结论渲染
- 这张 story 要解决的是“定义从哪来、生命周期如何管理、运行时能否识别版本状态”，不是把所有 consumer 一次性全部改完。

### Review Adjustments

- 本 story 应明确“治理对象进入 registry”与“consumer 全量切换”是两步走，避免开发时一口气把 Cube、graph、conclusion、candidate factor 全部硬切，导致回归面过大。
- `CausalityEdgeDefinition` 需要在文档里明确区分：
  - 图数据库里存在的关系
  - 被治理后允许进入归因链的关系
  否则后续实现很容易直接拿 Neo4j 边当治理边。
- 对 `approved` 生命周期的运行时约束，建议在测试里明确覆盖“同名 definition 存在 draft/review/approved 多版本时，默认只取 published/approved 组合”的行为，避免后续和 `9.4` 的发布语义打架。

### Architecture Compliance

- 必须遵循 [ontology-governance-architecture.md]({project-root}/_bmad-output/planning-artifacts/ontology-governance-architecture.md) 中“最先收敛四类对象”的判断：
  - `MetricDefinition / Variant / TimeSemantic`
  - `FactorDefinition / CausalityEdgeDefinition`
  - `EvidenceTypeDefinition`
- `Cube` 只能作为 `Metric Semantics Projection`，`Neo4j` 只能作为 `Relationship Projection`；本 story 不得把这些投影层重新定义成 canonical source。
- 未 `approved` 定义不得进入默认运行时路径，这是后续治理和审计成立的前提。

### Library / Framework Requirements

- 继续沿用 `Drizzle ORM`、`Postgres platform schema`、现有 `Cube` 与 `Neo4j` adapter。
- 不引入新的规则引擎或 metadata service。
- 本 story 可以复用现有的 `metric-catalog.ts`、candidate factor、conclusion 相关模块，但应把它们改造成 registry consumer，而不是继续加硬编码。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/ontology/`
  - `src/application/ontology/`
  - `src/infrastructure/postgres/schema/ontology-*.ts`
  - `src/infrastructure/ontology/`
  - `src/infrastructure/cube/metric-catalog.ts`
  - `src/domain/analysis-result/` 或相关 conclusion/evidence 模型
  - `src/application/factor-expansion/` 或相关候选因素模块
  - `drizzle/` 后续迁移
  - `tests/story-9-2-*.test.mjs`

### Testing Requirements

- 至少覆盖：
  - metric variant / time semantic / factor / evidence type 的按版本读取
  - `approved` 生命周期约束
  - 收费类双口径映射
  - 旧 catalog / renderer / factor expansion 对治理定义的消费路径
- 优先做 application / infrastructure 级 story 验证，不必先做 UI 测试。

### Previous Story Intelligence

- `9.1` 已经把 canonical registry 和 version model 定义成正式前置条件；`9.2` 必须建立在它之上，不要重复设计 version 语义。
- 真实收费类双口径和时间语义已经在当前代码中跑通；`9.2` 要把这些“已存在事实”收进治理中心，而不是重新发明业务规则。
- Epic 5 的结论与证据、Epic 6 的 follow-up / replan 已经是后续消费者；这张 story 要优先考虑它们能如何平滑接入。

### Git Intelligence Summary

- 当前仓库近期模式仍然是：
  - 先站稳真实数据链路
  - 再收口成正式模型
  - 最后补验证
- `9.2` 应延续这个节奏：先治理已知事实，不做过度抽象设计。

### Latest Technical Information

- 当前真实收费类语义已经区分：
  - `项目口径`
  - `尾欠口径`
  - `receivable-accounting-period`
  - `billing-cycle-end-date`
  - `payment-date`
- 当前 conclusion 渲染与候选因素扩展已具备真实运行路径，但仍缺少 canonical governance source。

### Project Structure Notes

- `(admin)` 路由预留存在，但本 story 不做后台管理界面；那是 `9.5`。
- 本 story 不应越权去做 `9.3` 的 grounding 流程改造，只需要把 consumer 所需的定义和读取边界站稳。

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.2: 指标口径、因素与时间语义治理化]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#4.2 Metric Semantics Registry]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#4.3 Factor & Causality Registry]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#5.3 Cube 作为 Metric Semantics Projection]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#6.2 当前哪些逻辑最应该先收敛]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#8.2 生命周期]
- [Source: _bmad-output/project-context.md#关键实现规则]
- [Source: _bmad-output/implementation-artifacts/9-1-minimal-ontology-registry-and-version-model.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-9-2-governance-definitions.test.mjs`
- `node --test --test-concurrency=1 tests/story-9-1-ontology-registry.test.mjs`
- `node --test --test-concurrency=1 tests/story-4-4-semantic-query.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- Story created as the second phase of Epic 9, focusing on governance of already-existing semantic facts rather than broad runtime grounding.
- Scope intentionally excludes approval workflow UI and full runtime grounding.
- 为收费类 metric 建立了显式的 `registry -> Cube metric catalog` transitional projection，运行时查询路径优先消费最新 `approved` governance definitions。
- `metric-catalog.ts` 保留旧服务类指标的兼容入口，但收费类双口径和时间语义不再只依赖硬编码定义。
- 修正 `findCurrentApproved()` 选择顺序为最新 `publishedAt`，并补齐 story 级验证，避免共享测试数据库时误读旧 approved 版本。

### File List

- _bmad-output/implementation-artifacts/9-2-govern-metric-variant-factor-and-time-semantics.md
- src/infrastructure/cube/metric-catalog.ts
- src/infrastructure/cube/governed-metric-catalog.ts
- src/infrastructure/cube/query-builder.ts
- src/infrastructure/cube/cube-semantic-query-adapter.ts
- src/infrastructure/ontology/postgres-ontology-version-store.ts
- tests/story-9-2-governance-definitions.test.mjs
- tests/story-9-1-ontology-registry.test.mjs
- tests/story-4-4-semantic-query.test.mjs

## Change Log

- 2026-04-11: 补齐 9.2 运行时 projection 与 story 级验证，收费类指标查询路径优先消费最新 approved governance definitions，并修正 ontology approved 版本选择顺序。
