# Java Architecture Baseline

> 状态：Baseline（2026-08-31）
> 适用范围：`backend-java` 后续新增代码与被当前需求触达的既有代码
> 实施状态：Java 架构基线与 M1-M6 已实施；Property Domain Pack、EasyV 第二 Domain Pack、通用 Capability/Follow-up 边界与 `ontology-java-multidomain-v2` 已落地。M6 已完成冻结 binding 的读契约、跨领域展示和失败投影验收。EasyV 使用 creator-owned scope、只读 facts adapter，并由 `dip3.easyv.enabled` 显式开关控制，默认不启用；生产部署与生产数据仍未知。
> 配套运行时基线：[Multi-domain Runtime Architecture](./multi-domain-runtime-architecture.md)；本文件同时保留历史阶段记录

## 1. 决策摘要

`backend-java` 继续采用**单 Maven artifact、单 Spring Boot 应用、package-by-feature 的 modular monolith**，不复制 `easyv-ai-java` 的 `api / bean / service` 多 Maven module 技术分层。

每个稳定业务 feature 在需要演进时，按以下职责形成内部边界：

```text
domain <- application <- adapter
                         ├── in: web / worker / scheduler
                         └── out: persistence / redis / cube / neo4j / erp / llm
```

其中箭头表示源码依赖方向：外层依赖内层，内层不依赖外层。

本基线的核心约束是：

1. 先按业务能力分包，再在 feature 内区分 domain、application、port 和 adapter；
2. `src/main/java` 是 Maven 标准目录，不代表架构风格；
3. Spring AI 是 LLM/Agent 技术 adapter，不是业务架构层；
4. 不建立全局 `bean`、`dto`、`service`、`repository` 大包；
5. 不为了目录整齐全量搬迁现有代码，只迁移当前需求真实触达的调用链；
6. 不在没有独立发布、数据所有权或团队边界之前拆 Maven module；
7. 架构规则必须最终由测试验证，不能只存在于 README。

## 2. 为什么不是传统三层多 Module

`easyv-ai-java` 当前有 `dtstack-api`、`dtstack-bean`、`dtstack-common`、`easyv-ai` 等 Maven module。这种组织方式适合其既有团队协作与公共 Bean/DTO 复用，但不能直接证明它更适合 Ontology Agent。

Ontology Agent 当前具有以下实际约束：

- API 与 Worker 共用同一套执行、租约、审计、Ontology version 和数据库事务语义；
- Analysis、Execution、Ontology、Follow-up 之间存在同步调用；
- 当前只有一个可部署 Java artifact：`ontology-agent-backend`；
- 第二个领域 EasyV 已接入，跨领域公共契约由 Property 与 EasyV 两个真实调用者共同验证；
- 当前问题是职责和依赖方向没有被固化，不是 Maven 构建隔离不足。

现在拆成多个技术 module 会迫使尚未稳定的内部模型变成公共 API，同时增加 Spring 装配、测试、版本和依赖管理成本。它不会自动消除 Service 过大、DTO 混用或领域硬编码。

因此，本项目采用：

> 逻辑模块先于物理模块；业务 feature 先于技术类型；稳定 Port 先于共享 Bean。

## 3. 当前源码评估

### 3.1 已有的正确基础

| 能力 | 当前证据 | 结论 |
|---|---|---|
| 单一 Java 运行时 | `backend-java/pom.xml`、`OntologyAgentApplication` | 保持一个部署单元 |
| Feature-first 组织 | `analysis/auth/execution/ontology/graphsync/followup` | 方向保留 |
| 出站 Port 雏形 | `EvidenceProvider`、`ConclusionProvider`、`GraphWriter`、`WakeupPublisher` | 优先复用 |
| Adapter 实现 | Cube/ERP/Neo4j/Redis 实现现有 Port | 不需要重建第二套集成框架 |
| 强执行边界 | Job lease、idempotency、event、snapshot、audit | 作为平台内核保留 |
| 数据库所有权 | Java Flyway 独立 migration profile | 不迁回 TypeScript |

### 3.2 当前尚未闭合的边界

#### Feature 内层次混放

例如 `analysis` 包同时包含 Controller、Service、业务模型、MyBatis Entity、Mapper 和具体 Repository。单纯放在同一个 feature 中不是错误，但源码没有表达哪些类型是公开用例、哪些是领域模型、哪些只能被持久化 adapter 使用。

#### 跨 Feature 直接依赖形成环

当前存在：

```text
analysis -> execution
execution -> analysis
execution -> tooling
tooling  -> execution
ontology -> tooling
tooling  -> ontology
```

这些依赖来自真实调用链，而不是目录扫描误判。例如 Worker 直接使用 Analysis repository 和 Tooling result，Workflow 又直接使用 Execution repository；Ontology 发布校验直接调用 `AnalysisWorkflow.validateCatalog`。

这说明当前 package-by-feature 尚未成为可独立验证的逻辑模块。

#### Repository 职责不一致

部分 `Repository` 只是 Mapper 包装；`ExecutionRepository` 则同时承担：

- Job payload 构造；
- execution contract；
- 幂等提交；
- lease 与状态迁移；
- event/snapshot/terminal transaction。

这些逻辑具有真实业务价值，不能机械拆散，但需要区分 application-facing Port、状态机协调和 MyBatis persistence adapter，避免后续领域直接依赖具体持久化类。

#### Spring AI Adapter 的领域归属已显式化

物业 `SpringAiMainAgent`、`SpringAiConclusionProvider` 与 `WorkflowToolInput` 已迁入
`property.internal.adapter.out.llm`；EasyV 的 `EasyVSpringAiMainAgent` 与 `EasyVToolInput`
位于 `easyv.internal.adapter.out.llm`。两者各自持有领域 entity、metric、claim 和 Tool Calling
语义，不被平台 Worker、Capability Registry 或另一领域复用；平台没有假定所有领域共享
prompt/claim 的“通用 Spring AI 业务适配器”。

### 3.3 本基线不宣称的内容

- 不宣称当前后端已经完全符合 Clean Architecture；
- 不因 README 写有“完全解耦”就把目标状态当成源码事实；
- 不要求已有 flat feature 包一次性迁完；
- 不把历史 TypeScript ontology seed 视为生产 Java runtime；它当前仅允许作为测试 fixture，不能形成运行旁路。

## 4. 目标包结构

第一层继续按 feature 划分；只有 feature 内部复杂度和当前改动需要时，才增加内部层次。

```text
com.dip3.ontologyagent
├── bootstrap                         Spring Boot 入口与 Bean 装配
├── analysis                          通用分析入口与 capability 调度
│   ├── api                           供其他 feature 使用的稳定契约
│   └── internal
│       ├── domain
│       ├── application
│       │   ├── port.in
│       │   └── port.out
│       └── adapter
│           ├── in.web
│           ├── in.worker
│           ├── out.persistence
│           └── out.llm               Spring AI / provider adapter
├── execution                         Job/Event/Snapshot/lease 平台能力
├── ontology                          Ontology 治理、发布与运行时读取
├── auth                              身份与平台授权能力
├── audit                             审计能力
├── graphsync                         图投影同步能力
├── property                          物业 Domain Pack
│   ├── api
│   └── internal
│       ├── domain
│       ├── application
│       └── adapter.out.{erp,cube,neo4j}
├── easyv                             EasyV Domain Pack（M5，默认关闭）
└── support                           真正横切的技术支持，禁止放业务规则
```

这是一份职责地图，不是本轮必须创建的空目录清单。没有类型就不创建目录，没有第二个实现就不创建抽象。

`bootstrap` 也是目标职责名，不要求本轮创建新包。现有根包启动类以及 `config/support` 在不改变运行行为前继续保留，只有被真实调用链触达时才迁移。

### 4.1 Feature 公共面

feature 根包不自动等于公共 API。跨 feature 调用只能依赖：

- `<feature>.api`；或
- 经过架构清单显式标记的 facade/contract；或
- application port 中有真实跨 feature 调用者的契约。

当前 `AnalysisService`、`AnalysisSessionRepository` 等 public 类型不因此自动成为稳定契约；它们在迁移前属于有记录的 legacy exception。新增内部类型放入 `internal`，不需要跨包使用时保持 package-private。

不得依赖其他 feature 的：

- `internal`；
- persistence Entity/Mapper；
- web Controller/Response；
- 具体 Redis/Neo4j/Cube/ERP/LLM adapter；
- 仅为实现方便暴露的 helper。

### 4.2 Feature 内依赖方向

```text
adapter.in.web / adapter.in.worker
                 |
                 v
       application use case
          |              ^
          v              |
        domain      port.out implementation
                         ^
                         |
        adapter.out.persistence / external system
```

规范化表达：

- Domain：不依赖 Spring、Servlet、MyBatis、Redis、Neo4j、HTTP Client；
- Application：依赖 Domain 与自身 Port，负责用例编排、权限策略、事务意图和失败语义；
- Inbound Adapter：把 HTTP/Worker/Scheduler 输入映射为 use case command；
- Outbound Adapter：实现 Port，处理数据库、消息、第三方 API 和模型 provider；
- Bootstrap：负责装配，不保存业务规则。

Application Service 可以使用最小的 Spring `@Service/@Transactional` 进行装配和事务声明，但其方法签名不得泄漏技术类型，Domain Service 不使用这些注解。暂不要求为追求“纯净”而手写全部 Bean 装配。

## 5. Java 类型规则

### 5.1 Transport DTO

只表达 HTTP/SSE 等外部协议：

```text
CreateAnalysisSessionRequest
AnalysisSessionResponse
ExecutionEventResponse
```

规则：

- 放在 inbound adapter 或明确的公共 API 包；
- Jakarta validation 只属于输入边界；
- Controller 不返回 MyBatis Entity；
- DTO 不进入 Domain；
- API 兼容由契约测试保护。

### 5.2 Application Command / Query / Result

表达一个用例的输入和结果：

```text
CreateAnalysisSessionCommand
SubmitAnalysisCommand
AnalysisExecutionResult
```

规则：

- 不包含 `HttpServletRequest`、`ResponseEntity`、MyBatis Wrapper 或 Neo4j Record；
- 必要时由 inbound DTO 显式映射；
- 不以一个全局 DTO module 共享所有领域对象。

### 5.3 Domain Model

规则：

- 使用业务名称，不带 `DTO`、`VO`、`Bean`、`Row`、`PersistenceEntity` 后缀；
- 优先不可变 record、value object 和明确 enum；
- 不带 `@TableName/@TableField`；
- 业务状态和不变量在 Domain/Application 表达，不在 Controller 或 Mapper SQL 中隐含；
- 不为仅有 getter/setter 的数据库行包装一层空洞 Domain Entity。

### 5.4 Persistence Entity

建议命名：

```text
AnalysisSessionPersistenceEntity
ExecutionJobPersistenceEntity
```

规则：

- 只存在于 persistence adapter；
- 允许 MyBatis 注解、JSONB handler、数组和数据库列语义；
- 不作为 API 返回值或跨 feature 契约；
- Mapper 只被对应 persistence adapter 使用；
- 老代码不因改名收益不足而批量重命名，新代码遵守该规则。

### 5.5 Port 与 Adapter

入站 Port 使用用例名称：

```text
CreateAnalysisSessionUseCase
SubmitAnalysisUseCase
```

出站 Port 使用业务所需能力名称：

```text
AnalysisSessionStore
ExecutionJobStore
OntologyCatalogReader
EvidenceProvider
WakeupPublisher
```

实现使用技术名称：

```text
MyBatisAnalysisSessionStore
RedisWakeupAdapter
CubeEvidenceAdapter
SpringAiAgentAdapter
```

不建立没有第二个实现、测试替身或真实隔离价值的 Port。现有 `EvidenceProvider`、`ConclusionProvider`、`GraphWriter`、`WakeupPublisher` 是优先复用起点。

### 5.6 `Map<String, Object>` 边界

允许：

- 原始 JSONB metadata；
- 尚未解析的外部 provider payload；
- UI render block 等明确开放结构；
- 审计中对原始输入的不可变快照。

不允许：

- capability request 的核心身份、scope、时间和版本；
- 领域事实、指标分子/分母、任务终态；
- claim 和 evidence reference；
- Action input、权限、确认和执行结果。

开放结构必须在进入业务决策前转为强类型，或由显式 schema 校验。

## 6. Spring AI 边界

Spring AI 负责：

- ChatModel/ChatClient provider 抽象；
- Tool Calling 协议；
- Advisor 与 Chat Memory；
- structured output 反序列化与 provider 能力适配。

Spring AI 不负责：

- Java 包和业务分层；
- scope 授权；
- Ontology 发布和 version pin；
- 指标计算；
- 跨库 Join；
- Job lease、幂等和审计；
- 领域 workflow 与 Action 状态机。

规范：

1. 新增 `ChatClient`、Advisor、`@Tool`、provider options 只能出现在 `<feature>.internal.adapter.out.llm`；
2. Main Agent 只消费已授权、已激活的 capability 描述；
3. Tool adapter 调用 application port，不直接调用 Mapper 或外部数据库；
4. 平台通用 Capability/Worker 不含 `project`、`collection-rate`、`spaceId` 等领域常量；领域自己的 LLM adapter 可以包含其受测试保护的领域常量；
5. 领域 claim schema 由 Domain Pack 提供，provider adapter 只负责调用和结构化传输；
6. 模型请求失败、Tool 未调用、输出不合约时 fail loud，不生成规则答案冒充模型成功。

当前 `ChatClient + Advisor + @Tool + deterministic workflow` 方向与 Spring AI 2.x API 一致；本基线只调整职责归属，不替换 Agent 运行模式。

## 7. 事务、权限与错误语义

### 7.1 事务

- Application use case 定义原子业务边界；
- persistence adapter 实现数据库细节；
- 现有 Job claim、lease、terminal event/snapshot 原子写入不可在迁移中拆坏；
- 外部服务调用不能伪装成同一数据库事务；
- Graph Sync 仍保持 PostgreSQL canonical facts、Neo4j rebuildable projection 的所有权边界。

### 7.2 权限

- Inbound adapter 只提取可信身份；
- Application/Domain policy 决定是否允许执行；
- Outbound adapter 的每次事实查询必须接收 resolved scope；
- 不允许把一个领域的 scope 字段强行复用为另一个领域字段；
- 数据库字段存在不代表调用者有权读取。

### 7.3 错误

- Domain/Application 定义稳定业务错误码和语义；
- Adapter 把 HTTP、SQL、Redis、Neo4j、Provider 异常映射为稳定错误；
- Controller/全局 handler 只负责协议呈现；
- 不吞异常、不返回默认值或伪成功；
- 迁移必须保持既有 API 错误码和用户可见语义。

## 8. 架构验证门禁

### 8.1 第一阶段 ArchUnit 规则

第一阶段只约束新建的 `..internal..` 规范包，不因历史 flat package 一次性失败：

1. `..domain..` 不依赖 Spring、MyBatis、Servlet、Redis、Neo4j；
2. `..application..` 不依赖 `..adapter..`；
3. `..adapter.in..` 不依赖 `..adapter.out.persistence..`；
4. `..internal..` 下新增 `*PersistenceEntity` 只能位于 persistence adapter；历史 flat package 的 `*Entity` 暂不纳入；
5. feature 外部不得依赖另一个 feature 的 `..internal..`；
6. 新增 Spring AI import 只能位于 `..internal.adapter.out.llm..`；M3 已消除原 legacy exception，不再允许 flat legacy package 引入 Spring AI；
7. `property` 与 `easyv` 不得相互依赖。

第二阶段在既有调用链迁移后逐步消除基线例外，禁止通过扩大白名单让违规长期存在。例外清单必须记录源码路径、原因、负责人和退出阶段。

M1/J1 初始 legacy exception（均已在 M3/J3 退出）：

| 源码路径 | 原因 | 负责人 | 退出阶段 |
|---|---|---|---|
| `agent/SpringAiMainAgent.java`（含 `$BoundWorkflowTool`） | 已迁入 `property.internal.adapter.out.llm` | Java backend maintainer | 已退出 |
| `agent/SpringAiConclusionProvider.java` | 已迁入 `property.internal.adapter.out.llm` | Java backend maintainer | 已退出 |
| `tooling/WorkflowToolInput.java` | 已迁入 `property.internal.adapter.out.llm` | Java backend maintainer | 已退出 |

ArchUnit 第一阶段允许规则在当前尚无 `..internal..` 类时为空匹配；这表示门禁已建立，不表示历史 flat package 已符合 Clean Architecture。M2/M3 新增规范包后，规则必须实际检查新增类型，禁止通过扩大 exception 规避失败。

`FEATURE_INTERNALS_ARE_PRIVATE_TO_THEIR_FEATURE` 以新 `..internal..` 类型为被访问目标，同时会拒绝 legacy flat package 或其他 feature 反向依赖这些内部类型；这是对新边界的单向保护，不表示 legacy caller 已完成迁移。

### 8.2 行为门禁

- Java 单元与 Testcontainers 测试通过；
- Web/Java JSON Schema、Zod 和透明代理契约通过；
- API JSON、状态码、错误码不变；
- Session/Job/Event/SSE 不变；
- ontologyVersion 提交时 pin，不在 Worker 中漂移；
- lease、幂等、attempt 与 terminal transaction 不变；
- 物业收费率能力结果与拒绝路径不变；
- 无 live 环境证据时不得宣称生产验证通过。

实施后的可复现门禁至少包括：

```bash
mvn -f backend-java/pom.xml test
pnpm test:web
pnpm lint
pnpm build
```

ArchUnit 测试类为 `backend-java/src/test/java/com/dip3/ontologyagent/architecture/ArchitectureRulesTest.java`，随默认 Maven test lifecycle 执行，不建立单独 profile。J0 文档本身不构成实现证据；以测试类存在且 Java 21 下测试通过为准。

### 8.3 M1 实施证据（2026-08-29）

- `archunit-junit6:1.5.0` 已作为 test-scope 依赖进入默认 Maven test lifecycle；
- `ArchitectureRulesTest` 实现 9 条规则，当前只约束新 `..internal..` 边界、跨领域依赖和 Spring AI 新增依赖；
- `PropertyCapabilityContractTest` 以 4 条测试冻结当前物业 capability identity、完整 catalog metadata 和漂移拒绝语义；
- Java 21 定向门禁：13 tests，0 failures，0 errors；
- Java 21 物业主链 characterization：67 tests，0 failures，0 errors；覆盖 `AnalysisWorkflow`、Main Agent、Conclusion Provider、Worker 与 Analysis Service；
- 默认全量 `mvn test` 已启动并确认 Testcontainers 可连接本机 Docker；首次拉取 `neo4j:5.26.12-community` 长时间未完成后人工中止，因此本记录不宣称全量 Testcontainers 门禁通过；
- `pnpm test:web` 未进入测试执行：本机依赖未完整安装，registry 多次断连后人工中止；M1 未修改 Web/API 契约，此项仍作为后续全量验证缺口保留；
- 本阶段未连接 EasyV 开发库、未调用 live LLM provider、未改变 API/Job/SSE/数据库 schema 或运行行为。

可复现的已通过命令：

```bash
mise exec java@21.0.2 -- mvn -f backend-java/pom.xml \
  -Dtest=ArchitectureRulesTest,PropertyCapabilityContractTest test

mise exec java@21.0.2 -- mvn -f backend-java/pom.xml \
  -Dtest=ArchitectureRulesTest,PropertyCapabilityContractTest,AnalysisWorkflowTest,SpringAiConclusionProviderTest,SpringAiMainAgentTest,AnalysisWorkerTest,AnalysisServiceTest test
```

本机当次使用临时 Maven Central 镜像设置绕过下载 EOF；该设置位于 `/tmp`，不是项目配置，也不是运行时依赖。

### 8.4 M2 实施证据（2026-08-30）

- 新增 `capability.api` 公共 Port，以及 `capability.internal.application` 静态 Registry；Property 通过 `property.internal.application` 注册，新的 `..internal..` 已被 M1 ArchUnit 实际扫描；
- Job 在提交时固定 `domainKey/capabilityKey/ontologyVersionId/resolvedScope`，Worker 以 pinned Catalog 与 trusted principal 重新校验；缺失、歧义、未注册、版本漂移与 scope 篡改均 fail loud；
- 通用 result/evidence envelope 绑定同一 capability 与 `scopeSnapshotRef`，Worker 依据 descriptor 校验 evidence type 与 claim kind，不再写死物业终态证据集合；
- Property Provider 的 claim 保留 `kind`，完整 capability binding 进入 agent audit、terminal event 与 completion result；
- Flyway `V2__bind_java_analysis_jobs_to_property_capability.sql` 只回填满足旧 Java Job 契约的合法记录且不覆盖已有 binding；异常旧记录不生成伪 binding，claim 时按既有失败链路显式失败；
- Java 21 M1+M2 定向门禁：67 tests，0 failures，0 errors；
- PostgreSQL 17.8 Testcontainers：`DatabaseMigrationServiceTest,MybatisPersistenceTest` 共 14 tests，0 failures，0 errors；
- M2 未连接 EasyV 开发库、未注册第二领域，也未改变 HTTP/SSE、Job 表结构或既有 execution contract 字符串。

可复现命令：

```bash
mise exec java@21.0.2 -- mvn -f backend-java/pom.xml \
  -Dtest=ArchitectureRulesTest,PropertyCapabilityContractTest,StaticCapabilityRegistryTest,CapabilityEnvelopeTest,PropertyCapabilityRegistrationTest,AnalysisServiceTest,AnalysisWorkerTest,AnalysisFollowUpServiceTest,SpringAiConclusionProviderTest,AnalysisWorkflowTest,ExecutionRepositoryTest test

mise exec java@21.0.2 -- mvn -f backend-java/pom.xml \
  -Dtest=DatabaseMigrationServiceTest,MybatisPersistenceTest test
```

### 8.5 M3 实施证据（2026-08-30）

- 物业 policy、runtime capability、workflow、ERP/Cube/Neo4j/LLM adapter 已归入 `property.internal`，平台生产代码不反向依赖 Property internal；
- Worker 的 Tool 类型、名称、精确调用次数、审计标签和 completion metric 来自 capability descriptor；Property descriptor、真实 `@Tool`、prompt 与 invocation audit 共用同一编译期契约；
- Worker 对成功/失败 snapshot、terminal event、agent audit 与 completion result 保存同一冻结 `CapabilityBinding`，并校验 capability result 的 binding 与 `scopeSnapshotRef`；
- `V3__persist_capability_binding_snapshots_and_follow_ups.sql` 为历史 snapshot/follow-up 显式回填 `legacy/unknown`，新写入列 `NOT NULL` 且无默认值；漏写不会被数据库伪装成兼容成功；
- Follow-up 依据来源 execution 的持久化 binding 分派 Domain Policy；平台只保留 ownership、事务、幂等、快照和 dispatch，物业问题解析、项目范围、上下文、调整与重规划均在 Property Domain Pack；
- legacy source 在创建新追问时以 `FOLLOW_UP_CAPABILITY_BINDING_MISSING` fail loud；根追问与多轮追问继承原 domain/capability/ontology/scope，不重新选择能力；
- Java 21 核心 M3 定向门禁：125 tests，0 failures，0 errors；
- Java 21 `clean test` 全量门禁：44 个测试类、256 tests，0 failures，0 errors，0 skipped；
- PostgreSQL 17.8 Testcontainers 中 `AnalysisFollowUpPersistenceTest`：6 tests，0 failures，0 errors；V1→V2→V3 与其他 persistence 门禁由全量 Maven 测试统一复核。

### 8.6 M4-M6 当前实施证据（2026-09-01）

- M4 已完成 EasyV 开发库只读核验：源码、开发数据与生产未知项分开记录；开发库当前连接角色权限较高，只有显式 development override 才允许绕过角色门禁，查询仍运行在 PostgreSQL READ ONLY 事务内，未执行写操作。生产权限、部署版本和数据完整性仍未知。
- M5 已落地 EasyV 第二 Domain Pack：`easyv/generation-quality-analysis`、creator-owned scope（仅可信正数 `userId`，snapshot 为 `userId + accessMode=creator-owned`）、typed facts、确定性 workflow、证据/claim contract、follow-up 时间范围策略和 Spring AI 一次 Tool Call adapter。
- EasyV facts adapter 仅以聚合事实跨边界，四类 source 为 `easyv-ai-application`、`easyv-pipeline-node`、`easyv-forge-task`、`easyv-generation-feedback`；部分耗时缺失会披露覆盖率，全量缺失才明确失败，不以默认 0 伪装完整数据。
- `CanonicalOntologyBaseline`/bootstrap 已发布 `ontology-java-multidomain-v2`（`2.0.0`），保留已 pin 的 v1 读取兼容；EasyV runtime 由 `dip3.easyv.enabled=true` 显式启用，默认不影响旧 Property 启动。
- M6 已将冻结的 capability binding 投影到 session aggregate 与 workspace home；完成态前端契约严格校验 Property/EasyV 的 domain、capability、ontology version、scope、plan、evidence source 与 claim kind，不允许以 `legacy/unknown` 冒充完成态。
- 工作台分析页已展示 domain、capability、ontology version、scope、plan、evidence、freshness、coverage、failure code、trace 与 failure point；EasyV 四类证据均投影真实 `freshnessAt`，不以默认值伪装新鲜度。
- `V4__backfill_capability_binding_snapshots_from_jobs.sql` 只在 execution/session/owner/version/scope/contract 均可证明一致时修复历史 binding；冲突、畸形或证据不足的数据继续保留 `legacy/unknown`。
- `LiveEasyVProviderIT` 已真实执行 Session → Registry → Job → Worker → Spring AI Tool Call → EasyV test PostgreSQL → Snapshot，验证精确一次 Tool Call、四类 evidence、五类 claim、freshness 和冻结 binding。首次运行同时暴露并修复了单日 ISO 问题与日期解析契约不一致。
- Java 21 全量测试 312/312、EasyV live gate 1/1、Web 契约与故事测试 50/50（另有 5 个容器 smoke 按约定跳过）、TypeScript、lint 与 Next.js production build 均通过；这证明源码、契约及 EasyV test 环境链路闭环，不代表生产验证完成。

## 9. 渐进迁移顺序

### J0：架构基线

- 本文成为新增和触达代码的规范；
- 建立 source-indexed 当前例外清单；
- 不搬文件、不改变运行行为。

### J1：架构门禁

- 引入最小 ArchUnit 测试；
- 只约束新规范包和明确不能新增的依赖；
- 当前例外必须有来源、负责人和退出条件。

### J2：通用 Capability 边界

- 这是后续 Multi-domain runtime 迁移阶段，不是 J0/J1 的目录整理要求；
- 按 [Multi-domain Runtime Architecture](./multi-domain-runtime-architecture.md) 建立最小 Port；
- 把通用执行 envelope 与物业 request/result 分离；
- 通用 Worker 和 Main Agent 不再校验固定物业 evidence/claim；
- 保持所有外部 API 与执行协议不变。

### J3：Property Domain Pack

- 将当前物业 validator、scope、workflow、evidence 和 conclusion 归入 Property feature；
- 首先委托现有实现，不重写指标算法；
- 所有既有测试作为 characterization/regression gate；
- 只有物业行为完全等价后才允许接第二个 Domain Pack。

### J4：EasyV Domain Pack（历史阶段记录，已完成）

- 已完成 EasyV P0/P1 数据契约、只读事实验证与 Domain Pack 实现；
- 不复用物业 project/area scope；
- 不修改已稳定的平台执行内核；开发库验证仅作为环境观测，不能替代生产验证。

## 10. Maven Module 拆分触发条件

只有出现至少一个经过验证的现实条件时才提议拆 module：

1. 需要独立发布或独立扩缩容；
2. 形成独立数据库/schema 所有权，不再共享本地事务；
3. 团队与代码所有权稳定分离；
4. 跨 feature 调用已经冻结成版本化 API/Event；
5. 重型依赖必须从主运行时物理隔离；
6. 单 module 构建时间或依赖冲突已成为持续可观测的交付瓶颈。

即便触发，也按业务能力拆分，不创建仅装 DTO/Bean 的共享 module。

## 11. 非目标

- 不全量迁包或批量改名；
- 不引入动态插件、classloader 或远程扩展市场；
- 不引入全局 BaseService/BaseRepository；
- 不把所有 record 包装成领域实体；
- 不重写稳定的 Graph Sync、认证或 execution 状态机；
- 不因为 Spring Modulith 可用就立即增加运行时依赖；
- 不把开发库观测当作生产验证结论。

## 12. 外部标准参考

- Spring Boot 不要求固定代码布局，并建议使用根包及按领域约束结构：<https://docs.spring.io/spring-boot/reference/using/structuring-your-code.html>
- Spring AI Tool Calling 明确由应用拥有工具执行和安全边界：<https://docs.spring.io/spring-ai/reference/api/tools.html>
- Spring AI 的 effective agents 指南区分确定性 workflow 与动态 agent：<https://docs.spring.io/spring-ai/reference/api/effective-agents.html>
- Spring Modulith 可在未来用于逻辑模块验证，但不是本阶段前置依赖：<https://docs.spring.io/spring-modulith/reference/>

## 13. 源码索引

- `AGENTS.md:29-34`：项目声明的 Clean Architecture / Domain-first 规则；
- `CLAUDE.md:24-32`：当前 Java package-by-feature 说明；
- `README.md:40-59`：当前运行形态与架构目标；
- `backend-java/pom.xml:5-108`：单 artifact、Spring Boot/Spring AI/MyBatis/Redis/Neo4j 依赖；
- `backend-java/src/main/java/com/dip3/ontologyagent/OntologyAgentApplication.java`：单应用入口；
- `backend-java/src/main/java/com/dip3/ontologyagent/analysis/AnalysisController.java:32-145`：HTTP、认证、重定向和 SSE adapter；
- `backend-java/src/main/java/com/dip3/ontologyagent/analysis/AnalysisService.java:21-113`：Analysis 用例与 execution/ontology 依赖；
- `backend-java/src/main/java/com/dip3/ontologyagent/analysis/AnalysisSessionRepository.java:13-45`：具体 MyBatis repository；
- `backend-java/src/main/java/com/dip3/ontologyagent/execution/ExecutionRepository.java:17-168`：持久化、幂等、lease 和状态迁移边界；
- `backend-java/src/main/java/com/dip3/ontologyagent/execution/AnalysisWorker.java:30-215`：Worker 编排与物业结果验证；
- `backend-java/src/main/java/com/dip3/ontologyagent/tooling/Evidence.java`：M8 evidence provenance 外壳，完成态必须冻结 Ontology/Dataset Version；
- `backend-java/src/main/java/com/dip3/ontologyagent/tooling/EvidenceProvider.java:1-6`：现有 evidence port；
- `backend-java/src/main/java/com/dip3/ontologyagent/tooling/ConclusionProvider.java:1-7`：现有 conclusion port；
- `backend-java/src/main/java/com/dip3/ontologyagent/graphsync/GraphWriter.java:1-7`：现有 graph writer port；
- `backend-java/src/main/java/com/dip3/ontologyagent/execution/WakeupPublisher.java:1-5`：现有 wakeup port；
- `backend-java/src/main/java/com/dip3/ontologyagent/agent/SpringAiMainAgent.java:30-360`：Spring AI adapter、物业能力、Tool adapter 与审计失败语义当前混合点；
- `backend-java/src/main/java/com/dip3/ontologyagent/agent/SpringAiConclusionProvider.java:25-114`：provider 与物业 claim 当前混合点；
- `backend-java/src/test/java/com/dip3/ontologyagent/architecture/ArchitectureRulesTest.java`：J1/M1 新增架构依赖门禁；
- `backend-java/src/test/java/com/dip3/ontologyagent/tooling/PropertyCapabilityContractTest.java`：物业 capability 与 catalog characterization gate；
- `docs/java-backend-phase-3-operational-closure.md:7-13`：保留 package-by-feature、Java runtime ownership 的既有决定。
