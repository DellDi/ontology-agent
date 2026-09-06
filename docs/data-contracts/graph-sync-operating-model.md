# Java Graph Sync 运行模型

## 边界

Graph Sync 由 Java backend 唯一编排。PostgreSQL canonical facts 是关系投影的唯一来源，
`DatasetVersionSet` 是投影与 execution 的版本边界，Neo4j 只是可重建、可按版本隔离的关系视图。
Graph Sync 不再读取 `erp_staging`，也不维护第二套 ERP source cursor。

领域通过 `GraphBatchBuilder` port 提供：

- 最新或指定的 frozen canonical projection；
- projection 内的 active organization；
- 从绑定产品版本构建的节点和边。

当前实现是 Property Domain Pack 的 `PropertyGraphBatchBuilder`。平台 Graph Sync 控制面不包含
Property 表名或产品常量。

## 运行模式

| mode | scope | trigger | 用途 |
| --- | --- | --- | --- |
| `full-bootstrap` | `all/all` | `system` | 将一个 frozen set 的全部组织投影到 Neo4j |
| `org-rebuild` | `organization/{id}` | `manual` 或 `system` | 重建指定组织与指定或最新 frozen set |
| `consistency-sweep` | `organization/{id}` | `manual` | 对当前登录组织执行 canonical 一致性重建 |

旧 `incremental-scan` / `incremental-rebuild` 和七类 ERP watermark 已退出活动链路。增量变化先由通用
ingestion 形成新的 canonical 产品版本与 frozen set；Graph Sync scheduler 发现新 set 后进行幂等重建。

## Full bootstrap

`POST /api/system/graph-sync/bootstrap` 只接受 `X-Graph-Sync-Ops-Secret`，不经过 Web：

1. 解析最新完整 frozen Property set；也可用 `datasetVersionSetId` 参数重放指定历史 set。
2. 通过 PostgreSQL advisory lock 与 active-run 检查创建唯一 parent run。
3. 将同一个 `GraphProjection` 传给全部 organization child，禁止执行中切换版本。
4. 每个组织在单个 Neo4j transaction 内写节点、边、清理同组织同 set 的旧 run 数据，并写入
   `GraphProjection(status=complete)` manifest。
5. 所有 child 成功后完成 parent；任一 child 失败时 parent 明确进入 `failed` 或 `partial`。

parent 与 child 的 `cursor_snapshot` 保存 `datasetVersionSetId`、完整 `productVersionIds`、
correlation ID 与 fencing token。这里的字段名为历史兼容，已不表示 ERP cursor。

## 版本与一致性约束

- `GraphNode`、`GRAPH_EDGE`、`GraphProjection` 均带 `scope_org_id` 与 `dataset_version_set_id`。
- 每个节点和边还带 `source_product_key`、`product_version_id`；writer 在提交前校验版本确实属于目标
  frozen projection。
- cleanup 只作用于同组织、同 set、不同 run 的投影，不覆盖历史 execution 绑定的旧 set。
- Evidence 先要求目标组织/set 的 manifest 为 `complete`，否则返回 `GRAPH_PROJECTION_NOT_READY`；
  禁止 fallback 到 latest。
- Evidence 同时校验 project、charge-item、receivable/payment 节点和边的产品版本。
- canonical fact 缺少 project 或 charge-item 引用时构图 fail loud，不伪造关系节点。

当前 Property 能力只消费 project、charge-item、receivable、payment 关系。旧 owner 图节点没有对应的
canonical 产品，P5 明确不生成 owner projection；如未来出现真实 owner 图消费者，应先增加
`property-owner` 产品和版本化 transform，再恢复该关系。

## PostgreSQL 事实

`platform.graph_sync_runs` 保留 mode、status、scope、trigger、projection snapshot、写入计数、错误与时间。
历史 `graph_sync_cursors` / `graph_sync_dirty_scopes` 表仅作为已发布迁移的审计遗留，不再由活动服务读写。
管理状态接口暂时保留原 JSON 字段并返回空 cursor/backlog，以避免无关前端契约破坏。

## API 与权限

- `/api/admin/graph-sync/**`：Cookie session + 精确 `PLATFORM_ADMIN`；组织 ID 必须等于 session scope。
- 组织 rebuild 可选 `datasetVersionSetId`，用于重放指定历史 projection。
- `/api/system/graph-sync/bootstrap**`：内部运维网络 + `GRAPH_SYNC_OPS_SECRET`；bootstrap 同样可选
  `datasetVersionSetId`。

具体命令见 [Graph Sync 运行与恢复 Runbook](../runbooks/graph-sync-operations.md)。
