# Java Graph Sync 运行与恢复 Runbook

## 唯一运行边界

Graph Sync 的业务实现只在 Java backend 中运行。生产增量扫描由 Spring `@Scheduled` 执行；Next.js
仅透明代理受 Cookie 认证保护的 Java 管理 API。旧 TypeScript CLI 与 `graph:sync:*` package scripts 已删除，
禁止直接绕过 Java 的权限、事务、游标和 run/dirty-scope 状态机写 Neo4j。

生产必须显式配置：

```env
JAVA_GRAPH_SYNC_ENABLED=true
JAVA_GRAPH_SYNC_POLL_DELAY=5m
JAVA_GRAPH_SYNC_SOURCES=erp.organizations,erp.projects,erp.owners,erp.charge_items,erp.receivables,erp.payments,erp.service_orders
GRAPH_SYNC_OPS_SECRET=replace-with-a-long-random-secret
```

本地开发默认关闭调度，只有需要验证真实 ERP → Neo4j 链路时才启用。

## 管理 API

以下 API 需要已登录且服务端确认的 `PLATFORM_ADMIN`；组织操作只能作用于 session 的
`organizationId`，不得用客户端传入角色或组织绕过范围：

- `GET /api/admin/graph-sync/status`：查看当前组织相关 run、cursor、backlog 与最近失败。
- `GET /api/admin/graph-sync/organizations/{organizationId}/status`：查看组织最近一次 run。
- `POST /api/admin/graph-sync/organizations/{organizationId}/rebuild`：同步重建一个组织，成功返回终态 run。
- `POST /api/admin/graph-sync/consistency-sweep`：对当前组织执行一致性重建。

运营人员从同源 Web 管理入口调用这些路由；Next 会原样透传 Cookie、correlation ID、状态码与响应体。
不要从公网直接暴露 Java 容器端口。

### Full bootstrap system API

首次入图或灾后全量重建使用 Java system API，不经 Next，也不接受 Cookie：

```bash
docker compose -f compose.prod.yaml --env-file .env.prod exec -T backend \
  sh -lc 'curl --fail --silent --request POST --header "X-Graph-Sync-Ops-Secret: ${GRAPH_SYNC_OPS_SECRET}" http://127.0.0.1:8080/api/system/graph-sync/bootstrap'

docker compose -f compose.prod.yaml --env-file .env.prod exec -T backend \
  sh -lc 'curl --fail --silent --header "X-Graph-Sync-Ops-Secret: ${GRAPH_SYNC_OPS_SECRET}" http://127.0.0.1:8080/api/system/graph-sync/bootstrap/status'
```

bootstrap 同步返回终态 `full-bootstrap` parent run；其 `cursorSnapshot` 固定包含七类 source watermark、
correlation ID 与 fencing token。任一源记录缺少 scope/time/pk 或任一组织重建失败时 parent 失败，七个
cursor 均不推进。修复根因后再次触发；不要直接修改 run 或 cursor。

## 状态与失败语义

- PostgreSQL 的 `platform.graph_sync_runs`、`graph_sync_cursors`、`graph_sync_dirty_scopes` 是事实源。
- Neo4j 只是带 `scope_org_id`、`last_seen_run_id` 的可重建投影。
- 来源全部 dirty scope 成功后才推进 cursor；任何范围失败都保留 error code/detail，不能报告完成。
- 同组织与同来源通过 PostgreSQL 锁/active run 串行化；重复 rebuild 必须幂等，不得影响其他组织。
- `failed` 与崩溃遗留的 `processing` scope 必须由 Java 恢复路径重新进入明确终态；不能手工改 cursor。
- 状态为 `partial` 仅表示有证据证明外部系统已部分提交；原子 Neo4j transaction 回滚不得标成 partial。

## 故障处理顺序

1. 查 `/api/admin/graph-sync/status`，记录 `run.id`、`scopeKey`、error code 和 correlation ID。
2. 查 PostgreSQL 三张事实表，确认 run、dirty scope 与 cursor 是否一致；不要先改状态。
3. 查 ERP source row 的 organizationId、变更时间与主键；缺 scope/time 必须修源数据，系统会 fail loud。
4. 查 Neo4j health 与目标组织 `scope_org_id` 投影，确认是否为连接/事务问题。
5. 根因修复后，使用组织 rebuild API 重跑；全局 incremental 只允许系统 scheduler 执行，禁止直接调用旧脚本或手写 Cypher 补数据。
6. 发布前运行 `scripts/preflight-java-cutover.sql`；存在 active/stale/duplicate Graph Sync 事实时停止切换。

## 验证

```powershell
mise exec java@temurin-21.0.12+8.0.LTS --% -- mvn -B -ntp -f backend-java/pom.xml test
docker compose -f compose.prod.yaml --env-file .env.prod config --quiet
```

Java 测试必须包含 PostgreSQL Testcontainers 的 run/cursor/dirty-scope 状态机，以及 Neo4j
Testcontainers 的重复 replace、组织内 cleanup、跨组织隔离和失败事务回滚。没有真实模型凭据不会影响
Graph Sync 测试；模型 live gate 是独立的 `verify -Plive-integration`。
