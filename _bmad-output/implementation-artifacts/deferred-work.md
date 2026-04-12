## Deferred from: code review of 7-3-self-hosted-container-deployment-baseline.md (2026-04-12)

- Redis job queue 当前采用 `rPop` 后再更新状态为 `processing` 的模型，缺少 lease、超时回收或重试补偿；worker 在 `completeJob` / `failJob` 前崩溃时，任务可能永久卡在 `processing`，属于生产可靠性债，但不是 Story 7.3 这次 diff 新引入的问题。
