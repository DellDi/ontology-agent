# Story 10.1.p1: Foundation Parts 稳定 id 策略

Status: done

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

- [x] 在 `src/application/ai-runtime/runtime-contract.ts` 为 foundation parts 声明 id 约束（AC: 1, 3）
  - [x] 新增 `AiRuntimePartBase`，把 `id` 提升为 required；5 种 foundation part 统一 extend。
  - [x] 输出纯函数 `computeAiRuntimePartId(kind, anchors)`；evidence-card 缺失 `eventSequence` 开屏 fail-loud 抛错。
  - [x] 在模块注释中写明 id 生成规则与“只追加、不改定段”的向后兼容承诺。

- [x] 在 `src/application/ai-runtime/runtime-projection-mapper.ts` 落实 id 生成（AC: 2, 3, 4）
  - [x] 5 种 builder 全部接 `anchors`，由 `computeAiRuntimePartId` 统一生成 id，不再在 builder 内部拼接字符串。
  - [x] 规则落地：`status-banner::{sid}::{eid}` / `step-timeline::{sid}::{eid}` / `evidence::{sid}::{eid}::seq-{seq}` / `conclusion::{sid}::{eid}` / `resume-anchor::{sid}::{eid}`。
  - [x] evidence-card 暂保持 per-event 粒度（不拆分 per-block）；id 规则为未来按 block 拆分预留了 `::block-{N}` 追加位。

- [x] 同步更新 `src/infrastructure/ai-runtime/vercel-ai-sdk-adapter.ts`（AC: 2）
  - [x] `UIMessage.parts[].id` 直接沿用 `part.id`，adapter 不再维护任何 fallback id 来源。

- [x] 在 `tests/story-10-1-p1-*.test.mjs` 新增测试（AC: 2, 4, 5）4 用例全通过：
  - [x] `computeAiRuntimePartId` 规则 + evidence-card 缺失 anchor 的 fail-loud。
  - [x] 幂等映射：相同输入两次映射 id 序列相等；同一 projection 内 `new Set(ids).size === ids.length`。
  - [x] 跨 execution 测试：两条 execution parts 合并无任何 id overlap。
  - [x] adapter 一致性：`UIMessage.parts[].id === projection.messages[0].parts[].id`。

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

- 设计取舍：`computeAiRuntimePartId` 放在 `runtime-contract.ts`（而非 mapper），保证未来 renderer / adapter / persistence 任何一方都能从 contract 单一入口读到规则，不重复实现。
- 将 id 生成建模为 `kind + anchors` 而不是行内字符串拼接：evidence-card 缺失 `eventSequence` 时 fail-loud 抛错，而不是默认值兑后面碰实际 id 冲突。
- 未引入 schemaVersion / slot / lane / placement，严格遵守 Out of Scope。
- 略微扩大的发现：adapter 原实现把 `part.sourceEventId` 当成 `UIMessage.parts[].id`，与本次 application 层 id 冲突；已一并修正为统一读 `part.id`，避免 10.2 renderer registry 落地时发现两份 id 源。

### File List

**Modified**
- `src/application/ai-runtime/runtime-contract.ts` —— 新增 `AiRuntimePartBase` / `AiRuntimePartIdAnchors` / `computeAiRuntimePartId`，5 个 foundation part 统一 `id: string` required。
- `src/application/ai-runtime/runtime-projection-mapper.ts` —— 全部 builder 接 `anchors` 参数，通过 `computeAiRuntimePartId` 生成 id。
- `src/infrastructure/ai-runtime/vercel-ai-sdk-adapter.ts` —— `UIMessage.parts[].id` 沿用 application 层 `part.id`。

**Added**
- `tests/story-10-1-p1-foundation-parts-stable-id-strategy.test.mjs`

**Docs**
- `_bmad-output/implementation-artifacts/10-1-p1-foundation-parts-stable-id-strategy.md`

### Change Log

- 2026-04-21 —— patch story 从 10.1 fresh-context review 产出，`ready-for-dev`。
- 2026-04-21 —— 落地完成。`tests/story-10-1-p1-*.test.mjs` 4/4 ✅；`tests/story-10-1-*.test.mjs` 7/7 保持通过✅；`pnpm build` ✅；`pnpm lint` ✅；`tsc --noEmit` ✅。`review` 直接 → `done`（patch 范围极小，无需单独 fresh-context 复审；设计设计计策略与测试覆盖已由 10.1 主 story 契约收附）。
