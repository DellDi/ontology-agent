# Story 9.7: 初始化首个可运行本体版本与 Bootstrap 命令

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 平台团队与部署运维,
I want 提供正式的 ontology bootstrap/init 命令与首个 approved seed package,
so that 新环境在完成迁移后可以稳定进入 grounded runtime，而不是继续依赖测试 snippet、手工写库或隐式初始化。

## Acceptance Criteria

1. 当一个环境已经完成 `db:migrate`、但还没有可用 ontology 数据时，系统必须提供单一、可重复执行的 bootstrap/init 命令，用于创建首个 approved ontology version，并写入当前运行时必需的最小 canonical definitions。
2. 首个 seed package 必须至少覆盖当前真实运行时主链需要的对象：`EntityDefinition`、`MetricDefinition`、`FactorDefinition`、`PlanStepTemplateDefinition`、`MetricVariantDefinition`、`TimeSemanticDefinition`、`CausalityEdgeDefinition`、`EvidenceTypeDefinition`、`ToolCapabilityBinding`；不得只覆盖治理对象的一部分。
3. bootstrap/init 命令必须是幂等的：当环境中已经存在同一版本或已有 approved version 时，系统必须明确返回 `skipped` / `status` 诊断，不得静默覆盖已生效版本，也不得留下半成品 approved version。
4. bootstrap/init 命令必须具备可诊断性：若缺少关键 seed、写入数量异常、依赖不满足或版本状态不一致，系统必须 fail loud，并输出可供人类理解的缺失项/冲突项信息。
5. 系统必须提供最小状态检查能力，能回答“当前环境是否已经具备可运行的 approved ontology baseline、版本号是多少、核心 definitions 数量是否完整”，以支撑后续 `9.5` 管理后台和部署验收。
6. 本 story 只负责“生产可运行初始化与检查闭环”，不负责治理后台 UI（那是 `9.5`），也不负责审批流 UI（那是 `9.4`）；但产物必须能被这些后续 story 直接复用。

## Tasks / Subtasks

- [ ] 收敛首个 approved ontology runtime seed package（AC: 1, 2, 4）
  - [ ] 新建一个正式 seed package 模块，集中定义当前运行时主链所需的最小 canonical objects，而不是继续散落在测试文件里。
  - [ ] seed package 必须覆盖：
    - [ ] entities
    - [ ] metrics
    - [ ] factors
    - [ ] plan step templates
    - [ ] metric variants
    - [ ] time semantics
    - [ ] causality edges
    - [ ] evidence types
    - [ ] default tool bindings
  - [ ] 不允许直接复制测试内联 seed 作为正式方案；必须从现有治理化定义、当前 fee-analysis 主链和 follow-up/replan 实际需求中抽取正式 baseline。

- [ ] 提供正式的 ontology bootstrap/init 命令（AC: 1, 3, 4）
  - [ ] 在 `scripts/` 下增加可直接运行的 bootstrap/init 脚本，统一装配 `createOntologyBootstrapUseCases(...)` 与 seed package。
  - [ ] 在 `package.json` 中增加明确命令，例如：
    - [ ] `ontology:bootstrap`
    - [ ] `ontology:bootstrap:status`
  - [ ] 命令输出必须面向人类可读，至少包括：版本号、各类 definition 数量、是否 skipped、失败原因。

- [ ] 补齐 bootstrap status / completeness 诊断（AC: 3, 4, 5）
  - [ ] 扩展 `checkBootstrapStatus()` 或等价 use case，使其不只统计局部 definitions，而是覆盖运行时验收所需的全部关键对象。
  - [ ] 明确“环境已可运行”的判定标准，而不是只要有一个 approved version 就算成功。
  - [ ] 对“不完整但存在 approved version”的脏状态给出显式诊断，不允许返回伪成功。

- [ ] 与当前运行时主链对齐（AC: 2, 5, 6）
  - [ ] 让 `9.3` grounded runtime 所依赖的 definitions 都能从该 bootstrap baseline 中拿到，而不需要测试临时 seed。
  - [ ] 明确该 baseline 是 `9.5` 管理后台的初始数据基础，而不是临时测试数据。
  - [ ] 明确该 baseline 不是替代审批治理；后续 `9.4` 发布新版本时，仍应走正式 change request / approval / publish 语义。

- [ ] 补齐 story 级验证（AC: 1, 2, 3, 4, 5）
  - [ ] 验证新环境执行 bootstrap 命令后，会创建首个可运行 approved version。
  - [ ] 验证 bootstrap 会完整写入全部关键对象，而不只是 governance seeds 或 tool bindings。
  - [ ] 验证重复执行 bootstrap 时返回幂等 skip，而不是覆盖现有数据。
  - [ ] 验证 status/check 命令能报告完整性诊断。
  - [ ] 验证缺失关键 seed 或数量异常时会 fail loud。

## Dev Notes

- 这张 story 解决的是当前 Epic 9 的一个真实交付缺口：`9.3` 已经把 execute/replan/tool selection 切到了 grounded runtime，但仓库里还没有正式的“环境初始化入口”，导致新环境只能靠测试 snippet 或手工写库才能跑起来。
- 当前仓库里已有的基础：
  - `src/application/ontology/grounding.ts` 已提供 `createOntologyBootstrapUseCases(...)`
  - `src/domain/ontology/governance-seed.ts` 已覆盖一部分治理对象 seeds
  - `src/domain/ontology/tool-binding.ts` 已覆盖默认 tool binding seeds
- 当前缺口在于：
  - 缺少正式 CLI / package command
  - 缺少统一的首个 approved version seed package
  - 缺少覆盖所有关键对象的 status / completeness 诊断
  - 核心 `entities / metrics / factors / plan step templates` 仍大量散落在测试 seed 中，而不是正式 baseline

### Review Adjustments

- 不能把“测试里能 seed 成功”误当成“生产环境可以初始化成功”。本 story 必须把测试 seed 与正式 bootstrap package 分开。
- 不能只做 `governance-seed.ts` 的补丁；还需要补上 operator-facing 命令、状态检查和 fail-loud 诊断，否则仍然不是可交付初始化能力。
- 不能让 bootstrap 只依赖“有没有 approved version”来判断成功；必须校验完整性，否则会把脏版本当成成功基线。

### Architecture Compliance

- 必须继续遵守 `Clean Architecture / Ports and Adapters / Domain-first`：
  - seed package 定义在 `domain` / `application` 可复用边界
  - CLI/脚本只做装配与执行
  - route/UI 不承载初始化逻辑
- 必须与 [ontology-governance-architecture.md]({project-root}/_bmad-output/planning-artifacts/ontology-governance-architecture.md) 一致：
  - `platform` schema 是 canonical source
  - runtime 只消费 approved definitions
  - approval/publish 语义仍属于 `9.4`
- 不得把 bootstrap 设计成“每次启动自动偷偷修库”的隐式机制；初始化应是显式、可审计、可诊断的运维动作。

### Library / Framework Requirements

- 继续沿用：
  - `TypeScript`
  - `tsx`
  - `Drizzle ORM`
  - `Postgres platform schema`
- 不引入新的 migration framework、seed framework 或外部配置服务。
- 允许通过 `package.json` script + `scripts/*.mts` 的方式落地最小初始化命令。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/ontology/` 下新增正式 runtime seed package 模块
  - `src/application/ontology/grounding.ts`
  - `scripts/` 下新增 ontology bootstrap/status 脚本
  - `package.json`
  - `tests/story-9-7-*.test.mjs`
- 如需补充 completeness read model，可新增：
  - `src/application/ontology/` 下的 bootstrap status use case 或 helper

### Testing Requirements

- 至少覆盖：
  - 空环境 bootstrap 成功
  - 重复 bootstrap 幂等
  - 全部关键 definitions/bindings 写入完整
  - status/check 报告完整性
  - 缺失 seed 时 fail loud
- 验证命令应尽量贴近真实运维入口，而不是只直接调用内部函数。

### Previous Story Intelligence

- `9.2` 已把一部分治理对象正式化，但其 seed 仍偏向“定义模块 + 测试消费”，不是生产初始化闭环。
- `9.3` 已经让 execute / replan / tool selection 真实依赖 ontology runtime，因此初始化缺口已从“体验问题”升级为“部署阻塞项”。
- `9.5` 规划了治理后台管理界面，但当前代码中 `(admin)` 只有占位目录；在后台落地前，必须先有正式的 bootstrap/init 基线。
- `9.6` 会把 execution/follow-up/history 绑定 ontology version，因此初始化 baseline 必须稳定、可追踪，不能继续依赖测试临时版本。

### Git Intelligence Summary

- 当前仓库对生产能力的实现模式已经很明确：
  - 先把真实运行时链路接通
  - 再把事实落到 Postgres canonical model
  - 最后补验证与最小运维入口
- 这张 story 应延续这个节奏：不要去做大而全的治理平台，先把“新环境可稳定初始化并可诊断验收”做实。

### Latest Technical Information

- 当前 `package.json` 中没有正式的 ontology bootstrap/init 命令。
- 当前 `createOntologyBootstrapUseCases(...)` 只在测试中被直接调用，尚未形成 operator-facing 入口。
- 当前 `src/domain/ontology/governance-seed.ts` 仅覆盖部分治理对象；而 `entities / metrics / factors / plan step templates` 的正式 baseline 仍未集中收口。
- 当前 `(admin)` 路由下没有真实 ontology governance UI，只有占位文件；因此本 story 是 `9.5` 之前的必要运维落地步骤。

### Project Structure Notes

- 本 story 不做 `(admin)` 页面。
- 本 story 不做审批流 UI。
- 本 story 不做“运行时自动隐式修复数据库”。
- 本 story 的重点是：`显式初始化命令 + 正式 seed package + 完整性诊断 + story 验证`。

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.3: Ontology Grounding 接入上下文、计划与工具选择]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.4: 本体变更申请、审批与发布审计]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.5: 本体治理后台管理界面]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.6: 执行结果、追问与历史绑定本体版本]
- [Source: src/application/ontology/grounding.ts]
- [Source: src/domain/ontology/governance-seed.ts]
- [Source: src/domain/ontology/tool-binding.ts]
- [Source: package.json]
- [Source: src/app/(admin)/.gitkeep]
- [Source: _bmad-output/project-context.md#关键实现规则]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-9-3-ontology-grounding.test.mjs`
- `pnpm build`
- `rg -n "bootstrap|seed|init|publish|approved version" ...`

### Completion Notes List

- Story created to close the operational gap between runtime grounding being implemented and environments still lacking a formal ontology bootstrap/init entrypoint.
- Scope intentionally excludes governance UI and approval UI, and focuses on deployable initialization plus diagnostics.

### File List

- _bmad-output/planning-artifacts/epics.md
- _bmad-output/implementation-artifacts/9-7-bootstrap-first-approved-ontology-runtime-package.md
