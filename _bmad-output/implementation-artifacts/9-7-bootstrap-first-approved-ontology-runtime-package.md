# Story 9.7: 初始化首个可运行本体版本与 Bootstrap 命令

Status: done

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

- [x] 收敛首个 approved ontology runtime seed package（AC: 1, 2, 4）
  - [x] 新建 `src/domain/ontology/runtime-seed.ts`，集中定义 entities / metrics / factors / planStepTemplates，聚合函数 `buildDefaultRuntimeOntologyPackage(...)` 组装全部 8 类对象。
  - [x] seed package 覆盖：
    - [x] entities (6)：project + 5 个 causality source/target 实体
    - [x] metrics (1)：collection-rate 父指标（variants 由 governance-seed 挂接）
    - [x] factors (4)：fee-policy-reach / work-order-response / billing-timeliness / dispatch-load（与 FACTOR_TEMPLATES 对齐）
    - [x] plan step templates (4)：confirm-analysis-scope / inspect-metric-change / validate-candidate-factors / synthesize-attribution
    - [x] metric variants (6)：复用 `governance-seed.buildMetricVariantSeeds`
    - [x] time semantics (3)：复用 `governance-seed.buildTimeSemanticSeeds`
    - [x] causality edges (4)：复用 `governance-seed.buildCausalityEdgeSeeds`
    - [x] evidence types (4)：复用 `governance-seed.buildEvidenceTypeSeeds`
    - [x] default tool bindings：由 `bootstrapCanonicalDefinitions` 内部通过 `buildDefaultToolCapabilityBindingSeeds` 自动装配
  - [x] baseline 从运行时真实引用抽取（STEP_TOOL_FALLBACKS / FACTOR_TEMPLATES / buildAnalysisPlan / governance-seed causality），不复制测试内联 seed。
  - [x] 新增 `DEFAULT_RUNTIME_BASELINE_EXPECTED_COUNTS` 常量供 completeness 校验对照。

- [x] 提供正式的 ontology bootstrap/init 命令（AC: 1, 3, 4）
  - [x] 新建 `scripts/ontology-bootstrap.mts`，装配 use cases 与 seed package；采用仓库 CJS interop 约定（`import * as` + `resolveModuleExport`）。
  - [x] `package.json` 新增 `ontology:bootstrap` 与 `ontology:bootstrap:status` 脚本。
  - [x] CLI 输出覆盖：目标版本号、seed 数量、创建数量、skipped 原因、completeness 人类可读文本。
  - [x] 支持 `--help` / `--status` / `--version-id` / `--semver`；失败时 `process.exit(1)`，参数错误 `process.exit(2)`。
  - [x] 旧脚本 `seed-ontology-baseline.mts` 加 `⚠️ DEPRECATED` 头部注释，指向本脚本为新正式入口。

- [x] 补齐 bootstrap status / completeness 诊断（AC: 3, 4, 5）
  - [x] 扩展 `checkBootstrapStatus()`：从原 5 类覆盖扩展为 9 类（补齐 planStepTemplates / causalityEdges / evidenceTypes / toolBindings）。
  - [x] 新增 `expectedMinimums` 参数：CLI 传入 `DEFAULT_RUNTIME_BASELINE_EXPECTED_COUNTS`，避免 application 层硬编码业务 baseline 数字。
  - [x] 返回结构化 `completeness`：`isComplete`（null/true/false）+ `missingCategories[]` + `humanReadable`。
  - [x] 对"不完整但存在 approved version"的脏状态显式诊断为 `存在脏状态：xxx 0/N`（已在开发 DB 真实验证）。

- [x] 与当前运行时主链对齐（AC: 2, 5, 6）
  - [x] baseline 中的 businessKey 与 `STEP_TOOL_FALLBACKS` / `STEP_CAPABILITY_HINTS` / FACTOR_TEMPLATES 对齐，9.3 grounded runtime 测试可直接消费。
  - [x] baseline 为 `9.5` 管理后台提供初始数据；`9.4` 后续发布按正式 change request / approval / publish 语义演进。
  - [x] 明确本 story 不做 admin UI / approval UI / 启动时自动修库。

- [x] 补齐 story 级验证（AC: 1, 2, 3, 4, 5）
  - [x] `tests/story-9-7-ontology-bootstrap.test.mjs` 覆盖：
    - [x] AC1+AC2 baseline 8 类数量匹配 + 核心 businessKey 存在
    - [x] AC2 causality edges 的 entity 引用完整性
    - [x] AC1+AC3 真实 DB bootstrap 首次 vs 第二次幂等
    - [x] AC5 `checkBootstrapStatus` 覆盖全部 9 类 + completeness
    - [x] AC4 fail-loud：完整性失败时 version 保留 draft
    - [x] AC5 无 approved version 时诊断文本明确
  - [x] 测试结果：6/6 通过。
  - [x] CLI `pnpm ontology:bootstrap:status` 在开发 DB 真实执行验证，正确识别出 9.2 遗留脏 version 并以 exit code 1 返回。

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

- `node --test --test-concurrency=1 tests/story-9-7-ontology-bootstrap.test.mjs`  → 6/6 pass
- `node --test --test-concurrency=1 tests/story-9-3-ontology-grounding.test.mjs`  → 14/14 pass (回归)
- `pnpm tsc --noEmit`  → 绿
- `pnpm ontology:bootstrap:status`  → 真实开发 DB 诊断验证

### Completion Notes List

- Story created to close the operational gap between runtime grounding being implemented and environments still lacking a formal ontology bootstrap/init entrypoint.
- Scope intentionally excludes governance UI and approval UI, and focuses on deployable initialization plus diagnostics.
- 2026-04-21 实施：
  - domain 层新增 `runtime-seed.ts`（entities/metrics/factors/planStepTemplates baseline + 聚合函数 + 期望数量常量）
  - application 层扩展 `checkBootstrapStatus` 从 5 类覆盖扩展为 9 类，新增结构化 completeness 诊断
  - script 层新建 `scripts/ontology-bootstrap.mts`（CJS interop + `resolveModuleExport` 约定 + `--help/--status/--version-id/--semver` 参数）
  - `package.json` 新增 `ontology:bootstrap` / `ontology:bootstrap:status`
  - `seed-ontology-baseline.mts` 标记为 ⚠️ DEPRECATED，保留扩展性 entity 作为 9.4 审批流候选参考
  - 新增 `tests/story-9-7-ontology-bootstrap.test.mjs`（6 项，覆盖 baseline 数量/引用完整性/bootstrap 幂等/status 完整性/fail-loud/无 approved version 诊断）

### File List

- _bmad-output/planning-artifacts/epics.md
- _bmad-output/implementation-artifacts/9-7-bootstrap-first-approved-ontology-runtime-package.md
- src/domain/ontology/runtime-seed.ts (new)
- src/application/ontology/grounding.ts (扩展 checkBootstrapStatus)
- scripts/ontology-bootstrap.mts (new)
- scripts/seed-ontology-baseline.mts (加 DEPRECATED 注释)
- package.json (新增 2 个 scripts)
- tests/story-9-7-ontology-bootstrap.test.mjs (new)
