# Story 4.7: 为本地开发补齐 Cube 与 Neo4j Compose 服务

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 开发团队,
I want 在本地 Compose 基线中正式补齐 Cube 与 Neo4j 服务,
so that 开发体验、环境变量、文档说明和真实依赖保持一致，而不是停留在“代码已接入但本地无服务”的模糊状态。

## Acceptance Criteria

1. 当开发者执行本地 Compose 基线时，`compose.yaml` 中必须存在可运行的 `cube` 与 `neo4j` 服务，并具有清晰的端口、卷、健康检查或最小可验证启动方式。
2. `.env.example`、`docs/local-infrastructure.md`、`Story 4.4 / 4.5` 中涉及 Cube 与 Neo4j 的连接地址、端口和启用方式必须一致，不允许出现“代码默认端口”和“文档未提供服务”的错位。
3. `Story 4.4` 与 `Story 4.5` 的本地联调路径必须可以基于 Compose 启动的真实服务运行，不再依赖纯环境变量占位或伪实现路径。

## Tasks / Subtasks

- [x] 在 Compose 中正式补齐 `cube` 与 `neo4j` 服务（AC: 1, 3）
  - [x] 为 `neo4j` 选择明确的官方镜像与稳定版本标签，配置本地 `bolt` / `http` 端口、命名卷和最小启动参数。
  - [x] 为 `cube` 选择明确的运行方式与稳定版本标签，配置 API 端口、依赖关系和最小启动所需环境变量。
  - [x] 保持 `web` / `worker` 与新增服务的网络边界清晰，不把宿主机地址和容器内服务名混用。
- [x] 对齐环境变量与文档语义（AC: 2）
  - [x] 让 `.env.example` 中的 `CUBE_API_URL`、`NEO4J_URI` 与 Compose 实际端口和服务说明一致。
  - [x] 更新 `docs/local-infrastructure.md`，明确如何启动、查看日志、验证 `cube` / `neo4j` 服务。
  - [x] 更新 `Story 4.4`、`Story 4.5` 中过时的“延后”或“仅预留配置”表述。
- [x] 补充最小联调与回归验证（AC: 1, 2, 3）
  - [x] 新增或扩展故事级测试，验证 `compose.yaml` 中真实存在 `cube` 与 `neo4j` 服务。
  - [x] 运行 `docker compose config`。
  - [x] 如果当前环境可访问 Docker daemon，运行 `docker compose up -d cube neo4j` 或等价命令验证服务可用。
  - [x] 至少执行与 `Story 4.4`、`Story 4.5` 相关的本地联调或 smoke test，确认不是“容器存在但路径不可用”。

## Dev Notes

- 这条故事的目标不是“再写一层 adapter”，而是把已经进入代码基线的 `Cube` 与 `Neo4j` 真正补进本地基础设施，使开发环境与故事现状对齐。
- `Story 2.1` 当时明确延后了 `cube` / `neo4j`，但当前项目已经进入 `Story 4.4` 与 `Story 4.5` 的真实接入阶段，所以这里是一次必要的基线纠偏。
- 如果 `Cube` 的最小本地运行还需要 schema / model 配置，应把“能启动服务”和“能跑业务查询”区分开来记录，不要在文档里含糊成“已经接入”。

### Architecture Compliance

- 必须对齐架构文档中的“初始进程拓扑至少包含 `web`、`worker`、Postgres、Redis、Neo4j、Cube`”要求。
- `cube` 和 `neo4j` 属于服务端基础设施依赖，不得暴露成浏览器端直连路径。
- 本故事聚焦开发态 Compose 基线，不替代 `Story 7.3` 的交付态容器化部署基线。

### File Structure Requirements

- 重点文件预计包括：
  - `compose.yaml`
  - `.env.example`
  - `docs/local-infrastructure.md`
  - `tests/story-2-1-compose-baseline.test.mjs` 或新增 `tests/story-4-7-compose-services.test.mjs`
  - 如有必要，补充 Cube / Neo4j 本地运行说明文档

### Testing Requirements

- 至少覆盖：
  - Compose 中存在 `cube` 与 `neo4j` 服务
  - 端口、关键环境变量和文档约定一致
  - `docker compose config`
  - 若 Docker daemon 可用，最小启动成功
  - `Story 4.4` / `Story 4.5` 至少各有一条真实服务可连的本地验证路径

### Previous Story Intelligence

- `Story 2.1` 明确写了“不提前接入 `neo4j` / `cube`”，这是当时的阶段性决定；本故事的目的就是在进入 `Epic 4` 真实接入后，把这个决定正式收回。
- `Story 4.4` 已建立 Cube semantic query adapter，但当前依赖仍停留在“环境变量存在、本地服务未纳入 Compose”的不一致状态。
- `Story 4.5` 已建立 Neo4j graph adapter 与 sync baseline，当前也存在相同的不一致状态。
- 用户已明确提出原则：不接受“虚拟代码与伪实现路径”，开发体验必须与文档体验对齐，缺什么就应在对应阶段正式补齐。

### References

- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#Story 4.4: Cube 语义层只读查询接入]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md#Story 4.5: Neo4j 图谱接入与关系/因果边同步基线]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md#基础设施与部署]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/2-1-docker-compose-baseline.md]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/docs/local-infrastructure.md]
- [Source: /Users/delldi/work-code/open-code/ontology-agent/compose.yaml]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test tests/story-4-7-compose-services.test.mjs`
- `pnpm test:smoke:neo4j`
- `node --test tests/story-2-1-compose-baseline.test.mjs tests/story-4-4-semantic-query.test.mjs tests/story-4-5-neo4j-graph.test.mjs tests/story-4-7-compose-services.test.mjs`
- `pnpm cube:token`
- `docker compose config`
- `docker compose up -d postgres redis neo4j cube`
- `docker compose ps`
- `curl http://127.0.0.1:4000/readyz`
- `curl -H "Authorization: $CUBE_API_TOKEN" http://127.0.0.1:4000/cubejs-api/v1/meta`
- `curl -H "Authorization: $CUBE_API_TOKEN" -H 'Content-Type: application/json' -d '{"query":{"measures":["Finance.receivableAmount"],"filters":[{"member":"Finance.organizationId","operator":"equals","values":["org-smoke"]}],"limit":5}}' http://127.0.0.1:4000/cubejs-api/v1/load`
- `docker compose exec -T neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" 'RETURN 1 AS ok;'`
- `pnpm db:migrate`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- `compose.yaml` 已正式补齐 `cube` 与 `neo4j` 服务，并为 `web` / `worker` 覆写容器内服务地址，消除“宿主机地址”和“容器内服务名”混用。
- 新增 `cube/conf` 最小配置与 `Finance`、`ServiceOrders` 两个治理主题模型，使本地 Cube 不再是空容器。
- 新增 `scripts/generate-cube-dev-token.mjs` 与 `pnpm cube:token`，用于本地生成与 `CUBE_API_SECRET` 对应的 JWT。
- `cube` 的运行时 `.cubestore` 目录现在通过独立 volume 挂载，并加入 `.gitignore`，不再把中间缓存文件写回源码目录或 Git 视图。
- `.env.example`、本地 `.env`、`docs/local-infrastructure.md`、`Story 4.4` 与 `Story 4.5` 已统一到真实的 `cube` / `neo4j` 端口和启用方式。
- 已实际执行 `docker compose config`、拉起 `postgres / redis / cube / neo4j`，并验证：
  - `cube` 的 `/readyz`、`/cubejs-api/v1/meta`、`/cubejs-api/v1/load`
  - `neo4j` 的 `cypher-shell`
  - `neo4j` 的真实 smoke test：最小图谱写入后可返回真实候选因素
  - `pnpm db:migrate`
- `Story 4.7` 当前达到 `review` 条件；本地开发环境已经不再依赖纯环境变量占位来假装 Cube / Neo4j 已接入。

### File List

- _bmad-output/implementation-artifacts/4-7-local-compose-services-for-cube-and-neo4j.md
- _bmad-output/implementation-artifacts/4-4-cube-semantic-read-path-integration.md
- _bmad-output/implementation-artifacts/4-5-neo4j-graph-adapter-and-sync-baseline.md
- .env.example
- compose.yaml
- cube/conf/cube.js
- cube/conf/model/Finance.js
- cube/conf/model/ServiceOrders.js
- docs/local-infrastructure.md
- package.json
- scripts/generate-cube-dev-token.mjs
- .gitignore
- tests/story-2-1-compose-baseline.test.mjs
- tests/story-4-5-neo4j-smoke.test.mjs
- tests/story-4-7-compose-services.test.mjs

## Change Log

- 2026-04-03：完成 Story 4.7，正式把 Cube 与 Neo4j 纳入本地 Compose 基线，并补齐最小联调与文档对齐。
- 2026-04-03：补充 `cube` 运行时缓存隔离与 `.gitignore` 规则，并新增真实 `Neo4j` smoke test 作为 4.5 / 4.7 联调验真路径。
