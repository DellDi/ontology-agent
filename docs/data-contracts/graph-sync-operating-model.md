# Java Graph Sync 运行模型

## 边界

Graph Sync 由 Java backend 唯一实现：ERP staging 是来源，PostgreSQL 保存 run、cursor 与 dirty scope
事实，Neo4j 是可重建投影。Next.js 只代理 Cookie 认证的组织管理 API；旧 TypeScript CLI、package
scripts 与 job runner 不再属于可部署入口。

## 运行模式

| mode | scope | trigger | 用途 |
| --- | --- | --- | --- |
| `full-bootstrap` | `all/all` | `system` | 首次入图或灾后全量重建 |
| `org-rebuild` | `organization/{id}` | `manual` 或 `system` | 单组织校正，也是 bootstrap 子运行 |
| `incremental-scan` | `all/{source}` | `scheduler` | 扫描一个 ERP source 并识别 dirty scope |
| `incremental-rebuild` | `organization/{id}` | `scheduler` | 消费 dirty scope 并重建组织 |
| `consistency-sweep` | `organization/{id}` | `manual` | 对当前登录组织执行一致性重建 |

所有模式复用 `GraphBatchBuilder` 与官方 Neo4j Java Driver writer，不存在第二套图写入路径。

## Full bootstrap

`POST /api/system/graph-sync/bootstrap` 只接受 `X-Graph-Sync-Ops-Secret`，不经过 Next：

1. 在 PostgreSQL 中捕获七类 ERP source 的 `(cursorTime, cursorPk)` watermark，并检查 scope/time/pk。
2. 通过 advisory lock 与 active-run 检查创建唯一 `full-bootstrap` parent run。
3. 按 active organization 创建 `org-rebuild` child run；每个组织在一个 Neo4j transaction 内 replace，
   用 `runId` 清理本组织未再次出现的节点与边。
4. 所有 child 成功后，在 PostgreSQL transaction 内完成 parent 并一次性初始化七个 cursor。
5. 任一 child 失败时 parent 标记 `failed`，已经完成的 child 事实保留，cursor 不推进。

parent 的 `cursor_snapshot` 必须包含 `capturedAt`、`correlationId`、七类 `watermarks` 与
`fencingToken`。`GET /api/system/graph-sync/bootstrap/status` 返回最新 parent 事实。

## 增量同步

Spring `@Scheduled` 按 `JAVA_GRAPH_SYNC_SOURCES` 逐一执行：

1. 从该 source 当前 cursor 之后扫描变更，删除记录也必须进入扫描结果。
2. 将变更合并为 organization dirty scope，并保留每个 source 的处理进度。
3. 条件 claim dirty scope；同一 organization 的 rebuild 由数据库锁串行化。
4. 成功后完成 scope；失败保留 error、attempt count 与 last run，最多尝试三次。
5. 该 source 的全部 scope 成功后才推进 cursor；不能跨过失败范围。

调度器处理一个 source 失败时会记录真实错误并继续其他 source，不把失败报告为成功，也不做无限重试。

## PostgreSQL 事实

### `platform.graph_sync_runs`

记录 mode、status、scope、trigger、cursor snapshot、写入计数、错误与时间。状态只允许：
`pending -> running -> completed|failed|partial`。崩溃遗留的 active run 超过租约后会被标记失败，新的
owner 必须持有新的 fencing token。

### `platform.graph_sync_cursors`

每个 ERP source 一行。正式 source 固定为：

- `erp.organizations`
- `erp.projects`
- `erp.owners`
- `erp.charge_items`
- `erp.receivables`
- `erp.payments`
- `erp.service_orders`

### `platform.graph_sync_dirty_scopes`

保存待处理 organization、触发来源、source progress、状态、attempt count、last run 与失败摘要。
重复变更合并进同一 active scope，不创建并行重复任务。

## Neo4j 投影约束

- 每个节点与边携带 `scope_org_id` 和 `last_seen_run_id`。
- 一个组织的 replace 在单一 Neo4j transaction 内执行；事务失败不返回 partial success。
- 清理只能命中当前组织且 `last_seen_run_id != currentRunId` 的投影，不能跨组织删除。
- 重跑相同事实不产生重复节点或边。

## API 与权限

- `/api/admin/graph-sync/**`：服务端 Cookie session + 精确 `PLATFORM_ADMIN`；组织 ID 必须等于 session
  organization。Next 只做透明代理。
- `/api/system/graph-sync/bootstrap**`：仅 backend 内部运维网络 + `GRAPH_SYNC_OPS_SECRET`；不得建立
  Next route，不得向浏览器下发 secret。
- 全局 incremental 没有手工 HTTP 入口，只由 Java scheduler 执行。

## 失败恢复

先查 `graph_sync_runs`、`graph_sync_dirty_scopes` 与 correlation ID，再定位 ERP 或 Neo4j 根因。修复后使用
组织 rebuild 或重新触发 system bootstrap。禁止手工推进 cursor、伪造 completed、直接写 Cypher补偿，
也禁止恢复旧 TypeScript runner 与 Java 并发消费。

具体命令见 [Graph Sync 运行与恢复 Runbook](../runbooks/graph-sync-operations.md)。
