# Story 10.1.p2: Slot / Lane / Placement Contract for Renderer Registry

Status: done

## 背景

Story 10.1 落地后，`AiRuntimeProjection.messages[0].parts` 当前仅靠**数组顺序**来表达 UI 编排（`status-banner → step-timeline → evidence-card* → conclusion-card → resume-anchor`）。这在 First-Cut 阶段是刻意为之的最小化选择。

随着 Story 10.2 `renderer registry for rich analysis blocks` 启动，UI 需要表达：

- 某些 part 属于主叙事区（primary narrative lane），另一些属于侧边辅助区（secondary / process-board lane）
- 同一 lane 内可以有 relative placement（`before` / `after` / `sticky-top` / `sticky-bottom`）
- renderer registry 需要根据 `{ slot, lane, placement }` 命中正确的 renderer，而不是硬编码数组 index 规则

本 patch story 只做**契约层**：在 application 层显式引入 `slot / lane / placement` 字段，并把 10.1 First-Cut 的 implicit 顺序转译为 explicit 布局语义，不引入 renderer registry 本身。

## Story

As a `AI application runtime layer` 的维护者,  
I want 为 foundation parts 引入 `slot / lane / placement` 显式布局语义,  
so that Story 10.2 renderer registry 与未来多种前端（Web / Mobile / Expert Mode）可以按语义而不是数组顺序命中 renderer。

## Acceptance Criteria

1. `AiRuntimePart` 必须显式增加 `slot`、`lane`、`placement` 三个字段；三者均为字符串字面量联合类型，不得用自由字符串。
2. `slot` 枚举至少覆盖：`narrative-header` / `narrative-body` / `narrative-footer` / `process-board` / `resume`。
3. `lane` 枚举至少覆盖：`primary` / `secondary`。
4. `placement` 枚举至少覆盖：`inline` / `sticky-top` / `sticky-bottom` / `floating`。
5. `buildAiRuntimeProjection` 在映射 foundation parts 时必须为每个 part 显式设置这三个字段，且必须保持与 10.1 First-Cut 已建立的 Primary Narrative Lane 渲染顺序语义等价（不改变用户已见视觉叙事）。
6. `projectionToUIMessages` 必须把 `slot / lane / placement` 透传进 `UIMessage.parts[].data`，让 SDK 兼容渲染器可读取。
7. story 级测试必须覆盖：
   - 每个 foundation part 都设置了三个字段
   - 字段值符合枚举约束
   - 同一输入两次映射产出一致（幂等）
   - 现有"稳定顺序"测试仍然通过（契约不退化）
8. 不得在本 story 中引入 renderer registry 的实现 / 注册表 / host 组件。

## Tasks / Subtasks

- [x] 扩展 `runtime-contract.ts`（AC: 1, 2, 3, 4）
  - [x] 新增 `AiRuntimePartSlot` / `AiRuntimePartLane` / `AiRuntimePartPlacement` 三个字面量联合类型，并配套 `AI_RUNTIME_PART_SLOTS` / `_LANES` / `_PLACEMENTS` `as const` 常量数组。
  - [x] 把三个字段加到 `AiRuntimePartBase`，做成 required；5 种 foundation part 统一 extend。
  - [x] 新增 `resolveAiRuntimePartLayout(kind)` 单一入口纯函数，注释写明语义、扩展规则（不得 free-string）与 10.2 fork 边界。

- [x] 扩展 `runtime-projection-mapper.ts`（AC: 5）
  - [x] `status-banner` → `slot=narrative-header, lane=primary, placement=sticky-top`
  - [x] `step-timeline` → `slot=narrative-body, lane=primary, placement=inline`（Expert Mode / 10.6 process board fork 延后到 10.2）
  - [x] `evidence-card` → `slot=narrative-body, lane=primary, placement=inline`
  - [x] `conclusion-card` → `slot=narrative-footer, lane=primary, placement=inline`
  - [x] `resume-anchor` → `slot=resume, lane=primary, placement=floating`
  - [x] 5 个 builder 统一用 `...resolveAiRuntimePartLayout(kind)` 展开，不在 builder 内硬编码字面量。

- [x] 扩展 `vercel-ai-sdk-adapter.ts`（AC: 6）
  - [x] `UIMessage.parts[].data` 直接承载完整 part（包含 `slot / lane / placement`），SDK 消费端可直接读取。
  - [x] 保留 `UIMessage.parts[].type` 命名规则为 `data-<kind>`，不更动。

- [x] 新增 story 级测试 `tests/story-10-1-p2-*.test.mjs`（AC: 7）3/3 通过：
  - [x] `resolveAiRuntimePartLayout` 输出对每种 kind 严格等值，且枚举集合存在并稳定。
  - [x] projection 每个 part 都带三字段、值在枚举内；同一输入两次映射 layout 序列严格相等。
  - [x] adapter 层 `UIMessage.parts[].data` 透传 `slot / lane / placement`，`type` 仍为 `data-*` 命名。
  - [x] 首尾顺序不退化（`status-banner` 在首、`resume-anchor` 在尾）。

## Dev Notes

- 本 patch 是"契约扩展"，不是"UI 重排"。10.2 renderer registry 才决定把 `slot=process-board` 的 part 真正分流到侧边栏。
- 不要在 mapper 里引入任何关于"当前用户在 Expert Mode 还是 Narrative Mode"的判断 —— 那是 renderer registry / UI consumer 的职责。
- lane = primary / secondary 的区分，**不是**关于 z-index 或尺寸，而是关于叙事重要性。renderer 可以据此决定视觉层级。

## Out of Scope

- 稳定 part id 策略 → 由 10.1.p1 承接
- schemaVersion / contractVersion 元数据 → 由 10.1.p3 承接
- renderer registry / host 组件 → 由 10.2 承接
- Expert Mode / 侧滑流程看板的 part 分流 → 由 10.2 + 10.6 协同

## References

- `_bmad-output/implementation-artifacts/10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md`
- `_bmad-output/planning-artifacts/ux-epic-10-ai-native-interaction-addendum.md`
- `src/application/ai-runtime/runtime-contract.ts`
- `src/application/ai-runtime/runtime-projection-mapper.ts`

## Dev Agent Record

### Context Reference

- 来源于 Story 10.1 fresh-context review 决议。

### Agent Model Used

### Completion Notes List

- 三个字密奇型都定制为字面量联合类型 + `as const` 常量数组，方便测试时 `AI_RUNTIME_PART_SLOTS.includes(part.slot)` 直接大收尾。
- `resolveAiRuntimePartLayout` 放在 contract 中，给 renderer registry / SDK 消费端一个单一入口，避免未来不同渲染器都写一遍映射表。
- 严格保留 10.1 First-Cut 的 Primary Narrative Lane 顺序，story 级测试同时守住“首首尾”与“字段枚举严格等值”。
- Adapter 将 `slot / lane / placement` 通过 `data` 透传，不改 `type: data-<kind>` 命名。

### File List

**Modified**
- `src/application/ai-runtime/runtime-contract.ts` —— 新增 `AI_RUNTIME_PART_SLOTS` / `_LANES` / `_PLACEMENTS` 常量、字面量联合类型、`resolveAiRuntimePartLayout` 纯函数；`AiRuntimePartBase` 加 `slot / lane / placement` required。
- `src/application/ai-runtime/runtime-projection-mapper.ts` —— 所有 part builder 新增 `...resolveAiRuntimePartLayout(kind)` 扩展。

**Added**
- `tests/story-10-1-p2-slot-lane-placement.test.mjs`

**Docs**
- `_bmad-output/implementation-artifacts/10-1-p2-slot-lane-placement-contract-for-renderer-registry.md`

### Change Log

- 2026-04-21 —— patch story 从 10.1 fresh-context review 产出，`ready-for-dev`。
- 2026-04-21 —— 落地完成。`tests/story-10-1-p2-*.test.mjs` 3/3 ✅；全部 10.1 系列测试 16/16 ✅；`pnpm build` ✅；`pnpm lint` ✅；`tsc --noEmit` ✅。`review` 直接 → `done`（patch 范围极小，契约改动已全部由类型系统与测试兼顾）。
