# Story 10.1.p3: SchemaVersion / ContractVersion 元数据

Status: done

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

- [x] 在 `runtime-contract.ts` 添加版本常量与字段（AC: 1, 2）
  - [x] `AI_RUNTIME_SCHEMA_VERSION = 1` 起步（`as const`）
  - [x] `AI_RUNTIME_CONTRACT_VERSION = 1` 起步（`as const`）
  - [x] `AiRuntimeProjection.schemaVersion: number` / `.contractVersion: number` 改为 required

- [x] 在 `runtime-projection-mapper.ts` 填充版本（AC: 2）
  - [x] `buildAiRuntimeProjection` return 时从常量赋值：`schemaVersion: AI_RUNTIME_SCHEMA_VERSION` / `contractVersion: AI_RUNTIME_CONTRACT_VERSION`

- [x] 在 `vercel-ai-sdk-adapter.ts` 透传版本（AC: 3）
  - [x] `AiRuntimeUIMessageMetadata` 新增 `schemaVersion` / `contractVersion` 两个字段；`toUIMessage` 从 `projection` 读取，而不是重新 import 常量，守住"事实单一来源"。

- [x] 新增 `assertAiRuntimeVersions` 纯函数（AC: 4）
  - [x] 错误信息格式：`ai-runtime version mismatch: field=<shape|schemaVersion|contractVersion>, expected=<>, actual=<>`
  - [x] 不返回 fallback，仅抛错；调用者决定是否 catch-and-migrate；支持 `expected` 缺省做 shape-only 校验。

- [x] 新增 story 级测试 `tests/story-10-1-p3-*.test.mjs`（AC: 5）2/2 通过：
  - [x] projection / UIMessage.metadata 都带版本字段，值与常量相等，且两者互为镜像。
  - [x] `assertAiRuntimeVersions` 的 5 个分支：shape-only 通过、expected 匹配通过、schema 不匹配抛、contract 不匹配抛、shape 缺失抛。

- [x] 在 story 文档与代码注释里写明 bump 规则（AC: 6）
  - [x] `runtime-contract.ts` 的版本号注释块给出 decision tree：新增 part kind / 修改字段 / 改 mapper 行为分别对应 SCHEMA / CONTRACT 的 bump；两者都变时分别 bump，不合并。

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

- `AI_RUNTIME_SCHEMA_VERSION` / `AI_RUNTIME_CONTRACT_VERSION` 都从 1 起步，单调整数，无 semver。
- `assertAiRuntimeVersions` 的错误信息格式统一为 `ai-runtime version mismatch: field=<>, expected=<>, actual=<>`，方便下游 log parse 和未来 10.3 migration runner 提取 diagnostic。
- adapter metadata 从 projection 读取而非重新 import 常量，守住“事实单一来源”；test 双向验证了两者相等。
- 未引入 migration runner / 持久化 / `useChat` 客户端切换，严格 Out of Scope。

### File List

**Modified**
- `src/application/ai-runtime/runtime-contract.ts` —— 新增 `AI_RUNTIME_SCHEMA_VERSION` / `AI_RUNTIME_CONTRACT_VERSION` 常量、`AiRuntimeProjection` 加 `schemaVersion` / `contractVersion` required、`assertAiRuntimeVersions` fail-loud 纯函数。
- `src/application/ai-runtime/runtime-projection-mapper.ts` —— projection 输出时填充两个版本号。
- `src/infrastructure/ai-runtime/vercel-ai-sdk-adapter.ts` —— `UIMessage.metadata` 新增 `schemaVersion` / `contractVersion`，从 projection 读取。

**Added**
- `tests/story-10-1-p3-schema-version.test.mjs`

**Docs**
- `_bmad-output/implementation-artifacts/10-1-p3-schema-version-and-contract-version-metadata.md`

### Change Log

- 2026-04-21 —— patch story 从 10.1 fresh-context review 产出，`ready-for-dev`。
- 2026-04-21 —— 落地完成。`tests/story-10-1-p3-*.test.mjs` 2/2 ✅；全部 10.1 系列测试 16/16 ✅；`pnpm build` ✅；`pnpm lint` ✅；`tsc --noEmit` ✅。`review` 直接 → `done`。
