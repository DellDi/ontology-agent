# Java 分析后端契约

本目录固化 Next.js 工作台与 Java 服务之间的迁移契约。契约来源是现有
`src/app/api/analysis/sessions/**` routes、`src/domain/analysis-execution/**`、
`tests/story-1-4-analysis-session.test.mjs`、`tests/story-5-2-execution-stream.test.mjs`
和 `tests/story-7-1-server-side-authorization.test.mjs`。

- 身份只来自签名 Cookie `dip3_session`，请求体中的 owner/scope 字段一律不可信。
- `GET /api/auth/me` 只返回已验证的 viewer/scope 与 `workspaceAccess` 授权结论，不返回
  session id、签名或过期凭据；“已认证”和“可进入工作台”是两个独立事实。
- `GET /api/workspace/home` 只返回当前用户和 scope 内的会话、最新执行与 ERP 项目。
- `GET /api/analysis/sessions/{sessionId}` 返回 session/followUps/history/job/events/snapshot/runtime 聚合；指定
  `executionId` 时不存在、跨会话或越权统一返回 `404`，不泄露资源是否存在。追问和历史回放先从
  聚合解析其 `resultExecutionId`，再以唯一的 `executionId` selector 读取对应轮次。
- 创建与执行继续使用 `303 Location`；执行支持 `Idempotency-Key`，普通 HTML 首次提交缺省为
  session 内稳定的 `initial` 键，避免自动提交与手动点击生成两条执行。
- SSE 每帧严格为 `data: <event-json>\n\n`，`sequence` 在 execution 内从 1 严格递增；
  `afterSequence=N` 只返回 `sequence > N` 的已持久化事件，终态后关闭。
- PostgreSQL 是 session、job、event、snapshot 的唯一持久化事实源；读接口与恢复不得从
  Redis 反推或补造事实。Redis 仅用于 Worker 唤醒，不是队列或执行状态的权威来源。
- Redis 唤醒发布失败必须持久化 `dispatchStatus=failed`，并记录带 execution id 的错误日志；
  PostgreSQL 中已排队任务仍由轮询调度消费，不把“无订阅者”伪装成业务执行失败。
- Provider、ontology 或 Agent/Tool 契约失败必须写入 failed 事实，并携带稳定的
  `errorCode` 与 `traceId`。
- 首次分析的唯一运行时能力为 `project` / `collection-rate` / `project-collection-rate` /
  `receivable-accounting-period`；完成态必须同时保存 ERP、Cube、Neo4j 三类非空证据投影与对应表格，
  `confidence` 在没有可验证概率来源时为 `null`。
- 新会话、job 与 snapshot 以 `java-initial-v1` 标识边界。没有该标识的历史 TypeScript 会话只读展示，
  不自动执行；Java execute 明确返回 `LEGACY_EXECUTION_NOT_MIGRATED`，不做隐式迁移或重跑。
- 追问执行使用独立的 `java-follow-up-v1` 标识；snapshot 的 `followUpId` 与执行标识必须成对一致。
  会话聚合中的 `followUps` 按数据库 `created_order` 升序返回，且每条追问保留其引用执行、结果执行、
  上下文、计划版本/diff 与本体版本绑定。业务事实不从 Spring AI memory 反推。
- 追问创建、上下文纠正与重规划由 Java API 持有；Next.js route 仅透明转发 Cookie、请求体、
  `Idempotency-Key`、correlation id 和 `303 Location`，Java 不可达时显式返回 `502`。
- Follow-up 的 inherited/merged context、current/previous plan 和 plan diff 都有结构化契约；重规划四项事实
  必须同时存在或同时为空。完成态 snapshot/history 必须包含 canonical plan 与完整 resolved context；失败态
  允许 `steps=[]` 和空 resolved context，以便真实失败诊断可见，但仍严格校验 root/follow-up contract markers。
- Next.js 首次分析读写适配器只读取 `JAVA_BACKEND_URL`；现有登录入口继续创建共享 Cookie
  session。Java 不可达或返回错误时显式失败，严禁回退到 TypeScript 后端、缓存结果或伪成功数据。
- 本体治理 overview、definitions、versions、change request、审批和发布由 Java 持有；管理页面以
  Draft 2020-12 JSON Schema 与严格 Zod 双重校验读模型，Next routes 只透明转发，不再运行治理状态机。

`openapi.yaml` 描述 HTTP 边界，`schemas/` 描述 JSON，`fixtures/` 是跨实现测试的固定样本。
