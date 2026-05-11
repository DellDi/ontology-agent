## Deferred from: code review of 7-3-self-hosted-container-deployment-baseline.md (2026-04-12)

- Redis job queue 当前采用 `rPop` 后再更新状态为 `processing` 的模型，缺少 lease、超时回收或重试补偿；worker 在 `completeJob` / `failJob` 前崩溃时，任务可能永久卡在 `processing`，属于生产可靠性债，但不是 Story 7.3 这次 diff 新引入的问题。

## Deferred from: code review of 7-4-observability-and-availability-monitoring.md (2026-04-17)

- `P6` correlation id 对下游外部服务（LLM / ERP / Cube / Neo4j）的 `x-correlation-id` 注入：需要在对应 adapter 层统一包装 fetch；本 story 仅建立 internal trace 契约，外部传播属 Epic 7 retro 或 Story 4.x 改造范围。
- HMR 场景下 AsyncLocalStorage / metrics registry 在 dev reload 时重建，可能造成跨 reload 的计数丢失——仅影响 dev，生产环境接受。
