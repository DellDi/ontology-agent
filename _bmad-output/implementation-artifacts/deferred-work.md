## Deferred from: code review of 7-3-self-hosted-container-deployment-baseline.md (2026-04-12)

- Redis job queue 当前采用 `rPop` 后再更新状态为 `processing` 的模型，缺少 lease、超时回收或重试补偿；worker 在 `completeJob` / `failJob` 前崩溃时，任务可能永久卡在 `processing`，属于生产可靠性债，但不是 Story 7.3 这次 diff 新引入的问题。

## Deferred from: code review of 7-4-observability-and-availability-monitoring.md (2026-04-17)

- `D4` Epic 10 runtime 相关的 SSE 专项 counter / `reasoning-summary` / `assumption-card` renderer 归属：建议在 `Story 10.2 renderer-registry` 与 Epic 10 runtime 落地时统一收口，避免本 story 临时设计被 runtime 抽象推翻。
- `P6` correlation id 对下游外部服务（LLM / ERP / Cube / Neo4j）的 `x-correlation-id` 注入：需要在对应 adapter 层统一包装 fetch；本 story 仅建立 internal trace 契约，外部传播属 Epic 7 retro 或 Story 4.x 改造范围。
- HMR 场景下 AsyncLocalStorage / metrics registry 在 dev reload 时重建，可能造成跨 reload 的计数丢失——仅影响 dev，生产环境接受。

## Deferred from: code review of 10-6-collapsible-execution-process-board-and-expert-mode.md (2026-04-17)

- `parseProgressText` 依赖 render block `label="进度"` 且 value 形如 `"N/M"` 的硬格式；一旦 schema 演进（如 `"N / M steps"` 或切到 `progress` 专用 part）会静默回退到 `stepProgress` 计数且无 warning。属于 renderBlock schema 既有设计问题，非 Story 10.6 引入，建议在 `Story 10.2 renderer-registry` 统一收口。
- `AnalysisPlan._executionAssumptions` 下划线前缀问题（原 P9 发现）：domain 层已有 `_groundedSource` / `_groundingStatus` 同类约定，单改本字段会破坏一致性；建议在 Epic 10 retrospective 统一决策——整体去下划线改为正式 domain 字段，或将"下划线=运行时只读标注"写入 domain 规范。
