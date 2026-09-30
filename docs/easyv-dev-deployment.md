# easyv-dev 内部演示部署

这套部署复用共享 Ontology PostgreSQL，不启动新的平台数据库，也不让 API/Worker
直连 EasyV 源库。平台事实、审计、版本和 lineage 写入共享库；EasyV 源账号只注入
一次性 `ingest` 或独立 `release-worker` 容器。Property 从平台库中的受控 `erp_staging` 物化 canonical facts，
Cube 与 Neo4j 作为 Property 投影运行。

## 运行边界

| 进程 | 长期运行 | 可访问 EasyV 源库 | 职责 |
|---|---:|---:|---|
| `web` | 是 | 否 | 页面和 Java BFF 透明代理 |
| `backend` | 是 | 否 | EasyV/Property 问数、LLM、API、Worker、Graph Sync；只读 canonical facts |
| `valkey` | 是 | 否 | Worker 唤醒和 Chat Memory；任务事实仍在 PostgreSQL |
| `cube` / Cube Store | 是 | 否 | EasyV/Property 语义指标查询，只读 `facts.*`；backend `depends_on` 等待其 healthy |
| `neo4j` | 是 | 否 | Property 关系投影，可从冻结 Dataset Version Set 重建 |
| `migrate` | 否 | 否 | Flyway 独立迁移共享平台库，成功后退出 |
| `ingest` | 否 | 是，只读 | EasyV 全量/增量抽取、物化、冻结 Dataset Version Set，成功后退出 |
| `property-ingest` | 否 | 否 | 从平台 `erp_staging` 物化 Property canonical products，成功后退出 |

EasyV 源凭据不得进入 `.env.easyv-dev` 或长期运行的 backend。Property ingestion 使用平台
DataSource，不引入外部 ERP 账号；外部 ERP 到 `erp_staging` 的 source contract 仍未纳入
本部署。`easyv` health group 为 `readinessState,db,redis,llmProvider,cube`，依赖失败时
诚实报告，不配置假成功。Cube 是 EasyV 问数的运行时依赖：backend `depends_on` 等待
`cube` healthy，`backend` 缺失 `CUBE_API_URL` 或 Cube 未就绪时 health 直接 DOWN。

## Cube 与 facts 只读账号

EasyV 问数经 Java 语义层编译为 Cube 查询，Cube 以平台库中独立的只读角色直连 `facts`
schema。应用账号（`JAVA_DATABASE_USERNAME`）没有 CREATEROLE/超级用户权限，角色须由
发布流程以 DBA 权限创建，不需要产品用户维护数据库账号：

```bash
# 发布进程从私有凭据注入 FACTS_READER_DBA_USERNAME / FACTS_READER_DBA_PASSWORD。
# 发布主机需有 psql 15+；Cube 账号和口令读取已有 .env.easyv-dev。
scripts/easyv-dev facts-reader-seed
# 也可在注入上述 DBA 变量后执行 migrate，自动先跑账号种子再迁移。
scripts/easyv-dev migrate
```

种子仅在角色缺失时创建，重复执行不修改既有口令，不将 DBA 凭据写入应用配置或镜像。
初始登录管理员继续使用 `admin-seed`，已有账号升级时不重置密码。`acceptance-*` 是验收账号，
不属于安装种子，也不要求产品用户日常维护。

之后每次 `scripts/easyv-dev migrate`（compose `migrate` 服务）在 Flyway 成功后自动
对 `FACTS_READER_ROLE`（即 `CUBE_DATABASE_USERNAME`）幂等执行 facts 授权；角色缺失、
名字非法或带有 SUPERUSER/CREATEDB/CREATEROLE 时 migrate 直接失败。Cube 的库地址由
脚本从 `JAVA_DATABASE_URL` 派生注入（`CUBE_DB_HOST/PORT/NAME`），无需另行配置。

`CUBEJS_DEFAULT_TIMEZONE` 固定 `Asia/Shanghai`，与 EasyV 语义层业务时区一致。
Cube queryRewrite 拒绝会以 Cube HTTP 500 返回；Java 适配器将 `SEMANTIC_*` 错误码
fail loud 映射（保持现状，不做 Cube UserError 包装），健康与日志均可定位。

## 一次构建

`easyv-dev` 无需访问 Docker Hub 的 Maven/Temurin 镜像。先在宿主机用 Java 21 构建 JAR，
再用可访问的 CentOS Stream 9 运行时镜像安装 OpenJDK 21：

```bash
mvn -f backend-java/pom.xml -DskipTests package
docker build -f Dockerfile.java.runtime \
  -t ontology-agent-java:easyv-dev backend-java/target

docker build -f Dockerfile.web.runtime \
  -t ontology-agent-web:easyv-dev .
```

也可以统一使用 `scripts/easyv-dev build`；`release` 会依次构建、部署并等待健康检查。

`Dockerfile.java.runtime` 只接收已构建 JAR，不承担 Maven 构建；这样代码构建失败与运行时
镜像构建失败可以分别诊断。两个基础镜像均固定 digest，升级时显式评审并更新。统一脚本还会
用 Git revision（工作树有改动时带 `-dirty`）给镜像增加 tag 和 OCI label，避免把未提交构建误认成
某个干净 commit；正式发布可显式设置 `RELEASE_REVISION`。

## 启动和健康检查

```bash
cp .env.easyv-dev.example .env.easyv-dev
# 填写共享平台库、LLM 和 Session 配置；不要把 EasyV 源账号写入该文件。

docker compose -f compose.easyv-dev.yaml --env-file .env.easyv-dev config --quiet
docker compose -f compose.easyv-dev.yaml --env-file .env.easyv-dev up -d
docker compose -f compose.easyv-dev.yaml --env-file .env.easyv-dev ps

curl --fail --silent http://127.0.0.1:8080/actuator/health/easyv
curl --fail --silent http://127.0.0.1:3000/
```

服务器若只安装了独立 `docker-compose` 二进制，使用 `scripts/easyv-dev deploy` 即可；脚本会自动
选择 `docker compose` 或 `docker-compose`，避免操作人员记两套命令。

`backend` 必须等待 `migrate` 成功和 Valkey 健康，`web` 必须等待 `backend` 健康。Flyway
应用成功后仍保留 `flyway_schema_history` 版本、checksum 和执行时间；新增字段或表继续新增
`V<n>__description.sql`，禁止修改已成功的历史脚本。

UI 默认只绑定 `127.0.0.1`。需要供内网演示时，把 `EASYV_DEMO_BIND_ADDRESS` 设置为经过
防火墙确认的服务器内网地址；不要为了演示直接绑定公网接口。

## 初次全量与后续增量

源凭据只注入采集进程，不进入 `.env.easyv-dev` 或 backend：

```bash
export EASYV_POSTGRES_JDBC_URL='jdbc:postgresql://source-host:5432/easyv'
export EASYV_POSTGRES_USERNAME='dedicated_read_only_role'
export EASYV_POSTGRES_PASSWORD='replace-at-runtime'
export EASYV_POSTGRES_SCHEMA='easyv_saas'
export EASYV_POSTGRES_REQUIRE_READ_ONLY_ROLE='true'

INGEST_MODE=FULL docker compose -f compose.easyv-dev.yaml \
  --env-file .env.easyv-dev --profile ops run --rm ingest

INGEST_MODE=INCREMENTAL docker compose -f compose.easyv-dev.yaml \
  --env-file .env.easyv-dev --profile ops run --rm ingest

unset EASYV_POSTGRES_JDBC_URL EASYV_POSTGRES_USERNAME EASYV_POSTGRES_PASSWORD \
  EASYV_POSTGRES_SCHEMA EASYV_POSTGRES_REQUIRE_READ_ONLY_ROLE
```

等价的统一入口是 `scripts/easyv-dev ingest FULL` 和
`scripts/easyv-dev ingest INCREMENTAL`；缺少源 JDBC、用户名或密码时脚本会直接失败。

首次发布使用 `FULL`。V21 升级的首次接入也必须使用 `FULL`（顺序见下节）。日常运行使用 `INCREMENTAL`：有 cursor 的数据集抽取变更，没有新增行时
仍会基于已发布 head 物化完整 canonical 版本；当前无增量 cursor 的输入沿用已发布版本，不会
把事实表清空。每次成功发布都会产生新的 frozen Dataset Version Set，分析任务绑定该 set，
不会在执行中查询“最新版本”。

`ai_screen_app.is_delete='1'` 会作为 Application tombstone 写入
`facts.easyv_ai_application.is_deleted=true` 并随 product version 保留；EasyV 问数只统计
`not is_deleted` 的 active Application cohort。不得为了演示清空 tombstone。

## V21 原型结构扩展的部署顺序

`scripts/easyv-dev ingest FULL|INCREMENTAL|RECONCILE` 的显式参数优先于部署环境文件中的 `INGEST_MODE` 默认值。2026-09-30 修复了加载 `.env` 后覆盖 FULL 的问题，并以实际执行脚本的测试覆盖三种模式；升级时核对日志/源任务中的真实 mode，不能只依据输入命令。

2026-09-30 已部署到 easyv-dev，平台库已升至 V21。新的 ingest 命令发布 8 个产品：原 5 产品加 `easyv-prototype-layout`、`easyv-prototype-block`、`easyv-prototype-component`。三者共用 `easyv-prototype-task`，源列契约由 v1 升为 v2，首次升级不能直接做 INCREMENTAL。旧冻结集中的 facts 保留；含 v1 源版本的链不能按当前 v2 契约重新物化，须重新 FULL。

确认发布后按以下顺序执行，使用本次代码构建的 Java 镜像与配套生成的 Cube 配置：

1. `scripts/easyv-dev backup`，记录备份、当前镜像和冻结集；停止 `release-worker`，避免旧 Worker 在 schema 升级后接到新任务。
2. 准备新镜像与配置，执行 `scripts/easyv-dev migrate` 到 V21。migrate 完成后既有 facts-reader 种子流程为 Cube 账号授予新 facts 表 SELECT 权限。
3. 执行 `scripts/easyv-dev ingest FULL`，确认 8 个产品出现在同一 frozen Dataset Version Set。三个新增产品共用同一个 v2 原型源版本；不能只看任务 completed，应核对布局解析状态、区域/组件计数、产品血缘及源统计。
4. 更新 Cube、backend/web 至本次镜像和配置，再启动新版 `release-worker`。确认 health 后用真实账号查询版式/区域/图表族分布与 L1–L4 签名；确认父应用授权与 `is_deleted` 范围，并核对本次 frozen set。
5. 执行 `scripts/easyv-dev ingest INCREMENTAL` 并对账；源更新不能污染旧版本，删除通过 RECONCILE 清除当前集合，历史冻结结果仍可回看。最后执行浏览器与原 A 能力评测门禁。

本地真实源门禁使用部署机当前只读源配置：120 个原型全部解析成功，777 个区域、1617 个图表组件，与独立源 JSON 展开 SQL 对账一致。FULL、INCREMENTAL、RECONCILE 的 8 产品行数与内容哈希一致；源记录计数及既有状态分布在验证前后不变。该验证不写部署平台库，也不代表部署后的 Cube/浏览器验收通过。

结构事实发布证据：备份 `/opt/ontology-agent-backups/ontology-agent-ontology_agent_test-20260930142026.dump`；发布目录 `/opt/ontology-agent-releases/f8f555a`，backend/release-worker 镜像 `ontology-agent-java:f8f555a`。当时前端源码无改动，新 Web 镜像依赖拉取超时，保留过已验证的 `ontology-agent-web:account-passwords-20260929`；未绕过依赖供应链校验。后续工作台渲染修复已更新 Web，见下方记录。迁移、部署和接入日志位于 `/opt/ontology-agent-release-private/`，不将配置凭据提交仓库。

部署平台库 FULL 集合为 `ingest-947f5eb3-8ece-404e-8144-ba912d9ce1f5`，INCREMENTAL 集合为 `ingest-c1678964-0ed2-475b-b1d1-6ef377b3d021`；8 产品全部 published，行数/内容哈希逐项一致。原型源 FULL v2 为 `b85290a5-121b-38fe-b89e-61b5ff6f3ff8`，零变更增量 v2 正确引用该父版本。布局 120/区域 777/组件 1617，与源独立查询一致。L1–L4 签名组数为 39/118/118/120。

真实提问“统计所有可访问原型的布局类型分布，并给出原型数、区域总数和图表组件总数。”已完成模型、Cube、答案和图表落库。管理员示例会话为 `d56abd13-bd66-4c7b-a018-14d4eee68892`，执行为 `193e6d98-e846-3adb-bf0e-9ce96460d8d3`。父应用 active 范围返回 119 原型、770 区域、1601 组件，5 类布局逐行与独立 SQL 一致；1 个已删除父应用对应的原型被排除。Web 本机端口为 3100，当前维护机 SSH 转发为 `http://127.0.0.1:33100`，该链接只在维护机可用，不是对外公网入口。浏览器登录页已检查；完整登录后交互、非管理员真实账号负向权限与原 A 模型评测仍待验收。

2026-09-30 工作台渲染修复：Web 已更新为 `ontology-agent-web:8ff43fd`（Linux amd64），配套发布目录 `/opt/ontology-agent-releases/8ff43fd`，仅重建 Web 容器，backend/release-worker 仍为 `f8f555a`。维护机转发已补为 `http://127.0.0.1:3100`。首页输入框移除 `px-0` 与无边框覆盖，复用 Field 控件样式；首页 loading 与当前输入/历史布局对齐并使用静态骨架，分析详情增加独立加载边界，发送与待执行占位共用消息组件。

验证：Web 88 通过、5 个可选容器测试跳过，tsc、相关文件 ESLint、宿主与 Linux 镜像生产构建通过。使用当前 EasyV 用户 3 的真实浏览器会话检查：输入框内边距为 `10px 14px`、边框 1px；首页加载占位的 computed animation-name 全为 none；详情导航显示“正在加载分析记录”后恢复实际多轮结果，浏览器无 error 日志。未改数据契约和模型执行逻辑；本次没有完成原 A 全量模型评测。

2026-09-30 首个执行进度前的空白气泡修复：Web 已更新为 `ontology-agent-web:ec5a84f`，发布目录 `/opt/ontology-agent-releases/ec5a84f`，Web/backend health 均为 healthy。根因是 queued/running 尚无回答或步骤时，消息外框仍渲染，而内部组件全部返回空；现改为不带回答外框的 Spinner 与等待说明，真实步骤/回答到达后使用原内容区。仅有 supporting blocks 时也不再输出空的主结果容器。未调整执行契约或增加虚假进度。

验证：实际 React 组件渲染测试先复现空框，再覆盖 queued、running、流式回答、步骤、工具、完成、失败和断连；Web 门禁 89 通过、5 个可选容器测试跳过，tsc、相关 ESLint、宿主与 Linux amd64 镜像构建通过。真实账号独立会话 `c8434193-d8f1-425b-ac59-004f8c5cdcc4` 首轮返回授权范围的 5 个原型、30 个区域、63 个组件，以及表格、图表与真实步骤；后续均值问题因目录缺少均值指标明确失败，错误保持可见，不将它计为分析成功。首个事件前状态太短，未捕获实时截图，使用生产组件与生产 CSS 的独立预览检查等待状态。浏览器无 error，存在 Recharts 初始容器尺寸 warning，已记录，未在本次扩大修复范围。

UI 审查范围限于分析对话状态和基础控件：项目已通过 `components.json` 接入 shadcn/ui，但 `src/components/ui` 与 `src/app/_components/workbench` 存在并行 Button/Field 实现。后续优先收敛基础控件与间距，再统一提交、等待、执行、完成、失败和断连的反馈，最后逐页替换；本次未实施整个前端重构。发送后底部输入框附近的可见空间和图表初始化尺寸需在后续对话布局审查中验证。

## Property 物化与图投影

Property 不读取外部 ERP。确认平台库已有受控 `erp_staging` 后：

```bash
scripts/easyv-dev property-ingest FULL
scripts/easyv-dev graph-bootstrap
scripts/easyv-dev smoke
```

`property-ingest` 发布六个 Property canonical products 并冻结 Dataset Version Set。
`graph-bootstrap` 从最新冻结集合重建 Neo4j；传入 `datasetVersionSetId` 时只重建该集合。
`smoke` / `cross-domain-smoke` 检查 EasyV health、Cube `readyz`、Neo4j health 和 Graph
bootstrap 状态，不触发新的 ingestion 或 bootstrap。没有完成 `graph-bootstrap` 时 smoke 失败。

失败时先看一次性容器日志，再按同一 `correlation_id` 查询：

- `ingestion.source_ingestion_runs`
- `ingestion.source_dataset_versions` / `source_dataset_batches`
- `ingestion.product_materialization_runs`
- `ingestion.data_product_versions` / `data_product_version_lineage`
- `ingestion.dataset_version_sets` / `dataset_version_set_items`

## 领域切换语义

领域选择有两层：

- 同一 backend 中已经启用的 Capability，由每个会话的问题在运行时路由，属于热选择；
- Domain Pack 的 Bean、数据映射和外部依赖在进程启动时装配。启用/停用 EasyV 使用
  `EASYV_DOMAIN_ENABLED` 后重启 backend，属于冷激活。

当前并不是从目录动态加载任意 Java 插件。新增行业仍需实现并发布一个 Domain Pack，但不应
修改通用 ingestion 编排；领域只注册 source/dataset/product 定义、canonical transform、Ontology
语义和 Capability。源数据更新通过独立 ingestion release 热发布，已运行的分析继续使用自己绑定的
Dataset Version Set，新分析才选择新发布版本。


## Web 发布任务与管理员初始化（V11–V14）

Web/API 只写入发布任务队列，不执行源库读取。独立 `release-worker` 使用 `ingest-queue`
profile 轮询队列，持有 EasyV 只读源凭据，同时可以执行平台 staging 的 Property 发布。
它不启动 HTTP、分析 Worker 或图同步。必须使用直连 PostgreSQL 或 session pooling，
不能经过 transaction pooling，因为队列互斥使用会话级 advisory lock。

迁移后，通过进程环境注入 `ADMIN_SEED_USERNAME` 与至少 16 位随机 `ADMIN_SEED_PASSWORD`，
执行 `scripts/easyv-dev admin-seed`。种子只在账号不存在时插入 PBKDF2-SHA256 哈希；重复执行不重置密码。
完成后移除该进程环境变量，凭据交由部署方管理。登录页“平台管理员登录”会建立正式签名会话，
连续五次密码错误锁定五分钟。该身份不包含 Property 项目范围或 EasyV 用户身份。
默认禁用手填权限的开发登录；不得为验收开启任意身份登录。

通过原有只读源环境变量执行 `scripts/easyv-dev release-worker` 启动队列执行器。
源凭据留在这个独立采集容器的运行环境，只有宿主机运维人员可读取；backend 与 web 均不持有它们。
升级时也必须用同一份私有采集配置重新创建 release-worker，不能只更新 API。

全量、增量与全量对账均为显式发布操作。RECONCILE 忽略历史游标并建立新版本根，
删除的数据不再出现在新版本；旧冻结版本保持原样。

平台管理员在“数据接入 → 组织授权”维护共享源查看授权。组织只能读取被授权源的目录、
任务与完整冻结版本；混合包含未授权源的版本整体不可见。记录窗口是平台最近 50 条任务、
20 个版本中的可见记录。授权不改变业务分析范围，也不代表源数据按组织物理隔离。
发布、重跑及授权变更始终要求 PLATFORM_ADMIN，授权修改记入平台审计。

## 备份与恢复

平台库是唯一的权威状态（会话、冻结版本、事实、身份、审计）；EasyV 源库为只读外部依赖，不纳入备份。

```bash
# 备份：pg_dump 自定义格式，覆盖 platform/facts/ingestion/identity/public
scripts/easyv-dev backup [输出目录]        # 默认 ./backups，文件 ontology-agent-<db>-<时间戳>.dump

# 恢复：需先确认，自动停 backend/web，pg_restore --clean 回写后重启并等健康
scripts/easyv-dev restore backups/ontology-agent-<db>-<时间戳>.dump
```

平台库地址从 `JAVA_DATABASE_URL` 解析（与 backend 同源），备份/恢复与 Cube 连接参数
（`CUBE_DB_HOST/PORT/NAME`）都由 `scripts/easyv-dev` 统一派生，不存在第二份可能漂移的地址配置。

注意：`JAVA_DATABASE_USERNAME` 应用账号通常无 `CREATEDB`——恢复到**全新库**需 DBA 先建库；
同库回写可直接执行（`--clean --if-exists`）。恢复属破坏性操作，脚本要求输入库名二次确认。
建议每日备份并保留 7 份归档；升级发布前强制备份一次。

## 凭据交接清单

| 凭据 | 存放位置 | 使用方 | 轮换方式 |
|---|---|---|---|
| 平台库账号 `JAVA_DATABASE_*` | `.env.easyv-dev`（部署机） | backend/migrate/backup | 改库密码后同步 env 并重启 |
| Cube facts 只读账号 `CUBE_DATABASE_*` | `.env.easyv-dev` | cube / migrate（授权校验） | DBA 建角色后写入；改密后同步 env 并重建 cube |
| EasyV 源只读账号 `EASYV_POSTGRES_*` | `source-reader.env`（私有，不进仓库） | ingest / release-worker | 源侧改密后更新私有 env |
| `SESSION_SECRET` | `.env.easyv-dev` | backend 签名会话 Cookie | 更换后全量会话失效需重登 |
| `GRAPH_SYNC_OPS_SECRET` | `.env.easyv-dev` | graph-sync 运维端点 | 更换后同步调用方 |
| 平台管理员初始密码 | `ADMIN_SEED_PASSWORD` 一次性注入 | admin-seed | 种子只在账号不存在时写入；改密见下方“密码轮换” |
| LLM API Key（`LLM_*`） | `.env.easyv-dev` | backend | 供应商控制台轮换后更新 env |

原则：源凭据只存在于采集进程环境（宿主机私有文件），不进入 `.env.easyv-dev`、不进仓库、不进镜像；
`.env.easyv-dev` 文件权限 `600`，仅部署账号可读；任何凭据不得以明文进入提交物或文档。

### 密码轮换

管理员登录后进入 **账号管理**（`/admin/accounts`），选择账号，输入并确认新密码后保存。
页面复用已有管理员 API，普通用户不能列出账号或修改他人密码；暂不提供普通用户自助改密。
管理员 API 为
`PATCH /api/admin/identity/accounts/{id}`（body `{"password":"..."}`，8-1024 位；管理员账号建议 ≥16 位）；
可修改包括自身在内的任意本地账号，操作限 `PLATFORM_ADMIN`。改密不会使既有会话失效；需要立即踢出时
同时更换 `SESSION_SECRET`（影响全部用户）。初始管理员口令轮换后，删除部署机私有 `admin-seed.env`。

### 2026-09-29 账号与物业模块核查

- easyv-dev 的 `18668184122` 是本工作台登录账号，源库 `easyv_saas.dt_easyv_user`
  在部署实际连接的源库（`172.16.124.100:32408/easyv`）通过手机号匹配为用户 3；
  已通过管理员绑定 API 写入 `easyv/userId=3`。验收用户 8 是另一账号。
  数据库连接器默认指向另一环境，同手机号在该库对应用户 16，不能跨环境套用绑定。
- Property 是物业收缴率分析模块。历史提交 `447c4d4` 与 `d5132fb` 记录了 9 月 14 日的封存决定；
  V15 同时停用接入目录。此次查库，物业账单、项目和用户表均为 0 条，Neo4j 未运行。
  当前不具备启用条件；恢复需要落实真实 ERP 数据接入、恢复目录、启用领域与 Neo4j，再完成物化、图投影与收缴率验收。
  这是产品集成待办，不是要求用户维护某个账号。
- 账号管理页面已发布至 `ontology-agent-web:account-passwords-20260929`，发布目录
  `/opt/ontology-agent-releases/49e561e-account-passwords-20260929`；backend/release-worker 继续使用原镜像。
  Web 健康检查与 EasyV health 均通过。真实浏览器验证了密码确认、保存、旧密码拒绝、新密码登录、
  非管理员读取/改密返回 403，以及 390px 无横向溢出；验收后恢复测试账号原密码。
  本地 tsc、lint、构建通过，Web 测试 85 通过、5 跳过；角色种子在事务中验证首次创建、重复执行保留口令后回滚。

## release-worker 看守

release-worker 不提供 HTTP 健康检查。已知两类停摆：宿主 Docker 20.10 下 SIGKILL 后
`restart=unless-stopped` 不触发重启；容器重建时未注入 `source-reader.env` 导致启动失败并无限重启
（2026-09-15 至 09-24 持续 9 天、11116 次，期间 Web 发布任务无人执行）。重建 release-worker 必须
通过 `scripts/easyv-dev release-worker` 并先加载私有源配置。

看守方案（待实施）：宿主机 systemd timer 每分钟检查容器 `State.Status=running` 且 `RestartCount`
未增长；存在 `pending` 超过 5 分钟的 `ingestion.release_tasks` 视为停摆；异常时告警，不在看守脚本中
持有源凭据或自动重建。
