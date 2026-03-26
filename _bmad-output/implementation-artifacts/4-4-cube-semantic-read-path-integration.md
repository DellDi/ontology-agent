# Story 4.4: Cube 语义层只读查询接入

Status: ready-for-dev

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

- [ ] 建立 Cube 连接配置与健康检查（AC: 1, 2）
  - [ ] 明确 Cube API / token / endpoint / 查询超时与错误处理约定。
  - [ ] 新增最小健康检查或配置校验入口。
- [ ] 建立 semantic query adapter 与 metric contract（AC: 1, 2, 3）
  - [ ] 定义平台内部的 metric query / compare query / group-by query 契约。
  - [ ] 新增将平台查询意图转换为 Cube 查询的只读 adapter。
- [ ] 明确分析 schema 与语义模型前置（AC: 3）
  - [ ] 梳理哪些指标直接来自 ERP 清洗结果，哪些需要聚合 / 派生 / 重命名后进入 Cube。
  - [ ] 不允许让执行故事在业务代码中重复定义指标口径。
- [ ] 覆盖查询与口径测试（AC: 1, 2, 3）
  - [ ] 验证上层使用统一 metric contract。
  - [ ] 验证只读查询与错误兜底。
  - [ ] 验证基础口径映射存在且可复用。

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

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/4-4-cube-semantic-read-path-integration.md
