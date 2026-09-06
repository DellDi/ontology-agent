# 统一 Ontology 数据底座实施计划

> 状态：执行中。P0 已完成 EasyV 源表事实审计；P1 已建立两阶段控制面 schema、通用 Java 契约、
> 静态引用校验与 PostgreSQL 状态机/持久化适配器；P2 已完成通用 PostgreSQL Connector、
> `row-pack-v1`、Source Ingestion 与 Product Materializer（源快照先落本地 spool，关闭后才写平台库）。
> P3 的 EasyV Domain Pack、typed transform 和 canonical reader 已完成源码、开发测试与真实 EasyV
> 全量/增量 gate；P4 的 runtime reader、execution dataset binding、部署级 source 隔离和真实 LLM/PG
> 联合门禁已完成。`easyv-dev` 的 EasyV-only Compose 演示切片已部署，当前主待办转为 P5 Property
> 复用、删除/历史口径冻结和完整 Property 基础设施接入。本文是
> `ontology-agent` 从“领域运行时可扩展”进入
> “数据产品与本体实例可扩展”的实施基线。
> 当前目标是内部演示与长期演进，不以 Kubernetes 为前提；最终部署节点为 `easyv-dev`，平台 PostgreSQL
> 使用共享开发实例中的独立数据库。

## 1. 目标

建立一套平台级、领域无关的数据接入与 Ontology 数据产品内核：

1. 平台统一处理 Source Connector、全量/增量同步、cursor、run、错误、版本与 lineage；
2. Domain Pack 只声明数据源、数据集、字段映射、对象/关系/指标映射和必要的领域规则；
3. Agent 主流程只读取平台拥有的 canonical data product，不在执行时查询业务源库；
4. execution 同时冻结 Ontology Version 与 Dataset Version，使历史 evidence 可复核；
5. Cube 读取 canonical analytical facts，Neo4j 只保存可重建关系投影；
6. 使用 EasyV 作为第一个真实 Domain Data Pack 验证内核，再让 Property 复用；
7. 在 `easyv-dev` 形成非 Kubernetes、可重复发布和可诊断的内部演示环境。

## 2. 非目标

- 不把所有领域数据压入单一 EAV 表或无约束 JSONB；
- 不让 LLM 生成 SQL、选择源表、决定权限范围或推进同步 cursor；
- 不在平台内核出现 EasyV、Property、Forge、收缴率等领域常量；
- 不为了“热加载”执行任意脚本、任意 SQL 或未审核 Java 字节码；
- 不写入 EasyV、ERP 等来源业务库；
- 不在本阶段实现 Kubernetes、分布式流平台或通用低代码 ETL 产品。

## 3. 当前事实与偏差

### 3.1 已具备

- `CapabilityRegistry` 已按 `domainKey/capabilityKey` 注册能力并冻结 Ontology 与 scope binding；
- PostgreSQL 已保存 Session、Job、Execution、Ontology Governance、Audit 与 Graph Sync 事实；
- Property 已有 PostgreSQL staging、Cube 查询和 Neo4j 全量/增量投影；
- EasyV 已有一个真实只读 capability，并通过真实 PostgreSQL 与 LLM 联合门禁；
- Flyway 使用独立 `migrate` profile，应用常规启动不自动迁移。

### 3.2 偏差

- EasyV source 仍通过独立 DataSource 由一次性 ingestion connector 读取；runtime 通过
  `EasyVCanonicalFactAdapter` 读取平台 canonical facts，`easyv-dev` backend 已验证不持有 source URL、
  用户名或密码；
- Source/Dataset/Data Product 定义、ingestion run、cursor、批次和 dataset version 已进入平台控制面；
- execution 已保存并校验 `DatasetVersionSet` binding，真实 LLM/source/canonical/runtime 联合门禁已通过；
- Graph Sync 的 cursor 只表示 staging 到 Neo4j 的进度，不能复用为来源 ingestion cursor；
- `compose.prod.yaml` 强制启动本地 PostgreSQL，且没有注入 EasyV 数据源配置，不适合共享 PG 演示部署。

### 3.3 P0 真实源库审计（2026-09-04）

已从 `easyv-dev` 到当前开发 PostgreSQL 完成只读协议、权限和元数据核验；未读取敏感正文、未执行 DML：

- `easyv` 与 `ontology_agent_test` 位于同一 PostgreSQL 服务的两个独立数据库，服务器到二者均可登录和查询；
- 当前 EasyV 账号对五张候选表同时有读写和高权限，只能作为开发验证账号，正式 ingestion 必须使用独立只读角色；
- `ai_screen_app`：物理主键 `id`、业务唯一键 `app_id`，有 `update_time` 与 `is_delete`，可定义
  watermark 和软删除，但当前运行时聚合没有过滤 `is_delete`，切换前必须冻结 active/history 口径；
- `ai_screen_prototype`：物理主键 `id`、`app_id` 唯一且级联引用 Application，有 `update_time`、无删除字段；
- `ai_pipeline_node_record`：物理主键 `id`，一个 `task_id` 对应多行，只有 `create_time`；数据库统计存在历史
  update/delete，不能把它声明为天然 append-only；
- `generation_tasks`：物理主键 UUID `id`、业务唯一键 `task_id`，有 `update_time`、无删除字段；
- `dt_ai_operation_log`：物理主键 `id`，只有 `operate_time`；数据库统计存在历史 update，不能只用插入游标；
- Application 的 `generation_task_id` 与 Pipeline Node 的 `task_id` 是一条真实关系；Forge `generation_tasks.task_id`
  与它当前无匹配，Forge 任务必须建成另一对象类型并通过 `app_id` 关联，不能合并两类 task identity；
- 当前目标库只有 `platform`、`erp_staging` 与 `public`，尚无 ingestion、EasyV staging、canonical facts 或
  dataset version；
- 当前 live cohort 可作为切换 golden sample：3 个 Application、3 个 Prototype、51 个 Pipeline Node、5 条
  Forge Task、4 条 Feedback。此数字仅属于本次开发环境快照。

由此确认：同步策略必须是 dataset-level policy。Application 可用 watermark + tombstone；Prototype 与 Forge
至少需要周期性 snapshot reconciliation；Pipeline Node 与 Feedback 在获得可靠 source change contract 前不得
宣称 watermark incremental 完整，可先使用小数据量 full snapshot + row-hash/key diff，并把 CDC/source
`updated_at` 作为退出该临时策略的条件。

## 4. 目标职责模型

```text
External Source Systems
        │
        ▼
SourceConnector                       platform infrastructure
        │
        ▼
SourceIngestionOrchestrator           platform application
        ├── full snapshot
        ├── incremental cursor
        ├── contract validation
        └── source run / error
        │
        ▼
Immutable Source Dataset Versions     PostgreSQL governed staging
        │
        ▼
ProductMaterializer                   platform application + trusted transform
        │
        ▼
Canonical Data Product Versions       PostgreSQL typed tables
        │
        ├── Dataset Version Set ────── execution/evidence binding
        ├── Ontology Mapping ───────── object/property/link
        ├── Cube ───────────────────── governed metrics
        └── Neo4j ──────────────────── rebuildable projection
        │
        ▼
Capability Registry / Agent Runtime
```

## 5. 平台与领域边界

### 5.1 平台只实现一次

- `SourceConnector`：按技术协议读取受约束数据页；
- `SourceConnectorRegistry`：按 connector type 选择 PostgreSQL/MySQL/HTTP 等实现；
- `DataProductRegistration`：注册领域声明，不执行领域判断；
- `SourceIngestionOrchestrator`：一次受控 source snapshot 读取多个 source dataset；
- `ProductMaterializer`：只消费已发布 source dataset version，产出单一 canonical relation；
- `IngestionRunRepository`：分别保存 source ingestion 与 product materialization 的运行、错误、计数与时间；
- `IngestionCursorRepository`：在 source dataset version 成功发布后推进 dataset cursor；
- `DatasetVersionRepository`：分别发布不可变 source dataset version 与 canonical product version；
- `CanonicalDatasetWriter`：在事务内执行 staging 到 canonical 的受治理写入；
- `OntologyMappingRepository`：保存 data product 与 Object/Property/Link 的版本化映射。

定义与连接器的加载方式必须分开：Source/Dataset/Data Product/Mapping 是可发布、可版本化的数据定义；
Connector 与复杂 Transform 是受信任代码注册。不得为了动态领域接入而允许数据库中保存任意 SQL、脚本或
LLM 生成逻辑。

### 5.2 Domain Pack 必须提供

- `domainKey` 与稳定 business key 前缀；
- source/dataset/data-product 定义；
- 主键、watermark、删除语义和 freshness；
- source field 到 canonical field 的映射；
- Object Type、Property、Link、Metric 映射；
- scope 解析和行级权限规则；
- 无法由安全映射表达式描述的定制 transform；
- capability 的确定性 workflow、evidence 与 claim 规则。

### 5.3 冷热加载边界

- 使用既有 Connector、字段映射、指标表达式和只读 capability 时，发布新 Domain Data Pack 后由新 execution
  加载新版本；旧 execution 保留原 binding；
- 新协议 Connector、复杂 Java transform、授权解析器或写 Action 需要构建和重启；
- 任何热加载定义必须先经过 schema、引用、权限、主键、类型和循环依赖校验。

## 6. PostgreSQL 所有权

共享 PostgreSQL 只提供物理资源；`ontology_agent_test` 是平台唯一拥有的数据库：

```text
ontology_agent_test
├── platform          Session/Job/Execution/Ontology/Audit/Graph Sync
├── ingestion         source/run/cursor/dataset version/lineage
├── easyv_staging     EasyV 受约束原始落地
├── erp_staging       Property 受约束原始落地（现有）
└── facts             强类型 canonical analytical facts
```

来源数据库只由 ingestion 运行角色读取。Backend/Worker 的正常分析路径只连接 `ontology_agent_test`。
Flyway 只修改平台数据库；来源 schema 的变化由 contract validation 发现并阻断同步。

## 7. 最小数据契约

### 7.1 平台元数据

- `ingestion.source_definitions`：source key、connector type、connection ref、状态；
- `ingestion.dataset_definitions`：domain、source、schema version、主键、watermark、删除策略；
- `ingestion.data_product_definitions`：canonical table、映射版本、freshness policy；
- `ingestion.data_product_inputs`：data product 与 source dataset 的多对多输入；
- `ingestion.source_ingestion_runs`：一次 source snapshot 的 mode、status、context、row counts、error 与时间；
- `ingestion.source_dataset_versions`：同一 source run 发布的一个或多个不可变 source dataset version；
- `ingestion.dataset_cursors`：每个 source dataset 唯一的已提交 cursor，只在 source version 发布事务中推进；
- `ingestion.product_materialization_runs`：canonical product 构建运行；
- `ingestion.data_product_versions`：一 product 一 canonical relation 的不可变版本；
- `ingestion.data_product_version_lineage`：product input 到实际 source dataset version 的边；
- `ingestion.dataset_version_sets` 与 `dataset_version_set_items`：持久化冻结多个 product version 的 manifest。

凭据不进入定义表，只保存服务端环境变量或 Secret 的引用名。

一个 capability 可能同时消费多个 data product，因此 execution 不绑定单一 `datasetVersionId`，而绑定：

```text
DatasetVersionSet
├── publicationId
├── productVersionIds { productKey -> datasetVersionId }
└── capturedAt
```

`DatasetVersionSet` 是一组已经发布的 product versions 组成的持久化 release manifest，可被多个 analysis
execution 绑定复用；它不是每次 analysis request 临时创建或冻结的记录。release pipeline 在一组 product
versions 完成 materialize 后创建/冻结该 manifest，分析提交只选择并保存已有的 frozen set（例如当前 latest），
不在请求路径中再次 freeze。Follow-up 与 retry 必须继承原集合，不能在执行中重新查询 latest；历史 execution
没有该集合时标记为不可完全复现，不伪造版本。

`capturedAt` 表示这组 canonical facts 的源数据观测截止时间，也是运行时选择 latest frozen set 和事实读取
时间语义的依据；`frozenAt` 只表示 manifest 完成冻结、可供执行绑定的发布/审计时间。因此 `latestFrozen`
在满足完整产品集合、产品均为 `published` 且 manifest 为 `frozen` 的候选中按 `capturedAt` 降序选择，
同一时间再按 `setId` 降序确定顺序。即使旧快照晚冻结，也不能覆盖较新观测时间的快照。

一次性 `ingest` profile 不携带任何领域默认值：调用方必须显式指定 `source-key` 和完整 `product-keys`。
EasyV、Property 等领域开关、source connection 与产品集合只由各自部署入口注入，新增领域不修改平台
runner。

### 7.2 EasyV canonical facts

第一批数据产品以当前真实能力的调用为准：

- `facts.easyv_ai_application`；
- `facts.easyv_prototype_task`；
- `facts.easyv_pipeline_node`；
- `facts.easyv_forge_generation_task`；
- `facts.easyv_generation_feedback`。

每行至少携带稳定主键、可信 scope、source key、source updatedAt、ingestedAt 和 dataset version。字段以真实
源表契约、现有聚合 SQL和脱敏边界审计后确定，不预先复制全部业务字段。

## 8. 同步状态机

### 8.1 Source full/incremental

1. 校验 source contract，并准备 source run 的审计字段；
2. 在打开来源 snapshot 前创建 `pending` run，写入明确的 `planned` snapshot context，并转为 `running`；
3. 打开一个强制 `read only`、`repeatable read` 和查询超时的 source snapshot，取得真实 context；
4. 在该 source snapshot 内连续、顺序读取本次符合 mode 的多个 dataset，只编码并写入受控本地 spool，
   不交错执行任何平台库写入；
5. 关闭 source snapshot 后记录真实 snapshot context，再 reserve source versions、读取 spool 并写入按
   dataset version 隔离的 staging batches；
6. 校验主键、scope、时间语义、删除语义、行数与重复，在目标事务内发布全部 source dataset versions；
7. 同事务推进对应 dataset cursors，并将 run 置为 `completed`；随后由 release 流程 materialize product
   versions 并冻结 `DatasetVersionSet`；
8. 任一步失败保留错误、清理 spool，且不发布 source/product 半成品、不推进 cursor。

### 8.2 Canonical materialization 与 publication

1. product run 只选择已发布的 source dataset versions；
2. 对单一 canonical relation 执行受信任 transform 与幂等 upsert/tombstone；
3. 同事务发布 data product version 与完整 input lineage，不触碰 source cursor；
4. release 流程将一组已发布 product versions 冻结到持久化 `DatasetVersionSet`；同一 frozen release 可被多个
   analysis executions 绑定复用，不能把每个请求都当作一次新的 freeze；
5. Agent、follow-up 与 retry 只使用已经绑定的 version set；新 analysis 请求最多选择已有 latest frozen
   release，不在请求路径中重新冻结；
6. 触发 Cube freshness 更新和 Neo4j dirty scope；定期 reconciliation 发现 watermark 无法识别的漂移。

## 9. 分阶段实施

### P0：事实审计与设计冻结

- [x] 核实 EasyV 五张源表的主键、更新时间、删除语义、关联键和索引；
- [ ] 核实目标库权限、容量和连接预算；
- [ ] 冻结平台/领域边界、表契约、包路径与失败码；
- [ ] 建立 source-indexed 测试矩阵。

验收：不存在假设字段；每个增量和删除策略都有真实来源证据。

### P1：通用数据接入控制面

- [x] Flyway 增量创建 `ingestion` 元数据表；
- [x] 建立领域无关的 registration、run、cursor、version、lineage 类型；
- [x] 建立多输入 data product 与 `DatasetVersionSet` 契约；
- [x] 建立 Registry 冲突、引用和版本校验；
- [x] PostgreSQL Testcontainers 覆盖状态迁移、失败不推进、幂等发布和并发锁。

P1 已冻结的关键语义：一个 source ingestion run 表示一次 source snapshot，可发布多个 source dataset versions；
cursor 归 source dataset 唯一所有，多个 product 只复用已发布 source versions；一个 materialization run 最多
发布一个单输出 product version；published product version 必须为每个 required input 保存 version-level lineage；
`DatasetVersionSet` 是持久化 manifest，只能冻结已经 published 的 product versions。
每个 source dataset version 同时冻结当次 committed cursor，因此旧 run 的幂等重放不依赖已经推进的
当前 cursor；source version 通过复合外键确保 dataset 与 run 属于同一 source。已发布 source/product
artifact、lineage 与 version-set item 有数据库级不可变保护；只允许 artifact 在不修改冻结内容时从
`published` 转为 `revoked`。

验收：测试用第二个最小 domain registration 时不修改内核代码。

### P2：通用 PostgreSQL Connector 与编排

- [x] PostgreSQL 只读 Connector 与同源多 dataset snapshot；
- [x] Source Full/Incremental orchestrator 与 Product Materializer；
- [x] batch isolation、target transaction 和 checkpoint 原子性；
- [x] 查询超时、错误上下文及 run 行数/耗时/失败审计；
- [x] 不允许动态任意 SQL或源库 DML。

P2 的 durable staging 使用固定 `row-pack-v1` codec 将按 `columnContract` 顺序和类型编码的批次保存为
PostgreSQL `bytea`；它是可版本化的 source artifact，不是 EAV、动态 JSON 行表或 canonical facts。每个
dataset 先预留 `building` source version，然后分页写 batch，最后在同一目标库事务中校验行数/hash、
发布全部 version、推进 cursor 并完成 run。领域强类型数据只在 Product Materializer 后进入 `facts`。
P2 明确不实现 CDC/logical replication；当前没有 LSN、slot 与变更日志契约，不得伪装支持。

已实现语义：`FULL`/`RECONCILE` 忽略旧 cursor 并读取全部 active dataset；`INCREMENTAL` 在同一 source
中只选择声明为 `WATERMARK` 的 dataset，`SNAPSHOT` dataset 由后续 reconciliation 更新。PostgreSQL
watermark 使用 `(watermark, primary-key tie breaker)` keyset，时间、UUID 与数值 cursor 在持久化前规范化为
稳定 JSON 类型。run 的 `snapshot_context` 与本次所有 source version 的 `source_watermark` 保存同一
`txid_current_snapshot` 和观测时间。

`ProductMaterializer` 只读取已发布且经过 batch hash、连续序号、row count 与 schema fingerprint 复核的
source version。`INCREMENTAL` source version 只保存 delta，并显式引用本次 source snapshot 实际使用的
已发布 parent；reservation 在 source 锁内再次比对当前 cursor，避免“按旧 cursor 读取、却挂到新 parent”或
cursor 倒退。物化时按 `FULL/RECONCILE root -> incremental head` 逐级以主键覆盖，得到完整 effective
snapshot；零行增量保持 parent 状态，周期性 `RECONCILE` 以新的完整 root 截断旧链。仍被 cursor、子版本或
product lineage 引用的 source version 不允许 revoke，保证历史版本可重放。

领域 transform 是公开、受信任的 Java SPI，不从数据库执行脚本或动态 SQL；其 canonical write 与
product version、完整 input lineage、run completed 在同一个目标库事务中提交。该原子性要求 transform 使用
平台主 DataSource/TransactionManager，Domain Pack 不得自建 canonical 连接池。

Testcontainers 已使用独立 source/target PostgreSQL 验证多 dataset full、watermark incremental、同水位
tie breaker、真实 `jsonb`、多页 batch、第二 dataset 失败不推进 cursor、使用新 run 恢复，以及只读来源事务；
另验证 typed canonical write、软删除标记、lineage 发布与 canonical/publication 同事务回滚。

验收：Testcontainers 中完成 full、incremental、失败恢复和 tombstone；源库无写入。

### P3：EasyV Domain Data Pack（真实链路已通过，口径冻结待办）

- [x] 注册五个 EasyV source dataset 与 canonical product；
- [x] 实现当前能力所需字段清洗、强类型 facts、typed canonical transform 和 version-level lineage；
- [x] 使用 `EasyVCanonicalFactAdapter` 读取 execution-pinned canonical facts，并覆盖 scope、freshness、
  coverage 和失败语义的开发测试；
- [x] 在 `easyv-dev` 对真实开发源库执行 full 与零变更 incremental，源行数前后保持
  493 / 414 / 10,223 / 476 / 1,844；增量发布产生完整 v2 product versions，而非清空 facts；
- [ ] 人工核对 canonical 聚合和现有 golden query；
- [x] 已实现当前明确的敏感字段边界（例如失败原因只保存 hash），但不扩展未审计字段；
- [ ] 冻结 `is_delete`/`is_deleted` 的 active、tombstone、history 过滤与保留口径；该删除/历史语义仍未决，
  本阶段不擅自改变 runtime 行为。

验收尚未完成：真实 source gate、canonical 行数、批次、版本和 lineage 已有证据；人工 golden query
和删除/历史口径仍待确认。

### P4：Agent Runtime 切换（EasyV 联合门禁已完成）

- [x] EasyV capability 改读平台 `facts`，运行时入口为 `EasyVCanonicalFactAdapter`；
- [x] source credential 只出现在 ingestion source connector 配置边界，canonical runtime 不直连来源表；
- [x] Job/Execution/Snapshot/Evidence metadata 保存并校验 `DatasetVersionSet` binding；
- [x] Follow-up 与 retry 继承原 dataset binding；
- [x] 已删除旧 runtime source-reader 引用并切换到 `EasyVCanonicalFactAdapter`；剩余的
  EasyV PostgreSQL 配置只承担 ingestion source connection；
- [x] 在 `easyv-dev` 部署中阻断 Backend 到 EasyV 源库的非 ingestion 访问，并完成完整 Java、Web contract、
  真实 LLM/PG 联合门禁；
- [ ] 确认生产权限、审计链、历史 evidence 复核与重启恢复。

`LiveEasyVProviderIT` 已在 `easyv-dev` 使用真实 Provider、真实源库和共享平台库通过，持久化 execution 为
`completed`，绑定 frozen Dataset Version Set，并记录一次 EasyV tool invocation。完整 Java 374 tests、Web
50 tests 和 TypeScript 检查通过。生产只读 source role 与删除/历史语义仍未冻结，因此权限验收项保留。

### P5：Property 复用验证（本地代码与集成门禁已完成，真实环境待发布）

- [x] 将受控 `erp_staging` 快照到 `facts` 的发布纳入通用 ingestion run/cursor/version/lineage 控制面；
- [ ] 将外部 ERP 到 `erp_staging` 的 source connector、watermark、删除与历史保留契约纳入同一控制面；
- [x] 保持现有 Property 指标、scope 和结果契约不变；
- [x] Graph Sync 改从 frozen canonical product versions 构建并隔离领域投影；
- [x] Cube 只读取 canonical facts，并按同一 frozen set 约束产品版本；
- [x] Property 只实现领域 source/transform/reader/projection adapter，不复制 EasyV 专属 service/repository。

本地代码已经证明 Property 可复用共享 control plane：六个 canonical products、typed transform、Cube reader
和 Neo4j projection 均绑定同一 frozen set。下一门禁是在 `easyv-dev` 执行 V10、真实 Property ingestion、
Cube/Neo4j rebuild 与跨领域 smoke。外部 ERP 到现有 staging 的 source contract、最小权限、删除和历史保留
仍需基于真实接口/表变更语义冻结，当前不把既有 staging 误称为已完成的外部 source ingestion。

验收：Property 与 EasyV 共享 run/cursor/version/lineage 内核，领域 source 和 transform 保持隔离。

### P6：`easyv-dev` 内部演示部署（EasyV-only 切片已运行）

- [x] 新增共享外部 PG 的 `compose.easyv-dev.yaml`，不启动本地 PostgreSQL；
- [x] Backend、ingestion、migrate 使用同一 Java 镜像和不同运行角色；
- [x] Valkey 在服务器容器运行，任务事实仍由 PostgreSQL 持有；
- [ ] Cube/Cube Store、Neo4j 随 P5 Property canonical 化后接入完整演示，不伪装成 EasyV 依赖；
- [x] 限制 source 连接池、固定端口和 Compose project name；
- [x] `scripts/easyv-dev` 统一 build/config/migrate/deploy/health/ingest/status/logs/release；
- [ ] Property bootstrap 和跨领域 smoke 在 P5 完成后加入同一入口；
- [x] 真实 EasyV 问数、重启恢复、日志和失败诊断验收。

2026-09-06 已在指定 `easyv-dev` 验证：Flyway v9 no-op、真实 full/incremental ingestion、EasyV health group、
Web/Backend/Valkey 容器健康、真实 LLM 问数、backend 无 source credentials，以及 backend/web 重启恢复。
镜像保存 Git revision OCI label；当前验证构建明确标为 `5889b09-dirty`，不是伪装成干净 commit。
剩余部署工作属于 P5 Property 的 Cube/Neo4j/bootstrap/cross-domain smoke。

验收：指定 Git commit 可重复发布；服务器重启后自动恢复；部署版本、数据版本、Ontology 版本和 execution
可以通过审计链关联。

## 10. 总体验收标准

1. 新增一个使用既有 PostgreSQL Connector、标准字段映射和标准 cursor 的领域时，不修改 ingestion 内核；
2. Domain Pack 不包含连接池、调度、重试、run、cursor、version 或 lineage 的重复实现；
3. Agent Runtime 不持有来源业务库凭据；
4. 历史 execution 可以定位 Ontology Version、Dataset Version、source watermark 与 evidence；
5. 全量与增量失败均 fail loud，不发布半成品版本、不伪造 completed；
6. Cube 与 Neo4j 均可从 PostgreSQL canonical facts 重建；
7. `easyv-dev` 演示环境不依赖 Kubernetes，并可用单一运维入口重复部署。

## 11. 停止条件

完成 P0-P6 和总体验收后停止。动态管理 UI、更多 Connector、CDC 平台、Action writeback、跨区域容灾、
多租户资源隔离等只记录为后续候选，不在没有真实调用者前顺带实现。
