# Story 10.1.p3: SchemaVersion / ContractVersion 元数据

Status: ready-for-dev

## 背景

Story 10.1 把 application 层 `AiRuntimeProjection` 与 infrastructure 层 `UIMessage` SDK 形态固定下来之后，后续 Epic 10 仍会继续演化：

- Story 10.2 renderer registry 会给每个 part 增加更多语义字段
- Story 10.3 projection persistence 会把 projection 存储到 Postgres / Redis，跨版本读写会成为常态
- Story 10.5 mobile projection 会基于同一 interaction schema 生成移动端视图
- 未来可能引入 client-side `useChat` / richer transport（分片、断点续传、tool UI state）

在这些场景下，缺少显式的 `schemaVersion`（契约版本）与 `contractVersion`（事实向 projection 映射的版本）会让**"旧 projection 文档被新代码读取"**变成一个静默兼容问题。本 patch story 只负责：

1. 把两个版本号显式写入 application 层与 SDK 层
2. 建立"版本不匹配时 fail-loud"的运行期契约
3. 文档化升级规则

**本 story 不做持久化**（那是 10.3 的职责），但会把版本号显式带进 `AiRuntimeProjection` 的出参，为 10.3 做准备。

## Story

As a `AI application runtime layer` 的维护者,  
I want 为 runtime projection 与 SDK UIMessage 显式声明 `schemaVersion` 与 `contractVersion`,  
so that 未来 projection 持久化、跨前端适配、richer transport 迁移可以用显式版本号做 fail-loud 校验，而不是依赖隐式假设。

## Acceptance Criteria

1. `runtime-contract.ts` 必须声明两个常量：
   - `AI_RUNTIME_SCHEMA_VERSION`：part schema 形状的版本（增加 part kind、增删字段才 bump）
   - `AI_RUNTIME_CONTRACT_VERSION`：mapper 行为契约的版本（mapper 行为变化、投影规则变化才 bump）
2. `AiRuntimeProjection` 必须显式包含 `schemaVersion` 与 `contractVersion` 字段。
3. `UIMessage.metadata` 必须包含 `schemaVersion` 与 `contractVersion`，与 projection 一致。
4. 必须提供 `assertAiRuntimeVersions(projectionOrMessage, expected?)` 纯函数：若传入 expected，必须严格等于；若未传入 expected，仅做 shape 检查。不匹配时抛错，**不得返回 fallback**。
5. story 级测试覆盖：
   - projection 与 UIMessage 的版本字段存在且值来自常量
   - `assertAiRuntimeVersions` 在版本匹配时静默通过
   - `assertAiRuntimeVersions` 在版本不匹配时抛出可读错误（包含 `expected` / `actual` / `field`）
6. 文档必须写明：
   - 何时 bump `SCHEMA_VERSION`
   - 何时 bump `CONTRACT_VERSION`
   - 10.3 projection 持久化将如何用这两个字段做 migration
7. 不得在本 story 中引入 projection 持久化 / migration runner / 版本迁移代码，这些属于 10.3。

## Tasks / Subtasks

- [ ] 在 `runtime-contract.ts` 添加版本常量与字段（AC: 1, 2）
  - [ ] `AI_RUNTIME_SCHEMA_VERSION = 1` 起步
  - [ ] `AI_RUNTIME_CONTRACT_VERSION = 1` 起步
  - [ ] `AiRuntimeProjection.schemaVersion: number` / `.contractVersion: number` 改为 required

- [ ] 在 `runtime-projection-mapper.ts` 填充版本（AC: 2）
  - [ ] `buildAiRuntimeProjection` 最终 return 时直接读取常量赋值

- [ ] 在 `vercel-ai-sdk-adapter.ts` 透传版本（AC: 3）
  - [ ] `UIMessage.metadata` 新增两个字段，值从 projection 读取（而不是重新从常量读取，避免 adapter 与 mapper 版本漂移）

- [ ] 新增 `assertAiRuntimeVersions` 纯函数（AC: 4）
  - [ ] 失败时错误信息格式：`ai-runtime version mismatch: field=<>, expected=<>, actual=<>`
  - [ ] 设计成 side-effect 仅抛错，调用者决定是 fail-loud 还是 catch-and-migrate

- [ ] 新增 story 级测试 `tests/story-10-1-p3-*.test.mjs`（AC: 5）

- [ ] 在 story 文档与代码注释里写明 bump 规则（AC: 6）
  - [ ] 给出 decision tree：新增 part kind / 修改字段 / 改 mapper 行为分别对应哪一个版本号

## Dev Notes

- 两个版本号分开的理由：part schema 与 mapper 行为可能独立演化。若合并成一个版本号，会倒逼每次 mapper 小改动都 bump schema，导致下游 migration 代价虚高。
- 版本号使用单调整数，不要用 semver 字符串。projection 持久化的 migration 以整数做 case 分支最简单。
- **不要**把版本号塞进 part id（那是 10.1.p1 的职责，且 part id 要稳定）。版本号只放在 projection / metadata 顶层。
- adapter 应从 projection 读取版本（保持"事实单一来源"），而不是 adapter 独立引入常量。

## Out of Scope

- projection 持久化 / migration runner → 10.3
- slot / lane / placement → 10.1.p2
- 稳定 part id → 10.1.p1
- `useChat` 客户端迁移 → 未来单独 story

## References

- `_bmad-output/implementation-artifacts/10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md`
- `_bmad-output/implementation-artifacts/10-3-ui-message-projection-persistence-and-resume.md`
- `src/application/ai-runtime/runtime-contract.ts`
- `src/application/ai-runtime/runtime-projection-mapper.ts`
- `src/infrastructure/ai-runtime/vercel-ai-sdk-adapter.ts`

## Dev Agent Record

### Context Reference

- 来源于 Story 10.1 fresh-context review 决议。

### Agent Model Used

### Completion Notes List

### File List

### Change Log

- 2026-04-21 —— patch story 从 10.1 fresh-context review 产出，`ready-for-dev`。
