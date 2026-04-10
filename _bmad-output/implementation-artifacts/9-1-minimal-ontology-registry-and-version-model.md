# Story 9.1: 最小本体注册表与版本模型

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台架构团队,
I want 建立最小 ontology registry 和版本模型,
so that 业务概念、指标语义、候选因素和计划模板有正式的 canonical source of truth。

## Acceptance Criteria

1. 当平台需要定义核心业务概念时，系统必须能够从正式的 `platform` 表中读取版本化 ontology definitions，而不是只依赖散落在 adapter、prompt 或临时代码中的隐式定义。
2. 当平台创建或切换 ontology version 时，系统必须具备稳定的版本标识、生命周期状态和生效语义，至少支持 `draft / review / approved / deprecated / retired`。
3. 最小 ontology registry 必须覆盖后续 stories 会立即依赖的核心对象骨架，至少包括：实体定义、指标定义、候选因素定义、计划步骤模板；但本 story 不负责完成完整治理流程、后台管理面或 planner/tooling 的全面接线。
4. Canonical ontology store 必须落在 `Postgres platform schema`，并通过应用层 use case / port 访问；不得把 `Neo4j`、`Cube` 或执行快照误当作 ontology 事实源。

## Tasks / Subtasks

- [ ] 建立 ontology version 与最小 registry 表结构（AC: 1, 2, 3, 4）
  - [ ] 在 `src/infrastructure/postgres/schema/` 下新增 ontology 相关 schema 文件，并补 `drizzle/` 迁移。
  - [ ] 至少定义这些平台表的最小可用版本：
    - [ ] `platform.ontology_versions`
    - [ ] `platform.ontology_entity_definitions`
    - [ ] `platform.ontology_metric_definitions`
    - [ ] `platform.ontology_factor_definitions`
    - [ ] `platform.ontology_plan_step_templates`
  - [ ] 为 definitions 统一提供稳定业务键、显示名、版本引用、生命周期状态、结构化元数据字段；避免先把字段做死成只适配单一场景。
  - [ ] 生命周期状态至少覆盖 `draft / review / approved / deprecated / retired`，并通过约束或领域枚举统一管理。

- [ ] 建立 ontology registry 的领域模型、端口与读写 use cases（AC: 1, 2, 4）
  - [ ] 在 `src/domain` 下新增 ontology / governance 相关模型，明确 `OntologyVersion`、`DefinitionLifecycleState` 及核心 definition 类型。
  - [ ] 在 `src/application` 下建立 registry ports 与最小 use cases，至少覆盖：
    - [ ] 创建版本
    - [ ] 查询当前生效版本
    - [ ] 按版本读取核心 definitions
  - [ ] 通过应用层访问平台表，不允许 route、脚本或 adapter 直接散写 registry 逻辑。

- [ ] 建立最小 baseline seed / bootstrap 路径（AC: 1, 3）
  - [ ] 从当前仓库已经存在的真实定义中抽取最小初始数据来源，至少覆盖：
    - [ ] 关键实体对象骨架
    - [ ] 当前已知的核心指标定义骨架
    - [ ] 候选因素定义骨架
    - [ ] 分析计划步骤模板骨架
  - [ ] 允许采用受控 seed / bootstrap 入口初始化第一版 ontology version，但必须明确这是 canonical registry 的正式装载路径，不是测试假数据脚本。
  - [ ] 不在本 story 中完成完整的 metric variant / time semantics 治理化；那部分留给 `9.2`。

- [ ] 为后续 stories 预留清晰边界，避免超做（AC: 3, 4）
  - [ ] 明确 `9.1` 只站稳 canonical registry 和 version model，不提前把 `9.3` 的 grounding、`9.4` 的审批流、`9.5` 的后台管理面混进来。
  - [ ] 在代码与注释中明确 `Neo4j` 是关系投影、`Cube` 是指标语义投影，二者都不是 ontology 唯一事实源。

- [ ] 补齐 story 级验证（AC: 1, 2, 3, 4）
  - [ ] 验证 ontology version 与最小 definitions 表可成功迁移、读写与按版本读取。
  - [ ] 验证生命周期状态与当前生效版本读取语义。
  - [ ] 验证 registry 读取经过应用层 use case，而不是直接依赖硬编码 catalog。
  - [ ] 验证最小 seed / bootstrap 后，能够读到一组可用于后续 stories 的 canonical definitions。

## Dev Notes

- 这张 story 的目标是**建立 canonical knowledge center**，不是把整个本体系统一次做完。做到“正式表结构 + 版本模型 + 最小读取能力”就够，不要超前做审批流、后台 UI 或 planner 全量接线。
- 本 story 是后续 `9.2 ~ 9.6` 的地基，重点是把“定义”与“投影”分开。当前代码里已有大量语义化定义，但它们分散在 `metric catalog / candidate factor / plan template / graph relation` 等不同位置；`9.1` 的职责是先建立统一托底中心。
- 必须坚持：
  - `Postgres platform schema = canonical ontology source`
  - `Neo4j = relationship projection`
  - `Cube = metric semantics projection`
  - `execution snapshot / follow-up history = runtime fact`
- 这一点如果做错，后面 `9.2 / 9.3` 会非常难收敛。

### Review Adjustments

- `9.1` 完成前，不应在 `Epic 10` 中固化新的运行时语义中心。换句话说，`runtime message / part / projection` 可以定义交互协议，但不能抢占 canonical business semantics 的角色。
- 建议把“当前生效版本”设计成正式指针或等价唯一入口，不要让后续 story 继续依赖“最新 approved 版本”这样的隐式规则。
- 最小 seed / bootstrap 应明确区分：
  - “从现有代码抽取的初始装载”
  - “后续正式治理发布”
  这两者不能混成同一条长期维护路径。

### Architecture Compliance

- 必须遵循 [ontology-governance-architecture.md]({project-root}/_bmad-output/planning-artifacts/ontology-governance-architecture.md) 的核心原则：
  - `Canonical Ontology, Multiple Projections`
  - `Governance Before Autonomy`
  - `Stable Contracts, Evolvable Runtime`
- 必须沿用当前项目的 `domain -> application -> infrastructure -> app` 分层，不要把 ontology registry 逻辑直接塞进 `metric-catalog.ts`、Neo4j adapter 或 route handler。
- 本 story 不得把 `Neo4j` 或 `Cube` 当作定义事实源；它们只能消费 canonical ontology 的投影结果。

### Library / Framework Requirements

- 数据库与迁移继续沿用项目现有 `Drizzle ORM` 和 `platform schema` 约定。
- 不新增 RDF/OWL 框架，不引入新的规则引擎或图本体工具链。
- 继续使用现有 `node:test`、`tsx`、`Postgres` 迁移与 story 测试风格。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/ontology/`
  - `src/application/ontology/`
  - `src/infrastructure/postgres/schema/ontology-*.ts`
  - `src/infrastructure/ontology/` 下的 Postgres-backed registry store
  - `drizzle/0012_*.sql` 或后续编号迁移
  - `tests/story-9-1-*.test.mjs`
- `src/infrastructure/postgres/schema/index.ts` 需要同步导出新 schema。
- 若需要 seed / bootstrap 入口，应优先放在 `scripts/` 或受控 application use case，不要散落在 test helper 中冒充正式装载。

### Testing Requirements

- 至少覆盖：
  - ontology version 创建与当前生效版本读取
  - 最小 definitions 表的按版本查询
  - 生命周期状态枚举与约束
  - seed / bootstrap 后可读取 canonical definitions
  - schema / migration 能正常纳入现有平台表体系
- 若测试涉及 `next build` 路径，继续遵守当前共享 build 锁规则；不过本 story 更适合以 application / infrastructure 级测试为主，不必强行做页面级 story 测试。

### Previous Story Intelligence

- `Epic 5` 和 `Epic 6` 已把 execution、follow-up、history 这些运行事实站稳；`9.1` 不应重做这些模块，而应为它们提供后续可绑定的 ontology version。
- `Epic 7.6 ~ 7.8` 已经证明平台运行元数据应该放在 `platform schema`，并通过应用层 use case 管理；ontology registry 应延续同样做法，而不是退回脚本散写。
- 当前 `Epic 7` 主线仍优先推进 `7.1 -> 7.2 -> 7.3/7.4 -> 7.5`。`9.1` 虽已进入 backlog 的首条 story，但实施时要注意与权限和审计主线的接口，而不是抢占其边界。

### Git Intelligence Summary

- 最近提交模式说明当前仓库倾向于：
  - 先站稳真实平台能力与 schema
  - 再通过 application use case 收口
  - 最后补 story 级验证
- 最近 5 个提交：
  - `617528e` docs: 完成 Epic 6 并更新项目上下文与测试基础设施
  - `2e1d4a2` feat: 完成 Story 6.4 多轮历史保留与结论演化功能
  - `89e451c` docs: 完成 Epic 6 追问功能核心 Stories 开发
  - `2cbbc64` refactor: 修复追问链路承接与计划执行逻辑
  - `ca38d9d` feat: 完成 Story 6.3 根据纠正结果重生成分析计划功能
- `9.1` 应延续“正式 schema + use case + 验证”的路径，不要先造临时 API 或临时 UI。

### Latest Technical Information

- 当前平台 schema 已包含：
  - `auth-sessions`
  - `analysis-sessions`
  - `analysis-session-follow-ups`
  - `analysis-execution-snapshots`
  - `graph-sync-runs / cursors / dirty-scopes`
- ontology registry 应与这些平台表保持一致的命名、导出和迁移管理方式。
- 本 story 不负责“指标口径治理化”的完整落地；收费类双口径和时间语义已存在真实运行代码，但正式治理化属于 `9.2`。

### Project Structure Notes

- 当前仓库已经在 `(admin)` 预留了后台路由分组，但 `9.1` 不应提前去做治理后台页面；那是 `9.5` 的范围。
- 当前项目强调真实产品可交付、Root-Cause First、可审计和可诊断；ontology registry 设计必须服务这些目标，而不是做成概念型抽象层。

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.1: 最小本体注册表与版本模型]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#3.1 Canonical Ontology, Multiple Projections]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#4. 统一本体层总体结构]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#5.1 Postgres 作为 Canonical Store]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#6.2 当前哪些逻辑最应该先收敛]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#10. 建议实施顺序]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]
- [Source: _bmad-output/planning-artifacts/architecture.md#认证与安全]
- [Source: _bmad-output/project-context.md#技术栈与版本]
- [Source: _bmad-output/project-context.md#关键实现规则]
- [Source: src/infrastructure/postgres/schema/index.ts]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Completion Notes List

- Story created from newly approved Epic 9 change proposal and ontology governance architecture supplement.
- Scope intentionally limited to canonical registry and version model; governance workflow, admin console, grounding, and runtime version binding are deferred to later stories.

### File List

- _bmad-output/implementation-artifacts/9-1-minimal-ontology-registry-and-version-model.md
