# Story 3.4: 扩展候选影响因素

Status: ready-for-dev

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

- [ ] 建立候选因素模型与扩展规则（AC: 1, 2, 3）
  - [ ] 区分“候选因素”和“最终原因”，不要提前输出结论语义。
  - [ ] 为可解释依据定义最小字段。
- [ ] 将因素扩展接入上下文准备流程（AC: 1, 2）
  - [ ] 仅对需要归因 / 影响分析的问题触发。
  - [ ] 结果挂到当前会话 read model 中。
- [ ] 覆盖分支测试（AC: 2, 3）
  - [ ] 归因类问题生成候选因素。
  - [ ] 简单查询类问题跳过因素扩展。

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

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/3-4-expand-candidate-factors.md
