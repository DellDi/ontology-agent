# Story 10.1.p1: Foundation Parts 稳定 id 策略

Status: ready-for-dev

## 背景

Story 10.1 外部 code review 指出：`AiRuntimeProjection` 的 foundation parts（`status-banner` / `step-timeline` / `evidence-card` / `conclusion-card` / `resume-anchor`）当前没有显式的稳定 id 策略。在 10.1 First-Cut 中，UI 仅依赖数组顺序渲染；一旦进入 Story 10.2 `renderer registry for rich analysis blocks`，渲染层需要基于 id 做：

- React reconciliation 的 `key`，避免切换 execution / follow-up 时错误复用上一条 part 的 DOM 节点
- renderer registry 的命中定位（renderer 可针对特定 part id 做增量渲染、跳过未变更 part）
- 与 `UIMessage.parts` 的 `data-*` type 形成稳定的"id + type"双键，便于未来 client 端 `useChat` 做 part 级 diff

本 patch story 只负责把"稳定 id 策略"固化进 application 层契约与 mapper，不引入 renderer registry 本身。

## Story

As a `AI application runtime layer` 的维护者,  
I want 为每一类 foundation part 提供确定性、可追溯、可在同一 projection 内唯一的 id 策略,  
so that Story 10.2 renderer registry、未来 client-side `useChat` 与 projection persistence 都能以 id 为一级键对 part 做定位、diff、缓存。

## Acceptance Criteria

1. `runtime-contract.ts` 必须显式声明 `AiRuntimePart.id` 为必填字段，并在类型层面为五种 foundation part 各自约束 id 的生成规则。
2. `buildAiRuntimeProjection` 在同一 projection 的 `message.parts` 内产生的所有 id 必须全局唯一；同一 canonical event 序列两次映射必须产生完全相同的 id 序列（幂等）。
3. id 必须与 canonical truth 形成可追溯关系：`step-timeline` 的 id 要能反映其来源 execution + step，`evidence-card` 的 id 要能反映其来源 event sequence / block index，`conclusion-card` 的 id 要能反映 execution 的汇总归因而非某条 event。
4. id 生成逻辑必须为**纯函数**：不得依赖 `Date.now()` / `Math.random()` / `crypto.randomUUID()` 等任何非确定性源，以便服务端 SSR 与客户端 re-projection 完全一致。
5. 必须新增 story 级测试覆盖：同一输入两次映射产出相同 id；不同 execution 的 part id 必须不冲突；同一 execution 内不同 kind 的 part id 必须在全局集合中唯一。
6. 不得在本 story 中落地 renderer registry / slot-lane-placement / schemaVersion 等 10.1.p2 / 10.1.p3 的内容。

## Tasks / Subtasks

- [ ] 在 `src/application/ai-runtime/runtime-contract.ts` 为 foundation parts 声明 id 约束（AC: 1, 3）
  - [ ] 在 base type 上把 `id` 提升为显式字段，并在文档注释里写明每一类的生成规则示例。
  - [ ] 若需要，为 id 生成提供独立的 `computePartId(kind, anchors)` 纯函数签名（不是运行时必需，但方便测试）。

- [ ] 在 `src/application/ai-runtime/runtime-projection-mapper.ts` 落实 id 生成（AC: 2, 3, 4）
  - [ ] `status-banner`：`status-banner::{sessionId}::{executionId}`（一条 projection 内全局唯一）。
  - [ ] `step-timeline`：`step-timeline::{sessionId}::{executionId}`；其内部 steps 的 `step.id` 保持来源 canonical truth。
  - [ ] `evidence-card`：`evidence::{sessionId}::{executionId}::seq-{event.sequence}::block-{blockIndex}`。
  - [ ] `conclusion-card`：`conclusion::{sessionId}::{executionId}`。
  - [ ] `resume-anchor`：`resume-anchor::{sessionId}::{executionId}`。
  - [ ] 所有 id 仅由 sessionId / executionId / event.sequence / blockIndex 推导，不得引入随机或时间。

- [ ] 同步更新 `src/infrastructure/ai-runtime/vercel-ai-sdk-adapter.ts`（AC: 2）
  - [ ] `projectionToUIMessages` 的 `UIMessage.parts[].id` 必须直接沿用 application 层 part id，不得在 adapter 层重新生成。

- [ ] 在 `tests/story-10-1-p1-*.test.mjs` 新增测试（AC: 2, 4, 5）
  - [ ] 相同输入两次映射：`projection.messages[0].parts.map(p => p.id)` 严格相等。
  - [ ] 不同 execution 生成的 parts 放一起也不冲突。
  - [ ] 同一 projection 内 `new Set(part.ids).size === parts.length`。
  - [ ] adapter 层 `UIMessage.parts[].id` 与 application 层一致。

## Dev Notes

- 此 patch 不改变 canonical truth，也不改变 merge / mapper 的核心算法。
- 生成规则显式写在 mapper 中，避免把"怎么拼 id"散落到各处。
- 将来若发现某个 id 规则冲突或表达力不足，可以再开 patch；但**不要**往 id 里塞 runtime-only 的可变字段（比如 lastSequence 或 status），否则 id 会随流式推进而漂移，违反 AC 2 幂等。
- id 里**不**要写 `schemaVersion`（那是 10.1.p3 的职责）。

## Out of Scope

- slot / lane / placement 元数据 → 由 10.1.p2 承接
- schema / contract version 元数据 → 由 10.1.p3 承接
- renderer registry 本身 → 由 10.2 承接

## References

- `_bmad-output/implementation-artifacts/10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md`
- `src/application/ai-runtime/runtime-contract.ts`
- `src/application/ai-runtime/runtime-projection-mapper.ts`
- `src/infrastructure/ai-runtime/vercel-ai-sdk-adapter.ts`

## Dev Agent Record

### Context Reference

- 来源于 Story 10.1 fresh-context review 决议，明确拆出该 patch。

### Agent Model Used

### Completion Notes List

### File List

### Change Log

- 2026-04-21 —— patch story 从 10.1 fresh-context review 产出，`ready-for-dev`。
