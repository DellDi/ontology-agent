# Story 3.4: 扩展候选影响因素

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在归因分析中看到系统扩展出的候选影响因素,
so that 我能理解系统为何要从这些方向展开分析。

## Acceptance Criteria

1. 当问题被识别为归因分析或影响分析时，系统必须扩展候选影响因素列表。
2. 每个候选因素都必须附带与当前指标或实体相关的可解释依据。
3. 对于简单查询或基础对比，系统可以跳过该步骤，但不能强行展示无关因素。

## Tasks / Subtasks

- [x] 建立候选因素模型与扩展规则（AC: 1, 2, 3）
  - [x] 区分“候选因素”和“最终原因”，不要提前输出结论语义。
  - [x] 为可解释依据定义最小字段。
- [x] 将因素扩展接入上下文准备流程（AC: 1, 2）
  - [x] 仅对需要归因 / 影响分析的问题触发。
  - [x] 结果挂到当前会话 read model 中。
- [x] 覆盖分支测试（AC: 2, 3）
  - [x] 归因类问题生成候选因素。
  - [x] 简单查询类问题跳过因素扩展。

## Dev Notes

- 当前故事可以使用 stub / fake provider 建立契约，不要求接入 Neo4j、Cube 或真实知识图谱。
- “跳过该步骤”是明确需求，别把所有问题都强行做成复杂归因。
- 解释依据字段会直接影响 Story 4.3 的结论可解释性。

### Architecture Compliance

- 业务逻辑应位于 application / domain 层，不写在分析页组件里。
- 因素扩展不能绕过当前 scope 边界，也不能凭空引入与问题无关的业务对象。
- 页面展示的是服务端生成的候选因素 read model。

### File Structure Requirements

- 重点文件预计包括：
  - `src/application/factor-expansion/`
  - `src/domain/analysis-intent/`
  - `src/domain/analysis-context/`
  - 分析页候选因素展示组件

### Testing Requirements

- 至少覆盖：
  - 归因类问题生成候选因素
  - 非归因问题跳过扩展
  - 每个因素包含可解释依据

### Previous Story Intelligence

- 本故事依赖 3.1 的 intent 分类与 3.2 / 3.3 的上下文确认结果。
- 因素列表会成为 3.5 计划生成和 4.3 证据展示的重要输入。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4: 扩展候选影响因素]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#数据架构]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test tests/story-3-4-candidate-factors.test.mjs`
- `node --test --test-concurrency=1 tests/story-3-2-context-extraction-display.test.mjs tests/story-3-3-context-correction.test.mjs tests/story-3-4-candidate-factors.test.mjs`
- `node --test --test-concurrency=1 tests/*.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- 新增规则型 `factor-expansion` 领域与用例层，在不引入 Neo4j 的前提下完成候选因素扩展契约。
- 归因 / 影响类问题现在会在分析页右侧生成候选影响因素列表，并明确标注“这些因素不是最终结论”。
- 每个候选因素都带有与当前指标、实体或时间范围绑定的可解释依据，避免只给出空洞标签。
- 对直接查询或基础对比类问题，系统会明确展示“已跳过候选因素扩展”，不再强行渲染无关因素。
- 分析页右侧从纯占位容器升级为真实候选因素面板，为 Story 3.5 的计划生成和 Story 4.3 的证据解释预留稳定入口。
- 新增 Story 3.4 集成测试，覆盖归因类问题扩展与非归因类问题跳过两个主分支。

### File List

- _bmad-output/implementation-artifacts/3-4-expand-candidate-factors.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/candidate-factor-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/application/factor-expansion/use-cases.ts
- src/domain/factor-expansion/models.ts
- src/infrastructure/factor-expansion/index.ts
- tests/story-3-4-candidate-factors.test.mjs

## Change Log

- 2026-03-27: 完成 Story 3.4，实现候选影响因素扩展规则、分析页展示面板与分支集成测试。
