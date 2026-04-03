# Story 4.4: Cube 语义层只读查询接入

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 接入 Cube 作为受治理的指标读路径,
so that 后续分析步骤可以基于统一口径获取度量和维度结果，而不是直查 ERP 主写库。

## Acceptance Criteria

1. 当分析步骤需要读取指标、维度或对比结果时，系统必须通过 Cube semantic query adapter 发起只读查询。
2. 系统必须向上层暴露稳定的 metric query 契约，不让执行故事直接拼 Cube 原始请求对象。
3. Cube 读取的数据口径必须建立在已清洗或可治理的分析 schema / 语义模型之上，而不是直接消费未治理的 ERP 原始表。

## Tasks / Subtasks

- [x] 建立 Cube 连接配置与健康检查（AC: 1, 2）
  - [x] 明确 Cube API / token / endpoint / 查询超时与错误处理约定。
  - [x] 新增最小健康检查或配置校验入口。
- [x] 建立 semantic query adapter 与 metric contract（AC: 1, 2, 3）
  - [x] 定义平台内部的 metric query / compare query / group-by query 契约。
  - [x] 新增将平台查询意图转换为 Cube 查询的只读 adapter。
- [x] 明确分析 schema 与语义模型前置（AC: 3）
  - [x] 梳理哪些指标直接来自 ERP 清洗结果，哪些需要聚合 / 派生 / 重命名后进入 Cube。
  - [x] 不允许让执行故事在业务代码中重复定义指标口径。
- [x] 覆盖查询与口径测试（AC: 1, 2, 3）
  - [x] 验证上层使用统一 metric contract。
  - [x] 验证只读查询与错误兜底。
  - [x] 验证基础口径映射存在且可复用。

## Dev Notes

- Cube 在这里的职责不是替代 ERP，而是承接“受治理指标查询”这一层。
- 真实业务表先经过 Story 4.3 的读取 / 清洗 / staging 边界，再进入 Cube 所依赖的分析 schema 或语义模型，会比在执行层临时拼 SQL 稳定得多。
- 后续凡是“收缴率、投诉率、满意度、工单时效分布”这类指标型读路径，优先走 Cube。

### Architecture Compliance

- 必须遵循架构中的 `Cube Semantic Query Adapter` 边界。
- Cube 只连接只读副本或受控分析 schema，不走 ERP 主写路径。
- 浏览器端不得直连 Cube，查询必须经由服务端编排和权限边界。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/semantic-query/`
  - `src/infrastructure/cube/`
  - 视需要新增 `docs/data-contracts/` 或语义层约束文档

### Testing Requirements

- 至少覆盖：
  - Cube adapter 存在
  - 上层 metric contract 稳定
  - 只读 / 超时 / 空结果兜底
  - 不绕过语义层直查 ERP 主写表

### Previous Story Intelligence

- Story 4.3 已确定真实业务数据如何以受控读路径进入平台；4.4 在其基础上建立指标治理层。
- Story 3.5 的计划步骤里凡是“按维度对比、按项目分组、按时间趋势对比”的分析节点，后续都应优先落到这里的 metric query adapter。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4: Cube 语义层只读查询接入]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]
- [Source: _bmad-output/planning-artifacts/architecture.md#基础设施与部署]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test tests/story-4-4-semantic-query.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 新增 `src/application/semantic-query/`，建立平台内部稳定的语义指标查询契约：`SemanticMetricKey`、`MetricQueryRequest`、`MetricQueryResult`、`SemanticQueryPort` 与 use case。
- 新增 `src/infrastructure/cube/`，建立 Cube 配置、错误模型、指标目录、query builder、只读 adapter 与统一入口，不让上层 story 直接拼 Cube 原始请求对象。
- 当前 Cube 查询统一通过服务端 token 调用 `/load` 与 `/meta`，并内建查询超时、provider 错误与最小健康检查。
- 首批语义指标已固化为 8 项：收缴率、应收金额、实收金额、工单总量、投诉量、平均满意度、平均响应时长、平均关闭时长，分别映射到收费与工单两类治理主题。
- 新增 `docs/data-contracts/cube-semantic-baseline.md`，把首批指标口径、权限切片和“待业务确认”项显式文档化，避免后续执行层在业务代码里重复定义口径。
- 当前 4.4 不构成必须等待用户补充信息的硬阻塞；并且相关业务口径已进一步确认：收缴率分母使用 `chargeSum`，工单时效同时保留“响应时长”和“关闭时长”，满意度在 `satisfaction` 之外继续纳入 `satisfactionEval` 客户评价满意度语义。
- 根据 4.4 / 4.5 联合 code review，本故事已把 `average-response-duration-hours` 正式下推到平台语义契约与 metric catalog，不再停留在文档描述层。
- 本地 `cube` 实例与 `compose.yaml` 的对齐已由 `Story 4.7` 补齐，当前 4.4 的本地联调不再依赖纯环境变量占位。

### File List

- _bmad-output/implementation-artifacts/4-4-cube-semantic-read-path-integration.md
- .env.example
- docs/data-contracts/cube-semantic-baseline.md
- src/application/semantic-query/models.ts
- src/application/semantic-query/ports.ts
- src/application/semantic-query/use-cases.ts
- src/infrastructure/cube/config.ts
- src/infrastructure/cube/errors.ts
- src/infrastructure/cube/metric-catalog.ts
- src/infrastructure/cube/query-builder.ts
- src/infrastructure/cube/cube-semantic-query-adapter.ts
- src/infrastructure/cube/index.ts
- tests/story-4-4-semantic-query.test.mjs

## Change Log

- 2026-04-03：完成 Story 4.4 的 Cube 配置、语义指标 contract、只读 adapter、指标口径文档与专属测试基线。
- 2026-04-03：根据 code review 补齐 `average-response-duration-hours` 的正式语义契约与指标目录映射，并复跑 `tests/story-4-4-semantic-query.test.mjs`、`pnpm lint`、`pnpm build`。
- 2026-04-03：由 Story 4.7 对齐本地 `cube` Compose 服务、最小模型与 token 生成脚本，完成本地真实服务联调基线。
