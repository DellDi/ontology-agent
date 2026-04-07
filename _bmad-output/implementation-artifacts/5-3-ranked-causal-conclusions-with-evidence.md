# Story 5.3: 输出带证据与富渲染块的归因结论

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 获得排序后的归因结论和关键证据摘要,
so that 我可以直接理解哪些因素最可能导致指标变化。

## Acceptance Criteria

1. 当分析计划执行到可形成结论的阶段时，系统必须输出排序后的原因列表。
2. 每个原因都必须附带至少一条用户可理解的证据摘要。
3. 在同一会话上下文下重复执行结构化归因分析时，系统应尽量保持相同的计划骨架和同类结论排序；明显偏差必须可由证据变化解释。
4. 最终结论必须可被渲染为统一结果块，至少支持原因卡、证据块以及图表或表格中的一种结构化表达。

## Tasks / Subtasks

- [x] 建立归因结果与证据摘要模型（AC: 1, 2, 3, 4）
  - [x] 区分原因排序、证据摘要、置信或说明字段。
  - [x] 结果必须可解释，不能只返回黑盒分数。
  - [x] 为结果块定义可持久化、可投影的 render schema。
- [x] 将结论输出接入执行链路（AC: 1, 2, 3, 4）
  - [x] 从 execution 阶段结果生成可读结论。
  - [x] 在分析页展示主要原因与关键证据。
  - [x] 至少接入一种图表或表格类结构化结果块。
- [x] 覆盖稳定性与可解释性测试（AC: 1, 2, 3, 4）
  - [x] 验证每条原因至少有一条证据摘要。
  - [x] 使用 deterministic fixture 验证相同输入下计划骨架 / 排序稳定。
  - [x] 验证结果块可被后续持久化和移动端投影消费。

## Dev Notes

- 本故事的核心不是“生成很长的解释”，而是“有排序、有证据、可理解、可渲染”。
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
  - 结果 render block 可被服务端 read model 稳定消费

### Previous Story Intelligence

- 4.3 依赖 3.5 的 plan 与 4.1 / 4.2 的 execution / progress 链路。
- 5.4 将持久化这里定义的结论模型，所以字段边界不要随 UI 临时需求漂移。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.3: 输出带证据与富渲染块的归因结论]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-5-3-ranked-conclusions.test.mjs`
- `node --test --test-concurrency=1 tests/story-5-1-analysis-execution.test.mjs tests/story-5-2-execution-stream.test.mjs tests/story-5-3-ranked-conclusions.test.mjs tests/story-5-4-persist-results.test.mjs tests/story-2-6-worker-skeleton.test.mjs tests/story-3-5-analysis-plan.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 新增可解释的归因结论 read model，按阶段结果稳定生成原因排序、证据摘要与置信表达。
- 归因结果现在统一输出为 render blocks，并至少包含表格类结构化表达，供 PC 页面、持久化和移动端投影复用。
- 分析会话页新增归因结论面板，直接展示原因排序、关键证据和结构化结果块。
- 补充 deterministic fixture 与页面集成测试，验证相同输入下排序稳定且每条原因都带证据摘要。

### File List

- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/5-3-ranked-causal-conclusions-with-evidence.md
- src/domain/analysis-execution/stream-models.ts
- src/domain/analysis-result/models.ts
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conclusion-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- tests/story-5-3-ranked-conclusions.test.mjs
