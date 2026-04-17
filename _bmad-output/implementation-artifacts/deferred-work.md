## Deferred from: code review of 7-3-self-hosted-container-deployment-baseline.md (2026-04-12)

- Redis job queue 当前采用 `rPop` 后再更新状态为 `processing` 的模型，缺少 lease、超时回收或重试补偿；worker 在 `completeJob` / `failJob` 前崩溃时，任务可能永久卡在 `processing`，属于生产可靠性债，但不是 Story 7.3 这次 diff 新引入的问题。

## Deferred from: code review of 10-6-collapsible-execution-process-board-and-expert-mode.md (2026-04-17)

- `parseProgressText` 依赖 render block `label="进度"` 且 value 形如 `"N/M"` 的硬格式；一旦 schema 演进（如 `"N / M steps"` 或切到 `progress` 专用 part）会静默回退到 `stepProgress` 计数且无 warning。属于 renderBlock schema 既有设计问题，非 Story 10.6 引入，建议在 `Story 10.2 renderer-registry` 统一收口。
- `AnalysisPlan._executionAssumptions` 下划线前缀问题（原 P9 发现）：domain 层已有 `_groundedSource` / `_groundingStatus` 同类约定，单改本字段会破坏一致性；建议在 Epic 10 retrospective 统一决策——整体去下划线改为正式 domain 字段，或将"下划线=运行时只读标注"写入 domain 规范。
