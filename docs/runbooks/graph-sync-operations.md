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
- `pnpm graph:sync:diagnose-org --organizationIds=org-1`
  - 诊断某个组织键是否能命中真实组织主数据
  - 输出 `organization_path` 下的下级组织数、项目数、服务单数
  - 同时对比 `precinct.organization_id` 与真实生效的 `precinct.org_id`
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

## 真实组织键说明

- 当前 ERP 源数据的真实组织主数据来自 `erp_staging.dw_datacenter_system_organization`
- graph sync 手工重建、`bootstrap` 默认发现、`consistency-sweep` 默认发现，都应使用能命中 `source_id` 的真实组织键
- 在当前样本数据中，`erp_staging.dw_datacenter_precinct.organization_id` 可能出现大量 `0`，它不是可靠的组织键来源
- 对项目范围真正生效的组织键通常是 `erp_staging.dw_datacenter_precinct.org_id`
- 当 `org-rebuild` 需要覆盖下级组织时，实际作用域来自 `dw_datacenter_system_organization.organization_path`

建议先执行：

```bash
pnpm graph:sync:diagnose-org --organizationIds=<org-id>
```

重点关注：

- `matchedOrganization` 是否为空
- `precinctOrganizationIdMatchCount` 是否只是命中伪值
- `precinctOrgIdMatchCount`、`projectCount`、`serviceOrderCount` 是否能说明真实覆盖范围
- `diagnostics` 是否提示“实际作用域键为 org_id”或“来自 organization_path 扩展”

## 人工介入顺序

1. 先看 `pnpm graph:sync:status`
2. 如怀疑组织键不真实，先看 `pnpm graph:sync:diagnose-org --organizationIds=<org-id>`
3. 对 retryable failed scope 执行 `pnpm graph:sync:dispatch --retry-failed`
4. 对单个高价值组织执行 `pnpm graph:sync:org --organizationIds=<org-id>`
5. 如怀疑源端漏标或游标质量问题，执行 `pnpm graph:sync:consistency-sweep`
