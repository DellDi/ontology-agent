# 前端能力承接与界面升级计划

日期：2026-09-08。基线：32213aa。目标：业务用户能发现已有分析、理解当前进度、追溯结论的数据出处。沿用现有 Workbench 组件与主题；业务能力、授权和执行规则继续由 Java 持有。

## 设计问题补充与执行优先级（用户补充后更新）

用户反馈：UI 普通、AI 模板感浓、布局凌乱、信息没有重点，功能与信息堆砌，缺乏专业感。将信息架构调整提升为 P0，先于新增能力入口执行。上一轮仅修正文案和收起契约面板，不能视为整体设计完成。

设计约束：

- 一个页面一个主任务。首页是“发起 / 找回分析”，详情是“阅读当前问题的结论”。
- 不将欢迎语、统计、权限、诊断都做成同等权重的卡片；去除无任务价值的眉题、装饰标签与重复说明。
- 主层显示问题、进度、结论；次层显示历史、证据；版本、日志与排障信息按需展开。
- 色彩服务状态与主操作，不用大面积品牌色模拟 AI 聊天气泡；沿用现有主题和组件。
- 同一会话只出现一次；统计必须能帮助定位会话；只显示具备真实内容的详情入口。

本轮实施：

1. 工作台两项导航改为横向排列，管理后台保留原侧栏。
2. 首页去掉欢迎卡、统计卡与重复失败列表，仅保留一个输入区与行式会话列表；领域、日期、状态降为辅助信息，不在列表里重复长结论。
3. 状态数量改为可点击筛选（全部 / 进行中 / 待处理 / 已完成），增加问题和领域搜索、无匹配结果与清除筛选。筛选仅针对已加载的后端授权记录。
4. 分析问题改为报告标题，结论获得完整阅读宽度；完成结果之后再呈现冻结出处。
5. 抽屉入口由实际提供的内容决定，移除当前 Java 页面未提供内容的“背景信息 / 可能原因 / 分析计划”空入口。计划仍可在分析依据中查看。
6. 有执行结果时历史通过抽屉访问，移除重复的底部长历史；准备中的多轮分析保留折叠历史入口。

验收重点：首屏单一主操作、会话不重复、状态搜索可组合、空态可恢复、标题与正文层级清晰；窄屏不横向溢出，键盘可操作，深浅主题可读。视觉验收与服务集成验收分别记录。

## 当前证据与缺口

| 后端已有能力 / 代码证据 | 前端缺口 | 优先级 |
| --- | --- | --- |
| `WorkspaceHomeResponse.LatestExecution.capabilityBinding`；多领域投影提交 30674c3 | 首页丢弃领域绑定，仍写“仅支持物业”，历史混排无法识别领域 | P0 |
| `read-client.ts` evidence 契约已要求 `freshnessAt`、`datasetVersionSetId`、`ontologyVersionId`、`productVersionIds`；提交 32213aa | 证据面板仍扫描行字段猜时间，未显示冻结数据出处 | P0 |
| 详情已有结果流、计划和运行诊断 | 完整技术面板排在对话结果之前，阅读成本高 | P0 |
| `StaticCapabilityRegistry` 选择能力，`EasyVScopeResolver` 检查可信用户与角色，EasyV 受配置开关控制 | 首页创建按钮依赖物业项目范围；首页读接口没有可用能力清单 | P1 |
| ingestion 已有 Catalog、Orchestrator、DatasetVersionSetRegistry 及发布/运维入口 | Web 尚无数据接入路由和菜单，需先定义正式管理读接口与操作授权 | P2 |

以上为本次源码核查；不代表各领域在部署环境已可运行。

## 第一批：现有契约内的展示闭环（上一轮实施，布局由上文更新）

- 首页顺序调整为欢迎与范围 → 问题输入 → 会话统计 → 失败待处理 → 最近分析。
- 删除重复的“新建分析 / 最近分析”能力卡，去除未来故事和逐步接入等过时文案。
- 输入保留原 POST、错误与草稿回显，增加原生必填校验，保留 300 字限制。
- 将首页 API 的能力绑定传入 read-model，显示“物业分析 / EasyV 生成质量”；未知绑定明确显示“领域待确认”，不猜测。
- “运行时契约”改为可通过键盘操作的原生 details/summary“分析依据”，默认收起，failed/dead_letter 自动展开。
- 数据更新时间直接读取 evidence.freshnessAt；展示每类证据的冻结数据集、本体及数据产品版本，保留计划、范围、覆盖情况与追踪诊断。
- 不变更后端接口、权限判断、创建流程、执行流程或迁移脚本。

验收：当前 Web 契约套件、类型检查、lint、生产构建；通过真实组件 + 契约样例检查窄屏、桌面与深色主题。样例预览不进入正式路由。

## 第二批：多领域入口闭环（代码已实施，真实业务环境联调待验收）

1. Java 首页读模型基于实际注册能力与授权解析返回当前用户可发起的能力及范围说明；明确不可用原因，不能仅靠前端角色硬编码判断服务启用状态。
2. 同步 JSON Schema、Zod、fixtures；Web 透明投影能力入口、示例问题、范围说明与不可用状态。
3. 沿用现有能力选择规则；如果产品需要显式能力选择，再同步设计创建请求，不自行往表单添加后端不消费的字段。
4. 消除 `hasScopedTargets` 对 EasyV-only 用户的错误阻断，同时保持 Property 范围校验；整理范围弹层的领域语义。
5. 验证 Property-only、EasyV-only、双领域、无授权、EasyV 未启用五种情况，覆盖创建失败、执行失败和追问轮次的领域/证据一致性。

完成标准：真实登录用户从首页发现可用能力，创建并完成对应分析；当前执行及历史轮次展示一致，无跨领域范围混用。

## 第三批：数据接入与运维体验（读写链路已实施，真实环境待验收）

1. 先补 Java 正式管理读接口：数据源/数据集/产品目录、接入任务状态、失败原因、已发布版本集与血缘；按管理权限和组织范围裁剪。
2. Web 增加“数据接入”入口，先做目录、任务详情和版本出处的只读查询；复用表格、状态、空态、错误组件。
3. 发布、重跑、RECONCILE 等写操作在 Java 明确权限、审计与失败语义后接入；不从页面执行 CLI，不泄露源库凭据。
4. 加入真实任务失败 → 定位原因 → 修复后重跑 → 版本发布 → 分析引用的验收。

## 本次验证结果与边界

- Web 当前门禁套件：58 项，53 通过、5 项容器测试按开关跳过、0 失败。
- 新增/增强回归：Property/EasyV/未知领域投影；无项目范围原有创建限制；完成态默认折叠、失败态默认展开；顶层 freshnessAt 优先于行内旧时间；冻结数据集与产品版本可见。
- TypeScript、ESLint、Next 生产构建通过。
- 浏览器：契约样例渲染实际 HomeShell 和 RuntimeContractPanel；检查 390px 窄屏、1280px 桌面，无横向溢出；窄屏浅色/深色截图检查；点击展开可读到版本出处。
- 预览仅用于组件验收，未连接实际 Java API，也没有运行真实分析或验证生产部署。当前本机未监听 3000/8080 应用端口。
- pnpm 在本机报 `packages field missing or empty`（现有 pnpm-workspace.yaml 只有 allowBuilds）。本次用 `mise exec node@24 -- node` 调用已安装工具运行对应门禁；未顺带修改工作区配置。
- 无 Java/schema 修改，因此未运行 Java 测试或数据库迁移。

复现检查：

```sh
mise exec node@24 -- node node_modules/typescript/bin/tsc --noEmit
mise exec node@24 -- node node_modules/eslint/bin/eslint.js
mise exec node@24 -- node node_modules/next/dist/bin/next build
mise exec node@24 -- node --conditions=react-server --import tsx --test tests/java-backend-contract.test.mjs tests/java-mobile-view-model.test.mjs tests/java-governance-contract.test.mjs tests/story-2-6-worker-skeleton.test.mjs tests/story-4-7-compose-services.test.mjs tests/story-7-3-container-deployment.test.mjs tests/story-m6-runtime-contract-projection.test.mjs
```


## 本轮设计调整验证

- 新增状态组合搜索与可用详情入口渲染回归。
- 浏览器使用实际 React 组件的可交互独立预览；契约样例加明确标注的进行中/失败测试记录，不访问或修改真实数据。
- 已验证“待处理”仅显示失败记录、与 EasyV 搜索组合出现空态、清除筛选恢复全部记录；390px 无横向溢出。
- 已检查首页与结果阅读层级，深色主题；结果预览验证标题 → 结论 → 折叠出处。预览未涵盖实际 SSE、登录与后端执行。
- 后续多领域能力入口与数据接入管理仍按第二、三批推进，未混入本轮展示调整。
- 最终门禁：60 项测试，55 通过、5 项容器测试跳过、0 失败；ESLint 与 Next 生产构建（含 TypeScript 检查）通过；`git diff --check` 通过。
- 本轮没有新增第三方依赖，未提交或部署代码。


## 第二批实施记录（2026-09-08）

### 改动边界

- Java `CapabilityRegistry.availableFor(principal)` 从实际注册项生成首页能力状态，调用领域原有 `resolveScope / validateScope`，不重复实现角色判断。只把已知授权拒绝转为不可用原因，其他异常继续向上抛出。
- `WorkspaceHomeResponse.capabilities` 必填，包含领域、能力、名称、可用状态、不可用原因、示例问题及已解析范围。不可用项不返回范围，未注册能力不列出。示例由对应 Domain Pack 提供，并通过现有问题选择器验证。
- 可用状态只代表当前能力已注册且用户获授权，不代表本体已发布、数据产品已就绪或执行一定成功；这些仍由提交/执行链路校验。
- Web 只消费后端状态，去掉物业项目范围对首页创建入口的限制。授权范围改为按能力展开，EasyV 显示当前创建者范围，Property 显示项目/区域数量。
- 单一问题输入区保留：示例按钮填入问题并聚焦，不自动提交，也不向创建请求添加 `capabilityKey`。原始问题选择、后续绑定、追问和执行边界不变。
- JSON Schema、Zod、fixture 同步；新范围投影复用既有领域范围校验。缺少能力字段、可用状态与范围矛盾、错误范围结构均拒绝。
- 创建失败时继续保留错误/trace 和草稿；无可用能力时不显示输入提交入口，空历史不再提示用户去不存在的输入框操作。
- 没有新增配置、依赖、数据库变更或兼容层。

### 验证与发布

- Java 全量：395 项通过，0 失败、0 错误、0 跳过，包含 Testcontainers 持久化测试及既有执行/追问回归。
- 新增 Spring 上下文测试使用真实 Property/EasyV 注册与 scope resolver（执行 Agent 和查询 Mapper 为 mock），覆盖 Property-only、EasyV-only、双领域、无授权、EasyV 未启用，以及不合法 EasyV 用户 ID；验证首页投影及示例问题命中正确领域。非授权错误不会被伪装成不可用。
- 浏览器实际组件交互预览：EasyV-only 无项目也能看到输入与示例；点击示例后内容替换并聚焦，页面不提交；展开可见创建者范围与 Property 拒绝原因；无可用能力无提交入口。
- 预览使用明确标注的契约样例，并非真实业务数据。未执行真实账号登录到分析完成的端到端场景，未部署。
- 首次全量测试因 OrbStack 未启动而产生 17 个环境错误。启动 OrbStack 后，通过进程级 `DOCKER_HOST=unix:///Users/dsy/.orbstack/run/docker.sock` 成功重跑；未改全局 Docker/Testcontainers 配置。
- 首页严格响应契约已变化，Web 与 Java 必须作为同版本配套发布；不能将旧 Web 与新 Java 混用。
- 第三批数据接入管理不在本轮范围。当前工作区保留前两轮 UI 改动，尚未提交。

Java 全量复现（本机 OrbStack）：

```sh
DOCKER_HOST=unix:///Users/dsy/.orbstack/run/docker.sock mise exec java@temurin-21.0.12+8.0.LTS -- mvn -f backend-java/pom.xml test
```

第二批最终门禁：Web 62 项（57 通过、5 项容器构建/部署测试按配置跳过、0 失败）；Next 生产构建及 TypeScript、ESLint 通过；Java `package -DskipTests` 通过，全量测试结果见上文 395 项。`git diff --check` 通过。Web/Java 源码与严格契约已闭环，真实业务账号端到端与同版本部署仍待环境验收。

## 第三批第一步：数据接入只读管理（2026-09-12）

### 已实施范围

- 新增 `/admin/ingestion`，平台管理员可从管理导航进入。接入任务、数据目录、冻结版本分为三个视图，保持单一阅读重点，详情通过原生折叠展开。
- 接入任务展示最近 50 条采集/物化任务，支持范围内的状态筛选与名称、任务编号、错误码搜索；失败详情保留错误码、任务编号、关联编号和开始/结束时间。刷新重新读取后端，没有自动重试或模拟状态。
- 数据目录展示真实登记的数据源、数据集与产品输入关系，包含停用项；启用状态不被解释为连接或数据就绪。
- 最近 20 个版本集展示状态、产品版本、行数、物化任务、源数据版本与采集任务，直接来自持久化 lineage。草稿/撤销状态也明确标识。
- Java 新增 `GET /api/admin/ingestion/overview`，通过应用服务授权、只读查询端口与 PostgreSQL adapter 实现。一次 repeatable-read 事务读取目录、任务及版本关系，无逐条 N+1 查询。Web 仅透明代理和严格契约渲染；OpenAPI、JSON Schema、Zod、fixture 与测试门禁同步。
- **授权边界调整依据**：现有 ingestion 控制面表没有组织归属列，属于平台目录；本轮仅允许既有 `PLATFORM_ADMIN` 查看，响应明确 `scope=platform`。领域分析/本体治理角色不能访问，不根据当前组织伪造数据隔离。组织级管理授权仍需独立设计归属契约后实施。
- 查询字段排除 connection_ref、原始 error_detail、snapshot_context、源行数据等，避免把连接异常内的 SQL/凭据带到浏览器；用任务与关联编号对照服务日志诊断。
- 加载失败与无数据分开：后端异常返回错误，页面提供明确失败提示及重新加载；不会伪装成空目录。
- 未改数据库 schema、接入执行/游标/物化/发布契约，未新增运行时依赖。

### 验证结果

- Java 全量 401 项通过，0 失败、0 错误、0 跳过；`package -DskipTests` 通过。
- 新增 HTTP 权限/错误测试：未登录 401、领域与治理角色 403（多个组织）、平台管理员 200、数据库异常 500，拒绝请求不会读取目录。
- 复用真实 Testcontainers 发布流程验证管理查询：冻结版本 → 产品版本 → 源版本 → 采集任务；50 条任务/20 个版本集上限、停用目录、草稿和空任务；原始敏感错误详情不被序列化。
- Web 门禁 63 项：58 通过、5 项容器专项按配置跳过、0 失败。新增双契约测试验证溯源字段、拒绝未知状态/错误日期/遗漏字段/敏感字段。
- TypeScript、ESLint、Next 生产构建通过。浏览器使用实际 React 组件与契约样例，验证搜索空态、状态筛选、目录展开、失败详情、版本溯源及桌面/390px 窄屏阅读。
- 浏览器检查是组件级样例，不是实际业务账号联调；真实账号访问、真实业务失败修复后重跑、重新发布到分析引用的完整流程未验证，未部署或提交。

### 仍待后续实施

- 管理页面发布、重跑、RECONCILE 等写操作仍需正式的 Java 权限、审计、幂等及失败语义设计；当前继续使用既有运维入口。
- 组织级数据接入授权及历史任务/版本分页查询不包含在本次只读窗口中。第三批完整运维闭环尚未完成。

## 合并实施：发布执行与前端操作闭环（2026-09-12 至 2026-09-13）

本轮将第三批剩余工作合并为两个交付部分：Java 发布任务执行，以及 Web 提交/重跑/反馈。延续平台管理员边界；组织级接入授权、历史分页、RECONCILE 不在此次范围。

### Java 发布任务

- 新增 `ingestion.release_tasks` 与 V11 迁移，持久化原始源/产品/模式、提交人、组织审计上下文、请求追踪号、原失败任务和状态时间。沿用项目无迁移历史补全场景，建表和索引可重复执行，旧迁移文件不变。
- 管理 API 提供任务列表、单条查询、创建和失败重跑。写请求返回 202，表示已持久化受理；只有完成采集、物化并冻结版本，任务才成为 completed。
- `Idempotency-Key` 使用标准 UUID，同时作为任务与版本集编号。同一用户和组织、相同请求参数重复提交返回原任务；更换参数或提交者返回冲突。服务端验证数据源、产品、输入归属和已注册 transform，拒绝跨源产品混合发布。
- Worker 直接调用现有 `DatasetReleasePublisher`，不启动 CLI、不重写游标或物化协议。沿用 `dip3.worker.enabled`/poll-delay；长操作在虚拟线程运行，避免阻塞共享调度器中的分析和 lease 心跳。
- Web 发布任务通过 PostgreSQL session advisory lock 串行执行，多实例不会同时领取同一请求；锁占用一个独立连接，但不持有长事务。此入口依赖项目当前直接连接 PostgreSQL 的部署方式，不能放在 transaction-pooling 连接代理后。
- 上次执行中断时，先核对已冻结版本：若发布已提交则补记完成；否则关闭该任务关联的未完成采集/物化记录，并保留明确失败。失败不会自动执行第二次；用户重跑会创建新任务并保留 retryOf。
- 提交、开始和终态与 `platform.audit_events` 在同一事务写入，保留 180 天审计期限。浏览器只接收错误码和追踪信息，不接收凭据、会话或原始连接异常内容。

### Web 操作

- 默认视图改为“发布任务”，采集/物化明细、目录和冻结版本作为次级视图。
- 新建发布可选择数据源、产品和全量/增量模式，展示操作影响后明确提交。修复后的重跑沿用服务端原参数，不覆盖原失败记录。
- 提交中禁用重复操作；响应中断时保留配置和请求编号，再次提交复用原请求。相同重跑按钮再次点击也复用请求；用户主动新建发布时创建新请求编号。
- 活跃任务每 3 秒更新；查询失败显示错误并停止更新，不伪装成空数据。切换视图保留任务和表单状态。
- 完成任务通过新的页面请求读取版本溯源，避免查看提交前的旧 overview。列表明确限定为最近 50 个发布任务，版本视图保留最近 20 个版本集。
- 同步 OpenAPI、JSON Schema、Zod、fixtures 和透明代理路由；新增契约测试纳入现有 test:web 门禁。

### 验证与交付边界

- Java 报告 411 项通过，0 失败、0 错误、0 跳过；覆盖权限、幂等冲突、审计、并发领取、中断恢复、已提交版本恢复及迁移重复执行。
- Testcontainers 集成验证真实流程：模拟源连接故障 → 记录失败 → 恢复源 → 新任务重跑 → 真实采集/物化/冻结 → 现有 Property ERP evidence adapter 按新版本读取正确业务金额。未调用生产源、LLM、Cube 或真实 Neo4j 环境。
- Web 65 项：60 通过，5 项容器专项按配置跳过；严格契约与 BFF Cookie/JSON/请求编号/202 状态透传验证通过。
- TypeScript、ESLint、Next 生产构建和 Java package 通过；`git diff --check` 通过。
- 浏览器检查使用实际 React 组件与明确标注的契约样例服务：首次模拟响应中断，再次提交使用同一请求编号；任务从等待到完成、失败重跑保留原记录、切换视图不丢状态、390px 窄屏可读。样例服务不属于正式产品实现。
- 工作区改动仍未提交、未部署。部署前必须执行 V11，再配套发布 Java/Web；实际业务账号登录到发布、完整分析完成的端到端场景仍需环境验收。

## 剩余实施收尾（2026-09-13）

用户确认：组织可查看授权共享源，发布/重跑仍限平台管理员；部署沿用 easyv-dev，初始化正式超级管理员账号。

- V12 加入 RECONCILE：重建完整源快照，删除的源记录从新版本消失，历史冻结版本不变。Property 实测删去退款后，新版本回款 80，旧版本仍为 70。
- V13 加入组织共享源授权与审计。目录、任务、单任务读取与历史血缘在 Java 服务端过滤；混合未授权源的版本整体隐藏。组织授权页面仅平台管理员可操作。
- V14 加入管理员种子与正式登录：随机部署密码、PBKDF2-SHA256 哈希、已有账号不重置、五次失败锁定五分钟、登录审计。默认关闭手填 scope 的开发认证。
- `ingest-queue` 独立采集 Worker 持有只读源凭据；Web/API 只持有平台库连接。`admin-seed` 为一次性运维入口。
- 修复 pnpm 工作区缺少 packages 导致实际部署构建命令无法运行的问题。
- 本地验证：Java 419 项零失败/错误/跳过（全量运行后修正一个测试用源名并定向复跑）；Web 65 项中 60 通过、5 项可选容器测试跳过；Next 生产构建、ESLint、TypeScript、Java package 与 diff 检查通过。
- 开发环境原工作目录存在未提交文件，部署使用 `/opt/ontology-agent-releases/20260913-ui`，保留原目录与旧镜像。迁移前平台库已备份。
- 真实数据检查：现有部署配置平台库 staging 为空；开发机本机 EasyV 缺反馈表。仓库配置的 EasyV 源库包含完整五表，默认沿用该配置并创建限定五表 SELECT 的独立源账号。真实部署与验收结果另记，不以本地测试代替。

## 收尾状态与后续验收清单（2026-09-14）

本轮按用户要求收尾，不继续扩展编码。开发与开发环境部署已完成，真实业务验收部分完成；不据此宣称生产交付全部完成。

### 已交付与当前运行状态

- 主功能提交 `5d1b793`：工作台信息层级、后端能力入口、数据接入目录/发布/重跑/对账、组织共享源只读授权、管理员初始化与登录。
- 修复提交 `1b7a3e2`：非 Web 采集 Worker 开启 `spring.main.keep-alive`，解决启动后随守护线程退出的问题。
- 部署目录 `/opt/ontology-agent-releases/20260913-ui`；Web 镜像 `5d1b793`，Java API 与采集 Worker 镜像 `1b7a3e2`。Java 修复未改变 Web 契约。
- 9 月 14 日复核：Web、API、Cube、CubeStore、Neo4j 均健康并连续运行约 19 小时，采集 Worker 同期持续运行。原 `/opt/ontology-agent` 未提交文件未覆盖，旧镜像保留。
- 数据库已从 V9 迁移到 V14。迁移前备份位于开发机 `/opt/ontology-agent-release-private/platform-before-ui-20260913.dump`，尚未演练恢复。
- 管理员账号 `platform-admin`，初始凭据仅保存在开发机私有文件 `/opt/ontology-agent-release-private/admin-seed.env`，未写入仓库。该账号不自动获得业务用户身份或项目数据范围。
- 同步源沿用仓库与现有部署配置 `172.16.124.100:32408/easyv`，独立采集账号仅有五张源表 SELECT 权限；不是开发机 `172.16.125.3` 的本机库。后者缺少反馈表，不满足当前五表契约。

### 已有验收证据

- 本地 Java 419 项通过；Web 60 项通过、5 项可选容器测试跳过；构建、类型检查、ESLint 通过。非 Web Worker 保活补丁另经真实部署持续运行验证。
- 真实源集成测试 `LiveEasyVIngestionIT` 在用户范围 19、2026-09-07 至 2026-09-10 通过：五表采集、物化、冻结与 canonical facts 消费；这是受控集成测试，不是浏览器登录后完成 LLM 分析的证明。
- 经部署后的 Web BFF 正式管理员登录成功，返回服务端验证的 PLATFORM_ADMIN 会话。
- 经正式 API 验证组织授权/撤销，验收组织 `acceptance-ui-20260913` 的临时授权已撤销。
- 真实 RECONCILE 任务 `fcfbb3b9-40ec-4b33-a045-c68af06cc4ea` 经 pending → running → completed，重复请求保持同一任务 ID。
- 该冻结版本包含五个产品：应用 99 行、Forge 任务 106 行、反馈 760 行、流水线节点 3359 行、原型 91 行。已完成任务重跑返回 409。
- 浏览器工具遇到旧连接失败页的 URL 策略错误，尚未完成部署后的浏览器交互验收；之前的样例组件检查不替代本项。

### 后续明细计划（按顺序）

| 顺序 | 工作 | 前置条件 / 验收标准 |
| --- | --- | --- |
| P0-1 | 真实浏览器 UI 验收 | 正式管理员登录；检查首页、数据目录、发布表单、轮询、冻结版本、授权界面；桌面和 390px 窄屏无布局溢出，无控制台错误。 |
| P0-2 | 组织只读真实账号验收 | 获取两个组织的可信登录账号；授权组织仅见对应共享源，另一组织不可见；直连 API 发布/重跑为 403；撤销后刷新立即失去访问。当前证据为本地权限测试及真实管理员授权操作。 |
| P0-3 | 真实业务分析端到端 | 使用可信业务账号从首页发起 EasyV 分析，完成 LLM/Worker/结果呈现，检查失败说明和冻结版本出处；超级管理员身份不冒充源数据创建者。 |
| P0-4 | Property 数据与跨组件验收 | 当前平台库 Property staging 为空。明确真实 ERP 同步入口及项目范围后，发布 Property 版本、执行图 bootstrap，验证 ERP/canonical、Cube、Neo4j 与页面证据绑定同一冻结版本。不得填充假业务数据替代。 |
| P1-1 | 失败与恢复验收 | 开发环境受控制造一次采集失败，验证页面错误码/追踪号、人工重跑与原任务保留；重启后任务状态与审计保持一致。当前有本地故障/恢复测试，未完成真实环境故障演练。 |
| P1-2 | 源数据质量确认 | 某些范围存在无法关联应用的反馈，某些范围无有效评分，当前按事实契约明确失败。由业务确认关联规则/评分要求，必要时另行修正源数据或正式契约，不做静默兜底。确认最终长期使用的源库地址。 |
| P1-3 | 交付与运维补齐 | 整理初始凭据交接与管理员密码轮换方案；演练备份恢复/回滚；确认 Git 推送或 PR 目标。本轮仅本地提交，未推送。 |
| P2 | 历史检索与分页 | 当前为平台最近 50 条任务、20 个版本中的授权可见窗口，无完整历史分页；若需要运维全历史，补服务端授权后分页和前端加载入口，不仅扩大查询上限。 |

后续只围绕上述缺口推进，不再重复扩展首页视觉或重做已通过的局部门禁。

## P0-1 浏览器验收与 P1-1 故障演练（2026-09-14 完成）

通过本机 SSH 隧道（127.0.0.1:3100 → easyv-dev）+ 系统 Chrome（playwright-core 驱动）完成真实部署的浏览器验收，全程非样例服务。

### P0-1 结果（22 项检查，2 项 FAIL 均为脚本选择器问题、截图复核通过）

- 真实表单登录 `platform-admin` → 303 至 `/admin/ingestion`，签名会话正常；`/api/auth/me` 返回 PLATFORM_ADMIN。
- 发布任务默认视图：既有对账任务 `fcfbb3b9` 已完成，任务/版本集编号、提交人、追踪号、起止时间完整。
- 采集与物化：35 条真实任务；按名称过滤与无匹配空态均正确。
- 数据目录：easyv（5 数据集）与 property（6 数据集）真实登记。
- 冻结版本：`fcfbb3b9` 展开含 5 产品版本、行数（99/106/760/3359/91）、物化任务、源版本、采集任务全链路。
- 组织授权：授予测试组织 `acceptance-ui-20260914` → 列表即时可见 → 撤销 → 恢复空态；两次 `ingestion.access.changed` 已入审计。
- 真实增量发布：UI 表单提交 easyv 5 产品 → 受理 `90df13a9` → 页面 3 秒轮询驱动 `等待执行 → 发布中 → 已完成` → 新冻结版本集 lineage 完整；`查看版本溯源` 正确进入 `?view=releases`。
- 管理员工作台首页：两项能力均显示不可用及真实原因（EasyV 需可信数字用户 ID；Property 未分配项目范围），无提交入口，空历史与状态筛选/搜索正常。
- 390px 窄屏（登录/首页/数据接入）无横向溢出；深色主题可读；键盘可访问原生 details/表单。
- 控制台仅 1 条 `/favicon.ico` 404（无 favicon，装饰性缺失，建议后续补图标）；36 条 failed requests 全部是 Next RSC prefetch 中止，属正常浏览器行为。

### P1-1 受控故障演练结果

- 停机挂起：`docker stop` release-worker 期间提交任务 `daea3f7e` 保持 `pending`；`docker start` 后任务被领取并完成。队列持久化符合预期。
- 中断恢复：任务 `bb872c9f` running 期间 `docker kill -s 9` → 任务遗留 `running`；手动 `docker start` 后 worker 首轮即执行 reconcile（running 任务优先），核对无已提交冻结版本 → 任务标记 `failed` + `INGESTION_RELEASE_INTERRUPTED`，关联未完成子任务同步标记失败。
- 重跑：API 重跑创建新任务 `d1c46843`（`retryOf=bb872c9f`）→ `completed`；UI 失败行展示错误码、追踪号与“已修复，重新执行”按钮，重跑行显示“原失败任务”。
- 审计链完整：三个任务各自 submitted/started/failed/completed 全部落 `platform.audit_events`；授权变更与管理员登录亦有记录。
- **运维发现**：该宿主机 Docker 20.10.17 上，SIGKILL 后 `restart=unless-stopped` 未触发自动重启（daemon 日志仅见 `shim disconnected`/`ignoring event /tasks/delete`，restartCount=0），worker 停机至手动 `docker start` 约 8 分钟内 `running` 任务无看守。需要监控告警或 supervisor 层拉起；应用内恢复路径本身工作正常。

### 验收后新增状态

发布任务列表现有 4 条页面提交记录：`fcfbb3b9`（对账，已完成）、`90df13a9`（增量，已完成）、`daea3f7e`（停机恢复，已完成）、`bb872c9f`（中断，已失败）+ `d1c46843`（重跑，已完成）。冻结版本集 7 个。演练产生的失败任务与版本集均为真实验收证据，未清理。

## Property 封存 + 登录页重构 + 查看扩权（2026-09-14 完成并部署）

按用户决定执行方案 B（物业域彻底封存）、登录页纯登录化、数据接入查看扩权。

### 改动

- `dip3.property.enabled` 开关（`application.yml`，默认 `true` 兼容；EasyV-only 部署置 `false`）；property domain pack 与 graphsync 全部 24 处 Bean 加 `@ConditionalOnProperty`（含 `CubeHealthIndicator`/`Neo4jHealthIndicator`）；`GraphSyncScheduler` 叠加 graph-sync 开关。
- `V15__seal_property_domain.sql`：property 源/数据集/产品幂等置 `disabled`（数据与 volume 保留，`property-ingest` ops 通道仍在）。
- `compose.easyv-dev.yaml`：cube/cubestore/neo4j 移入 `property` profile（默认不启动），backend `PROPERTY_DOMAIN_ENABLED=false`、健康组摘除 cube/neo4j、`JAVA_GRAPH_SYNC_ENABLED=false`。
- `IngestionAccessService`：所有已认证用户 `canView=true` 且 `sourceKeys` 为全部源；`canManage`/发布/重跑/授权写仍 `PLATFORM_ADMIN`。`source_view_grants` 表保留作审计兼容，本阶段不再限制可见性。
- 目录账号登录授予 `PROPERTY_ANALYST + EASYV_ANALYST`（ErpdirectoryService），无账号名特判。
- 登录页重构为纯登录卡片：仅 DIP3 标识 +「登录工作台」+ 目录表单（不可用时直接管理员表单；可用时管理员入口折叠）；删除营销文案/能力卡/语录；保留 `sanitizeNextPath` 与错误/退出横幅。
- 登录页截图与验证产物在 /tmp/pw-accept（本机临时，不入库）。

### 验证

- Java 401 项测试全绿（迁移计数 15、property 测试夹具 reactivate、扩权与角色断言已更新）；Web lint/build/60 测试绿。
- easyv-dev 部署（镜像 `seal-property-20260914`）：migrate 应用 V15；backend/web healthy；cube/neo4j 已停止移除；release-worker 新镜像运行正常。
- 数据目录：property 源 + 6 数据集 + 6 产品显示「已停用」，发布表单无 property 可选项；workspace 能力列表仅剩 `easyv:generation-quality-analysis`（管理员无 EASYV_ANALYST 如实显示不可用），无 property 能力。
- EasyV 增量采集（`easyv-dev ingest INCREMENTAL`）完成：`ingestion_release_complete`，5 产品正常发布。
- **部署注意**：`.env.easyv-dev` 用 `ONTOLOGY_JAVA_IMAGE`/`ONTOLOGY_WEB_IMAGE` 固定镜像 tag；docker-compose v1 recreate 不会自动跟随 `easyv-dev` tag 移动，本次已将 pin 更新为 `seal-property-20260914`。

### 阻塞项（等用户输入）

- `ERP_API_BASE_URL` 未知：dev 机 dtstack 网关（Envoy）对候选 ERP 端点返回 `ERR_CLIENT_ID_NOT_FOUND`，缺少网关 client-id/路由配置；`erp_staging` 目录为空，开发账号 `18668184122` 不在其中，无法验证真实登录与 EasyV 分析端到端。
- P0-3 真实业务分析端到端依赖该账号可登录且 userId 为正数。
