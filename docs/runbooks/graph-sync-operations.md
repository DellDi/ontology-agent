# Graph Sync 运行与补偿 Runbook

## 目标

本 runbook 提供 graph sync 的统一运维入口，用于：

- 首次全量建图
- 手工按组织重建
- 增量扫描
- dirty scope 派发与失败补偿
- 一致性巡检
- 当前运行状态查看

所有入口都复用正式 graph sync 运行模型，不允许绕过 `7.6 / 7.7` 的受控路径直接写图库。

## 命令入口

- `pnpm graph:sync:bootstrap`
  - 对全部组织执行首次全量或灾后重建
  - 可选：`--organizationIds=org-1,org-2`
- `pnpm graph:sync:org --organizationIds=org-1`
  - 手工按组织触发 `org-rebuild`
- `pnpm graph:sync:incremental`
  - 只执行 watermark 扫描并写入 dirty scope
  - 可选：`--sourceNames=erp.projects,erp.receivables`
- `pnpm graph:sync:dispatch`
  - 只消费 pending dirty scope 并推进 cursor
  - 可选：`--sourceNames=erp.projects`
- `pnpm graph:sync:dispatch --retry-failed --maxRetryAttempts=3`
  - 显式重试未超过阈值的 failed dirty scope
- `pnpm graph:sync:consistency-sweep`
  - 对补偿范围执行定期巡检重建
  - 可选：`--organizationIds=org-1,org-2`
  - 可选：`--limit=50`
- `pnpm graph:sync:status`
  - 输出最近 run、dirty scope 积压与失败摘要

## 参数与退出码

- 所有命令统一支持：
  - `--triggerType=manual|scheduler|deployment|recovery`
  - `--triggeredBy=<operator-or-system>`
- 所有命令成功时输出 `graph-sync.job.completed` JSON 并以退出码 `0` 结束
- 所有命令失败时输出 `graph-sync.job.failed` JSON 并以退出码 `1` 结束

## 补偿策略

- 默认 `incremental` 不负责消费 dirty scope，只负责发现变更
- 默认 `dispatch` 只处理 `pending` dirty scope
- 失败 dirty scope 不会静默消失，必须通过显式 `--retry-failed` 重试
- `attempt_count >= maxRetryAttempts` 的 failed dirty scope 视为人工介入项

## 状态检查

建议先执行：

```bash
pnpm graph:sync:status
```

重点关注：

- 最近 run 是否出现 `failed / partial`
- `pending` 是否持续堆积
- `failed` 中是否存在超过最大重试阈值的范围

## 人工介入顺序

1. 先看 `pnpm graph:sync:status`
2. 对 retryable failed scope 执行 `pnpm graph:sync:dispatch --retry-failed`
3. 对单个高价值组织执行 `pnpm graph:sync:org --organizationIds=<org-id>`
4. 如怀疑源端漏标或游标质量问题，执行 `pnpm graph:sync:consistency-sweep`
