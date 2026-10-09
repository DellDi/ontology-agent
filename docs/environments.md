# 环境与数据说明（先读这个）

> 事实核对日期：2026-10-09。第 3、7 节中带日期的数字是当时的实测快照，会变化，核对方法见各节。
> 本文只记录**已经存在的事实**和**明确标注“未实现”的计划**；不要把计划当成现状。

## 0. 三句话

1. **本地（3000）和公司验收（3100）是两套完全独立的系统**：不同的 Web、不同的 Java、不同的平台数据库、不同的账号。**没有任何自动同步。**
2. **本地库目前没有业务数据**（只建了库并完成迁移）。真实业务数据只在公司平台库 `ontology_agent_test` 里，通过 `easyv-dev` 访问。
3. `3100` 的地址是 `127.0.0.1`，只是 SSH 隧道的**本机入口**；它背后运行的服务和数据都在公司服务器上。

## 1. 环境一览

| 名称 | 地址 | 实际是什么 | 平台数据库 | 需要公司网络 |
|---|---|---|---|---|
| **local-dev（本地开发）** | `http://127.0.0.1:3000`（Web）→ `127.0.0.1:8080`（Java） | 你电脑上运行的 Web 与 Java | 本机容器 `127.0.0.1:55432` / `ontology_agent_local` | 否（调用模型需要普通互联网） |
| **easyv-dev（公司验收）** | `http://127.0.0.1:3100`（SSH 隧道入口） | **运行在公司服务器的 Web**，Java 在同一台服务器 | 公司共享 PostgreSQL `172.16.124.100:32408` 的 `ontology_agent_test` | 是 |
| EasyV 源库 | `172.16.124.100:32408/easyv` | EasyV 原始业务数据，**只被采集程序读取** | — | 采集时需要 |
| 公司服务器 | SSH 别名 `easyv-dev`（`172.16.125.3`） | 部署、采集、备份都在这里执行 | — | 是 |

本地基础设施（均为已存在的手工容器，不是 `compose.yaml` 创建的）：

| 容器 | 端口 | 用途 |
|---|---|---|
| `ontology-agent-local-postgres`（postgres:18） | `127.0.0.1:55432` | 本地平台库，库名 `ontology_agent_local`，用户 `ontology_agent` |
| `ontology-agent-local-cube` | `127.0.0.1:4000` | 语义查询，读取上面的本地库 |
| `dip3-redis` | `127.0.0.1:6379` | Worker 唤醒与会话短时缓存 |

本地没有 Neo4j，也没有启用 Property 域（`PROPERTY_DOMAIN_ENABLED=false`），EasyV 域已启用（`EASYV_DOMAIN_ENABLED=true`）。

## 2. 数据流

```text
公司 EasyV 源库 (easyv)
    │  手动触发：管理员在「数据接入」页提交任务，或在服务器上执行 scripts/easyv-dev ingest
    ▼
公司平台库 (ontology_agent_test)   ← 业务 facts、冻结版本、本体、账号、分析会话都在这里
    │
    ▼
easyv-dev 的 Java / Web
    │  SSH 隧道（见 docs/easyv-dev-deployment.md）
    ▼
你电脑上的 http://127.0.0.1:3100

本地 3000 → 本地 Java 8080 → 本地库 ontology_agent_local
                              ↑ 没有任何来自公司库的同步
```

- **增量采集已支持，但不会自己运行。** 代码里只有三个轮询调度器（分析 Worker、发布任务消费、图同步），它们只消费已经入队的任务，没有任何地方按周期创建采集任务。目前都是手动触发或重试。
- **远端有备份，不代表本地有副本。** `scripts/easyv-dev backup|restore` 只面向服务器上的部署库：备份包含 `identity`（账号与密码哈希）等全部平台 schema，恢复会用 `--clean` 覆盖配置所指的库。**不要用它做本地同步。**

## 3. 当前数据现状（2026-10-09 实测）

| 项 | 公司 `ontology_agent_test` | 本地 `ontology_agent_local` |
|---|---|---|
| 冻结集 | 18 个，最新发布于 2026-10-08 09:55（北京时间） | 0 |
| 应用/原型/区域/组件/方案 | 有数据 | 全为 0 |
| 账号 | 5 个（见第 7 节） | 1 个：`local-admin` |
| Flyway | V26 | V26（与当前代码一致） |

本地数据已用 SQL 核对（`flyway_schema_history`、`ingestion.dataset_version_sets`、`facts.easyv_*`、`identity.accounts`）。公司侧数字来自 easyv-dev 上的只读查询；再次核对只在被明确要求时进行。**本地没有业务数据是已知现状，不是故障**；不要为此去连接公司库或伪造数据（见第 9 节）。

## 4. 配置文件约定

| 文件 | 用途 | 谁读取 | 入库 |
|---|---|---|---|
| `.env` | **只放本地开发值**：本地库、本地 Redis/Cube、模型密钥、`DIP3_ENVIRONMENT=local-dev` | `scripts/local-dev`；你手动 `source` | 否（`.env*` 被忽略） |
| `.env.company` | 公司侧凭据：EasyV 源库、公司平台库、实时验证参数 | 仅在明确的公司侧操作时手动加载 | 否 |
| `.env.easyv-dev` | **服务器上**的部署配置 | `scripts/easyv-dev`（在服务器执行） | 否，仅有 `.env.easyv-dev.example` |
| `.env.example` / `.env.prod.example` | 模板 | — | 是 |

要点：

- Java **不会自己读取 `.env`**。谁启动它，谁负责把环境变量导出。统一入口是 `scripts/local-dev`，它只加载 `.env`。
- **不要把 `.env.company` 合并进日常 `.env`。** 加载它之后本地进程会指向公司库，Java 护栏会拒绝启动（见第 6 节）。
- 迁移前的旧 `.env` 备份在 `.env.backup-*`（同样被忽略，含历史凭据），确认无误后可自行删除。

## 5. 怎么确认当前连的是哪个环境

不要从端口号判断。按可信度从高到低：

1. **页面上的环境徽标**（登录页标题下、工作台侧栏顶部，移动端在顶栏）：本地为“本地开发”，公司验收为“公司验收 easyv-dev”，读取失败为红色“环境未知”。生产环境不显示。
2. **浏览器标签页标题**：`[本地开发] DIP3 - 智慧数据` / `[公司验收 easyv-dev] DIP3 - 智慧数据`。
3. **设置 → 运行环境**：平台管理员还能看到平台库的主机、端口与库名。
4. **接口**：`GET /api/runtime/environment`，未登录只返回环境名；库地址仅 `PLATFORM_ADMIN` 可见。
5. **本地命令**：`scripts/local-dev status` 列出容器、端口和本地 Java 声明的环境。
6. **Java 启动日志**：`runtime_environment name=… kind=… database=host:port/库名 remoteDatabase=…`。

环境名来自启动时的 `DIP3_ENVIRONMENT` **声明**，不是由数据库地址猜出来的。

## 6. 护栏：本地进程不能接入公司库

Java 在创建任何数据源、Worker 或调度器之前校验：

- 未声明时默认为 `local-dev`。`local-dev` 只允许平台库主机为 `localhost`、`127.0.0.1`、`::1`、`host.docker.internal` 或 compose 服务名 `postgres`。
- 指向其他主机时**拒绝启动**，并给出修复提示。原因：本地进程的 Worker 每 250ms 轮询任务队列，接入公司库会和 easyv-dev 的 Worker 抢任务，而且跑的是不同版本的代码。
- 部署环境必须显式声明：`compose.easyv-dev.yaml` 声明 `easyv-dev`，`compose.prod.yaml` 声明 `production`（均可被 `DIP3_ENVIRONMENT` 覆盖）。
- 只有**用户明确要求**时才使用例外：`DIP3_ALLOW_REMOTE_DATABASE=true`。此时页面徽标会变红并显示“连接远程库”，日志会输出警告。`LIVE_EASYV_PERSIST_PLATFORM_RESULTS=true` 的实时验证会把结果写入公司库，同样需要它。
- 护栏只防“本地连公司库”这一类错误；它不替代权限与审计。

## 7. 账号

两边账号库**不同**，账号和密码不会自动同步。本文不记录任何密码。

easyv-dev（2026-10-09 查询，共 5 个，均已启用）：

| 账号 | 用途 |
|---|---|
| `18668184122`（页面名“业务验收账号”） | 日常业务分析与真实数据验收；业务分析员，绑定 EasyV 用户 `3` |
| `platform-admin` | 平台管理、数据发布、授权 |
| `acceptance-admin` | 管理员流程测试 |
| `acceptance-scoped` | 权限范围测试，绑定 EasyV 用户 `8` |
| `acceptance-unbound` | 未绑定业务身份时的错误提示测试 |

本地：只有 `local-admin`。需要更多本地账号时通过管理员接口或 `admin-seed` profile 创建，不要从公司库复制账号表。

## 8. 日常操作

本地开发（不需要公司网络）：

```bash
scripts/local-dev status     # 容器、端口、本地 Java 声明的环境
scripts/local-dev migrate    # 对本地库执行 Flyway（应用启动时不会自动迁移）
scripts/local-dev backend    # 本地 Java API + Worker，端口 8080
scripts/local-dev web        # 本地 Web，http://127.0.0.1:3000
```

公司验收（需要公司网络）：

- 访问：按 [easyv-dev 部署说明](./easyv-dev-deployment.md) 建立 SSH 隧道后打开 `http://127.0.0.1:3100`。
- 部署、采集、备份：在服务器上用 `scripts/easyv-dev`，流程见同一份文档。
- 发布顺序：**本次新增了 `/api/runtime/environment`，先发布 backend 再发布 Web**；反过来会在间隙里短暂显示红色“环境未知”，不影响业务。

## 9. 给智能体与新成员的规则

1. **先说清环境。** 任何验证结论都要写明是在 `local-dev` 还是 `easyv-dev` 得出的；真实业务数据的验收只能在 easyv-dev（3100）。
2. **本地没有业务数据，不要为此连接公司库**，也不要把手工造的数据说成真实验收。需要真实数据时先看第 10 节的计划，或请用户在 easyv-dev 上验证。
3. **不要读取、打印或复制 `.env*` 里的密码和密钥。** 需要确认是否配置时只看变量名。
4. **不要用 `.env.company` 启动本地后端**，不要设置 `DIP3_ALLOW_REMOTE_DATABASE=true`，除非用户明确要求并说明目的。
5. **未经明确要求，不要对公司库执行写入、迁移、`restore`、采集或清理。** 公司侧的部署、采集和备份只在用户要求时由 `scripts/easyv-dev` 执行。
6. **不要把 3100 说成“本地”**，也不要把 3000 的结果说成“已在公司环境验收”。
7. 遇到“页面显示环境未知”：先确认后端版本是否包含 `/api/runtime/environment`，再确认 Web 的 `JAVA_BACKEND_URL` 指向哪里。

## 10. 尚未实现的能力（计划，按优先级）

| 顺序 | 能力 | 状态 | 要点与前置条件 |
|---|---|---|---|
| 1 | 环境护栏与标识 | **已实现**（本文第 5、6 节） | — |
| 2 | **本地数据快照**（公司 → 本地，精选导出/导入/核对） | 未开始 | 只带已发布本体、最新及前一个冻结集及其 facts 与冻结清单；**不带** `identity`、会话、审计和采集批次原始数据；本地账号用 seed 重建，并绑定到相同的 EasyV 用户（3、8）；导出同时生成清单（迁移版本、本体版本、冻结集、数据截止时间、各产品行数、校验和），导入后自动核对 |
| 3 | 离线验收记录 | 未开始 | 断开公司网络（保留互联网调用模型），在 3000 上用本地账号跑固定的验收问题，并与 3100 上同一冻结集的结果对账 |
| 4 | 公司源库到平台库的定时增量与周期对账 | 未开始 | 属于路线图 D（持续运营）。前置：生产只读源库角色、失败告警与对账；目前采集用的是高权限开发账号，不适合无人值守 |

## 11. 维护本文

出现以下变化时同步更新，并刷新顶部的核对日期：新增或下线环境、端口或地址变化、账号变化、本地快照或定时采集上线、护栏规则变化。本文与代码不一致时以代码为准，并修正本文。
