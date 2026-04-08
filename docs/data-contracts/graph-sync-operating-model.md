# Neo4j 图谱同步运行方案

## 目标

本文档定义 `PG -> Neo4j` 的正式交付与运行模型，覆盖：

- 首次全量基线重建
- 后续增量同步
- 脏范围识别与幂等重建
- 同步运行记录、游标与失败恢复
- CI/CD 与运行期调度边界

本文档是 [graph-sync-baseline.md](/Users/delldi/work-code/open-code/ontology-agent/docs/data-contracts/graph-sync-baseline.md) 的运行时补充。前者定义“同步什么”，本文档定义“怎么持续同步、怎么运营交付”。

## 设计原则

- 不把图谱同步设计成“每条 ERP 记录直接推一条边”的逐条 CDC patch。
- 先以“范围重建”作为主模式，保证正确性、幂等性和可恢复性。
- 首次全量和后续增量共用同一套 baseline builder 与 Neo4j upsert 路径。
- 运行期同步是独立 job，不和每次应用部署强绑定。
- 增量阶段优先按 `organizationId` 重建，稳定后再考虑 `projectId` 级重建。

## 当前实现基线

当前仓库已经具备以下能力：

- 组织级 baseline 读取与建图：
  - [graph sync use cases](/Users/delldi/work-code/open-code/ontology-agent/src/application/graph-sync/use-cases.ts)
  - [PG ERP read repository](/Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/erp/postgres-erp-read-repository.ts)
- Neo4j 幂等写入：
  - [graph adapter](/Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/neo4j/neo4j-graph-adapter.ts)
  - [graph sync cypher](/Users/delldi/work-code/open-code/ontology-agent/src/infrastructure/sync/neo4j-graph-sync.ts)
- 基线同步入口：
  - [sync-neo4j-baseline.mts](/Users/delldi/work-code/open-code/ontology-agent/scripts/sync-neo4j-baseline.mts)

这意味着系统已经具备“组织级 baseline rebuild”的核心能力，下一步不应改成另一套同步体系，而应在此基础上补运行管理层。

## 总体方案

建议同步模式分为 3 类：

| 模式 | 用途 | 最小作用域 |
|---|---|---|
| `full-bootstrap` | 新环境首次入图或灾后重建 | 全部组织 |
| `org-rebuild` | 指定组织校正、手工重建、增量执行单元 | `organizationId` |
| `incremental-rebuild` | 定时识别增量后派发重建 | `organizationId` |

推荐路线：

1. 首次全量：按 `organizationId` 分片跑 `org-rebuild`
2. 后续增量：按 watermark 识别脏组织，进入 dirty queue
3. dirty queue 消费：逐个执行 `org-rebuild`
4. 每日或每周补一轮一致性 sweep，防止源端漏标

## 为什么不直接做逐条 CDC

当前图谱是由以下多源拼装出来的派生结果：

- 组织
- 项目
- 业主
- 收费项
- 应收
- 实收
- 工单
- 投诉
- 满意度

逐条 CDC 会立刻遇到这些问题：

- 项目归属变更时，旧组织下的边如何批量撤销
- 收费项重命名时，哪些项目上的边要重写
- 应收/实收删除时，旧边如何精确删除
- 一个项目相关事实横跨多表，单表事件不足以恢复完整图状态

因此 v1 更适合采用：

- 用 CDC/时间游标“发现脏范围”
- 用 baseline rebuild“修复脏范围”

这比直接 patch 图边更稳，也更容易运维。

## 元数据表设计

建议新增 3 张平台表。

### `platform.graph_sync_runs`

用途：记录每次同步运行。

建议字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | 主键 |
| `mode` | text | `full-bootstrap / org-rebuild / incremental-rebuild` |
| `status` | text | `pending / running / completed / failed / partial` |
| `scope_type` | text | `all / organization` |
| `scope_key` | text | 例如 `all` 或 `organization:2857` |
| `trigger_type` | text | `manual / scheduler / deployment / recovery` |
| `triggered_by` | text | 操作人或系统标识 |
| `cursor_snapshot` | jsonb | 本次 run 起始时各 source 的 watermark 快照 |
| `nodes_written` | integer | 写入节点数 |
| `edges_written` | integer | 写入边数 |
| `started_at` | timestamptz | 开始时间 |
| `finished_at` | timestamptz | 结束时间 |
| `error_summary` | text | 失败摘要 |
| `error_detail` | jsonb | 详细错误 |

### `platform.graph_sync_cursors`

用途：记录每个 source 的增量游标。

建议字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `source_name` | text pk | 源表或 source 名 |
| `cursor_time` | timestamptz nullable | 时间游标 |
| `cursor_pk` | text nullable | 同时刻 tie-break 主键 |
| `last_run_id` | uuid | 最近成功推进的 run |
| `updated_at` | timestamptz | 更新时间 |

建议 source name：

- `erp.organizations`
- `erp.projects`
- `erp.owners`
- `erp.charge_items`
- `erp.receivables`
- `erp.payments`
- `erp.service_orders`

### `platform.graph_sync_dirty_scopes`

用途：记录待重建范围。

建议字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | 主键 |
| `scope_type` | text | `organization` |
| `scope_key` | text | 例如 `2857` |
| `reason` | text | `receivables-changed` 等 |
| `source_name` | text | 来源 source |
| `source_pk` | text nullable | 触发记录主键 |
| `first_detected_at` | timestamptz | 首次发现时间 |
| `last_detected_at` | timestamptz | 最近发现时间 |
| `status` | text | `pending / processing / completed / failed` |
| `attempt_count` | integer | 重试次数 |
| `last_run_id` | uuid nullable | 最近一次处理 run |

唯一键建议：

- `(scope_type, scope_key, status='pending')` 语义去重

## 图谱节点与边的运行元数据

Neo4j 写入时建议为所有节点/边补如下属性：

| 属性 | 说明 |
|---|---|
| `scope_org_id` | 该节点/边归属的组织重建范围 |
| `last_seen_run_id` | 最近一次被哪次同步看见 |
| `last_seen_at` | 最近一次被写入时间 |
| `source` | `erp-master-data / erp-derived / governed-rule` |
| `source_table` | 来源表名 |
| `source_pk` | 来源主键或复合键 |

这些属性的作用：

- 组织级 stale 数据清理
- 差异审计
- 失败排查
- 回放定位

## 首次全量方案

### 触发方式

- 新环境初始化
- Neo4j 重建后
- 大版本数据模型变更后

### 执行流程

1. 创建 `graph_sync_runs` 记录，模式为 `full-bootstrap`
2. 读取所有 source 的当前 watermark，写入 `cursor_snapshot`
3. 枚举全部有效 `organizationId`
4. 对每个组织创建子 run 或组织级 run
5. 对每个组织执行一次 `org-rebuild`

### `org-rebuild` 逻辑

1. 从 PG 读取该组织范围内的组织、项目、业主、收费项、应收、实收、工单
2. 从 scoped 事实中回补项目/收费项缺口
3. 构建图批次
4. Neo4j 先确保 `GraphNode(kind,id)` 唯一约束存在
5. 分批写节点
6. 分批写边
7. 所有节点/边打上 `scope_org_id`、`last_seen_run_id`、`last_seen_at`
8. 清理该组织下未在本次 run 出现的旧节点/旧边
9. 更新 run 统计

### 清理策略

推荐采用“last seen + scoped cleanup”：

- 当前组织范围下，`last_seen_run_id != current_run_id` 的节点/边视为 stale
- 只清理 `scope_org_id = 当前组织` 的数据
- 不跨组织删除

这能覆盖：

- 源端删除
- 项目迁移
- 边失效

## 后续增量方案

### v1 建议

以 `organizationId` 作为增量最小单元，不先做 `projectId` 级增量。

原因：

- 当前 baseline builder 天然就是组织维度
- 运维和失败恢复简单
- 删除和迁移更容易正确处理

### 增量执行流程

1. Scheduler 读取 `graph_sync_cursors`
2. 每张源表按 watermark 查询变更记录
3. 从变更记录里提取受影响的 `organizationId`
4. 写入 `graph_sync_dirty_scopes`
5. Dirty scope worker 消费 pending 记录
6. 对每个 dirty organization 执行一次 `org-rebuild`
7. 全部成功后推进 `graph_sync_cursors`

### 脏范围识别策略

按 source 表抽组织范围：

| source | 组织提取方式 |
|---|---|
| `organizations` | `source_id` 或 path 自身 |
| `projects` | 优先使用 `org_id`；`organization_id` 仅在确认与组织主表 `source_id` 对齐时可用 |
| `owners` | `org_id` |
| `charge_items` | `organization_id`，若为空不直接派发 |
| `receivables` | `organization_id` |
| `payments` | `organization_id` |
| `service_orders` | `organization_id` |

注意：

- `charge_items` 不能单独决定同步范围，因为实际存在跨组织复用口径
- 若 `charge_items.organization_id` 为空，可等待其被 `receivables/payments` 事实重建时带出

## watermark 方案

推荐采用“时间戳 + 主键”复合游标，避免同一秒多条变更丢失。

统一条件：

- `updated_at > cursor_time`
- 或 `updated_at = cursor_time and pk > cursor_pk`

建议表级优先字段：

| 表 | watermark 候选 |
|---|---|
| `dw_datacenter_system_organization` | `update_time`, `source_id` |
| `dw_datacenter_precinct` | `update_date`, `precinct_id` |
| `dw_datacenter_owner` | `update_date`, `record_id` |
| `dw_datacenter_chargeitem` | `update_date`, `charge_item_id` |
| `dw_datacenter_charge` | `update_date`, `record_id` |
| `dw_datacenter_bill` | `operator_date`, `record_id` |
| `dw_datacenter_services` | `update_date_time`, `services_no` |

如果某表时间字段质量差：

- 允许退化成主键窗口扫描
- 但应在 `graph_sync_runs.error_detail` 中明确记录该 source 的降级路径

## 调度建议

建议拆成 3 类 job。

### 1. `graph-sync-incremental`

- 频率：每 5 分钟或 15 分钟
- 作用：扫描 watermark，写 dirty scopes

### 2. `graph-sync-dispatch`

- 频率：常驻 worker 或每分钟
- 作用：消费 dirty scope，执行 `org-rebuild`

### 3. `graph-sync-consistency-sweep`

- 频率：每日凌晨或每周
- 作用：对关键组织做一致性巡检或补偿重建

## CI/CD 边界

CI/CD 负责的是“交付同步程序”，不是“每次发版都执行数据同步”。

### CI

- lint
- typecheck
- graph sync use case tests
- Neo4j smoke tests
- real regression light checks

### CD

- 部署 web
- 部署 worker
- 部署 graph sync job runner
- 部署 scheduler

### 运行期

- 定时调度增量
- 手工触发 baseline / org rebuild
- 保留 nightly consistency sweep

## 手工与运维入口

建议统一为 3 类入口：

- `graph:sync:bootstrap`
- `graph:sync:org --organizationIds=...`
- `graph:sync:incremental`

当前仓库已具备：

- [graph:sync:neo4j](/Users/delldi/work-code/open-code/ontology-agent/package.json)

后续建议在此基础上拆分命令语义，而不是另起一套脚本体系。

## 失败恢复策略

- 单组织失败不回滚全局 run
- `graph_sync_runs` 标记 `partial` 或 `failed`
- `graph_sync_dirty_scopes` 保持 `failed`，等待重试
- cursor 只在对应 source 范围全部成功后推进
- 对同一组织支持手工重试

重试建议：

- 指数退避
- 同一组织最大重试次数可配置
- 超过阈值后转人工处理

## 推荐实现顺序

### Phase 1

- 新增 `graph_sync_runs`
- 新增 `graph_sync_cursors`
- 新增 `graph_sync_dirty_scopes`
- 把当前 baseline 脚本接上 run 记录

### Phase 2

- 实现 watermark 扫描器
- 先做组织级 dirty scope 派发
- 实现 `incremental-rebuild`

### Phase 3

- 节点/边补 `last_seen_run_id`、`scope_org_id`
- 加入 stale cleanup

### Phase 4

- consistency sweep
- 失败补偿
- project 级重建优化

## 当前推荐决策

当前最推荐的正式方案是：

- 首次全量：按组织分片 baseline rebuild
- 后续增量：watermark 识别脏组织后执行 scoped rebuild
- 调度：定时任务 + dirty queue
- CI/CD：部署同步程序，不直接承担同步执行

这条路线最符合当前代码现状，也最容易稳定交付。
