# Java Graph Sync 运行与恢复 Runbook

## 唯一运行边界

Java backend 从 PostgreSQL canonical facts 构建 Neo4j 投影。来源数据库到 canonical 的全量/增量、
cursor、批次、版本和 lineage 由 ingestion control plane 负责；Graph Sync 不直接扫描 ERP staging。

生产必须显式配置：

```env
JAVA_GRAPH_SYNC_ENABLED=true
JAVA_GRAPH_SYNC_POLL_DELAY=5m
GRAPH_SYNC_OPS_SECRET=replace-with-a-long-random-secret
```

调度器只在发现尚未完成投影的新 frozen `DatasetVersionSet` 时启动 bootstrap。

## 管理 API

以下 API 需要已登录且服务端确认的 `PLATFORM_ADMIN`，并严格使用 session organization：

- `GET /api/admin/graph-sync/status`：查看当前组织最近 run；旧 cursor/backlog 字段保持为空。
- `GET /api/admin/graph-sync/organizations/{organizationId}/status`：查看组织最近 run。
- `POST /api/admin/graph-sync/organizations/{organizationId}/rebuild`：重建最新 frozen set。
- `POST /api/admin/graph-sync/organizations/{organizationId}/rebuild?datasetVersionSetId={setId}`：重放指定 set。
- `POST /api/admin/graph-sync/consistency-sweep`：重建当前组织的最新 frozen set。

### Full bootstrap system API

首次投影、灾后恢复或新 set 发布后可以显式触发：

```bash
docker compose -f compose.prod.yaml --env-file .env.prod exec -T backend \
  sh -lc 'curl --fail --silent --request POST --header "X-Graph-Sync-Ops-Secret: ${GRAPH_SYNC_OPS_SECRET}" http://127.0.0.1:8080/api/system/graph-sync/bootstrap'

docker compose -f compose.prod.yaml --env-file .env.prod exec -T backend \
  sh -lc 'curl --fail --silent --header "X-Graph-Sync-Ops-Secret: ${GRAPH_SYNC_OPS_SECRET}" http://127.0.0.1:8080/api/system/graph-sync/bootstrap/status'
```

重放历史版本时，在 bootstrap URL 追加经过 URL encoding 的 `datasetVersionSetId`。禁止因旧 projection
缺失而读取 latest 代替。

## 就绪与失败语义

- PostgreSQL `platform.graph_sync_runs` 是运行审计事实。
- parent/child snapshot 必须包含 `datasetVersionSetId` 与 `productVersionIds`。
- Neo4j 中每个组织/set 必须存在 `GraphProjection(status='complete')` 才允许 Evidence 查询。
- `GRAPH_PROJECTION_NOT_READY` 表示投影未完成，不等于业务无关系数据。
- `PROPERTY_GRAPH_REFERENCE_MISSING` 表示 canonical project/charge-item 引用不完整，必须修数据产品根因。
- `GRAPH_SYNC_BATCH_PRODUCT_VERSION_INVALID` 表示构图批次混入目标 set 之外的产品版本。
- Neo4j transaction 回滚不得标成 partial；只有已经完成过其他 organization child 的 parent 才可标记 partial。

## 故障处理顺序

1. 查 bootstrap/status 或组织 status，记录 run ID、set ID、产品版本、error code 与 correlation ID。
2. 在 PostgreSQL 核对 set 为 frozen、六个 Property product version 均为 published，且 canonical facts
   引用完整。
3. 查 Neo4j health、目标 `GraphProjection` manifest，以及节点/边的 organization/set/product version。
4. 修复根因后，对失败的同一个 `datasetVersionSetId` 重跑，不能直接写 Cypher 伪造 manifest。
5. 新版本已发布也不能替代失败的历史 set；历史 execution 必须继续读取原 set。

历史 `graph_sync_cursors`、`graph_sync_dirty_scopes` 是旧迁移遗留，不应手工修改，也不参与当前恢复。

## 验证

```bash
mise exec java@temurin-21.0.12+8.0.LTS -- mvn -B -ntp -f backend-java/pom.xml test
docker compose -f compose.prod.yaml --env-file .env.prod config --quiet
```

Java 门禁至少覆盖：canonical builder、产品版本校验、组织/set 隔离、同 set cleanup、projection ready、
指定历史 set 重放，以及 Evidence 不跨 set 读取。
