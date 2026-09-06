# easyv-dev 内部演示部署

这套部署只负责 EasyV Domain Pack 的内部演示，不启动新的 PostgreSQL，也不让 API/Worker
直连 EasyV 源库。平台事实、审计、版本和 lineage 写入共享的 Ontology PostgreSQL；EasyV
源账号只注入一次性 `ingest` 容器。

## 运行边界

| 进程 | 长期运行 | 可访问 EasyV 源库 | 职责 |
|---|---:|---:|---|
| `web` | 是 | 否 | 页面和 Java BFF 透明代理 |
| `backend` | 是 | 否 | EasyV 问数、LLM、API、Worker，只读 canonical facts |
| `valkey` | 是 | 否 | Worker 唤醒和 Chat Memory；任务事实仍在 PostgreSQL |
| `migrate` | 否 | 否 | Flyway 独立迁移共享平台库，成功后退出 |
| `ingest` | 否 | 是，只读 | 全量/增量抽取、物化、冻结 Dataset Version Set，成功后退出 |

Cube、Neo4j 和 ERP 属于 Property Domain Pack，本部署不声称它们可用；Graph Sync 被显式关闭。
全局健康状态仍会诚实显示这些依赖不可用，Compose 只使用由 DB、Valkey、LLM 配置和 readiness
组成的 `easyv` health group。启用 Property 演示时应换用完整部署，而不是给依赖配置假成功。

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

源凭据只存在于执行命令的进程环境，并且不进入 `.env.easyv-dev`：

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

首次发布使用 `FULL`。日常运行使用 `INCREMENTAL`：有 cursor 的数据集抽取变更，没有新增行时
仍会基于已发布 head 物化完整 canonical 版本；当前无增量 cursor 的输入沿用已发布版本，不会
把事实表清空。每次成功发布都会产生新的 frozen Dataset Version Set，分析任务绑定该 set，
不会在执行中查询“最新版本”。

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
