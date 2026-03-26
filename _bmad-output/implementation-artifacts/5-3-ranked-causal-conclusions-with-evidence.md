# Story 5.3: 输出带证据的归因结论

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 获得排序后的归因结论和关键证据摘要,
so that 我可以直接理解哪些因素最可能导致指标变化。

## Acceptance Criteria

1. 当分析计划执行到可形成结论的阶段时，系统必须输出排序后的原因列表。
2. 每个原因都必须附带至少一条用户可理解的证据摘要。
3. 在同一会话上下文下重复执行结构化归因分析时，系统应尽量保持相同的计划骨架和同类结论排序；明显偏差必须可由证据变化解释。

## Tasks / Subtasks

- [ ] 建立归因结果与证据摘要模型（AC: 1, 2, 3）
  - [ ] 区分原因排序、证据摘要、置信或说明字段。
  - [ ] 结果必须可解释，不能只返回黑盒分数。
- [ ] 将结论输出接入执行链路（AC: 1, 2, 3）
  - [ ] 从 execution 阶段结果生成可读结论。
  - [ ] 在分析页展示主要原因与关键证据。
- [ ] 覆盖稳定性与可解释性测试（AC: 1, 2, 3）
  - [ ] 验证每条原因至少有一条证据摘要。
  - [ ] 使用 deterministic fixture 验证相同输入下计划骨架 / 排序稳定。

## Dev Notes

- 本故事的核心不是“生成很长的解释”，而是“有排序、有证据、可理解”。
- 结果模型将被 5.4 持久化、6.x 追问和 8.x 移动端 read model 直接消费，应尽量稳定。
- 不要在这里顺手实现移动端结果页。

### Architecture Compliance

- 结果应通过服务端控制的 read model 输出。
- 证据摘要必须经过权限与范围约束，不能把底层敏感明细直接下发客户端。
- NFR3 / NFR8 要求结论完整且在相同输入下尽量稳定。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-result/`
  - `src/application/analysis-results/` 或 `src/application/analysis-execution/`
  - 分析页结论与证据组件
  - 视需要新增结果持久化 schema

### Testing Requirements

- 至少覆盖：
  - 排序后的原因列表生成
  - 每条原因至少一条证据摘要
  - 相同输入下排序基本稳定
  - 证据变化时偏差可解释

### Previous Story Intelligence

- 4.3 依赖 3.5 的 plan 与 4.1 / 4.2 的 execution / progress 链路。
- 5.4 将持久化这里定义的结论模型，所以字段边界不要随 UI 临时需求漂移。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.3: 输出带证据的归因结论]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/5-3-ranked-causal-conclusions-with-evidence.md
