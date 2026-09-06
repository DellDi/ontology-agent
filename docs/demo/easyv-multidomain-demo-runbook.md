# EasyV 多领域运行时演示 Runbook

> 用途：培训、架构评审和成果经验分享
>
> 状态：基于当前源码、Ontology v2、EasyV test PostgreSQL 只读核验和真实模型联合门禁；不代表生产部署或生产数据结论

## 1. 演示目标与受众

本演示面向后端、数据、AI 应用和业务产品团队，目标是说明同一个 Java 运行时如何在不复制执行主链的情况下承载两个真实领域：

- Property：物业收费率分析，作为既有回归能力；
- EasyV：AI 大屏生成质量分析，作为第二个只读 Domain Pack。

重点不是展示一个聊天机器人，而是展示可验证的链路：自然语言候选选择、Ontology version pin、creator-owned scope、确定性 facts workflow、evidence/claim contract 和 follow-up binding。

建议讲解节奏为 20–30 分钟：架构背景 4–5 分钟，Property 对照 3–4 分钟，EasyV 主场景 8–10 分钟，追问与失败边界 5–7 分钟，讨论 2–4 分钟。实际耗时取决于环境和现场问题。

## 2. 启动前置与安全边界

### 2.1 可核实的本地命令

Web 使用根目录 pnpm 工具链，Java 后端和数据库迁移直接使用 Maven：

```bash
pnpm install
docker compose up -d postgres redis
mise exec java@temurin-21.0.12+8.0.LTS -- mvn -f backend-java/pom.xml -q spring-boot:run -Dspring-boot.run.profiles=migrate
pnpm dev
mvn -f backend-java/pom.xml test
```

Java 运行时也可以按 README 使用 JDK 21 启动：

```bash
mvn -f backend-java/pom.xml spring-boot:run
```

这些命令只负责本地基础设施、Flyway、Web 和 Java 服务启动；不能由命令本身证明 EasyV 开发库已连接或生产可用。

### 2.2 EasyV 开关和数据库边界

`backend-java/src/main/resources/application.yml` 中的正式开关是：

```text
dip3.easyv.enabled = ${EASYV_POSTGRES_ENABLED:false}
```

默认值为 `false`。只有准备好开发环境只读数据源、Ontology v2 和 EasyV 相关 Bean 后，演示环境才显式启用；不要在没有数据源的普通 Property 演示中打开它。

开发库演示必须满足：

- 使用已确认的开发环境，不连接生产；
- 生产使用专用只读角色；开发环境若使用高权限角色绕过角色检查，只能通过显式 development override，且仍限制在 READ ONLY 事务；
- 不在前端、Git、文档或命令行回显密码、完整连接串和 token；
- 不执行 `INSERT`、`UPDATE`、`DELETE`、DDL、锁表或大结果导出；
- 开发数据只作为环境观测，不作为生产权限、数据完整性或业务指标结论。

## 3. 演示前确认项

1. 已完成 Flyway 初始化，Property 基线可读取。
2. EasyV 使用 `ontology-java-multidomain-v2`（`2.0.0`），而不是让演示者手工伪造 ontology key。
3. 演示账号具有 Property 所需权限；EasyV 账号具有 `EASYV_ANALYST`，且 userId 是可信正数。
4. EasyV V1 scope 仅为 `{userId, accessMode:"creator-owned"}`，不使用 `projectIds/areaIds`，也不把未确认的 `spaceIds/teamIds` 当作当前能力。
5. 推荐 EasyV cohort 为 `2026-07-24`；现场应明确这是开发库已验证的日期范围，不是生产统计口径。
6. 如果只演示架构链路而不读取 EasyV 数据，保持 `dip3.easyv.enabled=false`，使用测试 fixture 或已验证的只读测试环境。

## 4. 场景 A：Property 对照演示

### 问题

> 查询 2026 年 7 月各授权物业项目的收缴率，并说明主要差异。

### 观察点

1. `/api/analysis/sessions` 创建 session，服务端通过 Registry 选择 Property capability。
2. 提交前固定当前 Ontology version、Property scope snapshot 和 capability binding。
3. Worker 按通用 execution contract 执行，不由 Worker 自己猜测领域。
4. 结果中的 evidence、claim 和 scope ref 属于 Property Domain Pack；不应出现 EasyV 的四类 facts source。

### 不可宣称

- 不能把 Property 的 `AccessScope.projectIds/areaIds` 说成所有领域通用权限模型。
- 不能把一次 Property 结果解释为 EasyV 已经读取成功。
- 不能把观察性差异直接说成物业项目经营因果。

## 5. 场景 B：EasyV 生成质量演示

### 问题

> 查询 2026-07-24 这一天 AI 大屏生成质量，看看生成完成率、哪个阶段最慢、失败是否集中，以及评分和另存行为的关系。

### 预期链路

1. **候选选择**：问题包含明确的 EasyV/大屏生成/质量/阶段/失败语义，Registry 返回唯一 `easyv/generation-quality-analysis`；不能依赖注册顺序。
2. **绑定**：提交时固定 `domainKey`、capability、Ontology v2 和 creator-owned scope。scope snapshot 只保存可信 `userId` 与 `accessMode=creator-owned`。
3. **计划**：计划含 `_executionContract`、`_resolvedContext`、`summary`、`mode` 和稳定 steps：范围/时间校验、四源读取、证据校验、确定性渲染。
4. **四类 evidence**：结果只读取并展示以下聚合 source：
   - `easyv-ai-application`
   - `easyv-pipeline-node`
   - `easyv-forge-task`
   - `easyv-generation-feedback`
5. **五类 claims**：结果只产生：
   - `generation-quality`
   - `stage-bottleneck`
   - `failure-concentration`
   - `feedback-association`
   - `business-success-settlement-distinct`
6. **覆盖率披露**：pipeline 和 Forge 的耗时只基于非空耗时样本；部分缺失会显示 timed/eligible 覆盖率，全量缺失才明确失败。
7. **组合结果边界**：`execute_result` 同时受业务执行和积分结算影响，因此只能展示组合成功/失败，不能拆出“业务成功数”或“结算失败数”。
8. **投影**：前端可以展示 plan、evidence、freshness、claims 和 failure；本 runbook 不把当前结果扩展为 `appId -> screenId` 正式血缘。

### 推荐讲解词

“这里的智能体负责把问题带入已发布语义并完成一次受治理的 Tool Call；数字、覆盖率和结论由 typed facts 与确定性 workflow 生成，模型不能改数字，也不能补造因果。”

## 6. 场景 C：固定 binding 的时间追问

### 问题

> 把刚才的时间范围改成 2026-07-25 到 2026-07-27，其他条件保持不变。

### 观察点

- Follow-up 从来源 execution 读取冻结 binding 和 `_resolvedContext`。
- 只允许更新 `from/to`；domain、capability、entity、metric、userId、accessMode 和数据范围保持不变。
- replan 复制原计划的 steps/metadata，并写入 `java-follow-up-v1`、`_followUpId`、`_referencedExecutionId`。
- Worker 不根据追问文本重新选择能力，也不扩大到 team/space。

### 不可宣称

- 不能说追问支持切换到物业、切换指标或扩大用户授权。
- 不能把新的时间范围说成新 scope。
- 不能把历史结果缓存当成新的 facts 查询结果。

## 7. 失败演示

### 7.1 空数据

使用没有四类完整聚合事实的日期范围，或在 fixture 中将其中一个 source 的 count 置零。

预期：返回 `EASYV_FACTS_EMPTY`，不返回默认 0、空 claim 或伪成功。

### 7.2 越权

使用另一个 userId，或篡改已保存的 `domainKey`、`schemaVersion`、`userId`、`accessMode`。

预期：scope 校验失败；Worker-like 校验即使没有 roleCodes，也必须严格比较冻结 userId。不能通过写入 project/space/team 字段绕过 creator-owned scope。

### 7.3 断源/事实不完整

让四类 facts 中任一 source 返回 null，或将 pipeline 的 completed/failed/incomplete 总数改成不等于 taskCount；也可将 failureReason bucket 总数改成不等于 failed task 数。

预期：返回 `EASYV_FACTS_INCOMPLETE`，保留可诊断错误边界，不生成部分拼接的可信结论。

### 7.4 耗时缺失

保留部分 pipeline/Forge 耗时为空，观察结果中的 timed/eligible 覆盖率；再将全部可用耗时置空。

预期：部分缺失仍可分析但必须披露覆盖率；timed 样本为零时返回 duration missing，不能把缺失转换成 0 毫秒。

## 8. 结果检查清单

- [ ] 能看到 Property 与 EasyV 的 capability ID 不同。
- [ ] EasyV 结果使用 Ontology v2，且 binding 中记录 version pin。
- [ ] EasyV scope 只含 creator-owned user snapshot。
- [ ] 计划包含稳定 steps 和 `_resolvedContext`。
- [ ] evidence 恰好来自四个声明 source。
- [ ] claims 恰好属于五个允许的 kind。
- [ ] claim 中披露耗时覆盖率和组合 execute_result 限制。
- [ ] 追问只改变时间，不重新路由或扩大授权。
- [ ] 至少演示一种明确失败，并说明错误码而不是展示伪成功。

## 9. 结束时必须声明的边界

本演示证明的是：同一运行时可以通过 Domain Pack 隔离 Property 与 EasyV 的语义、scope、facts、claims 和 follow-up，并使用通用 Job/Worker/Event/SSE/audit 外壳。

本演示不证明：

- 生产环境已经部署 EasyV 或已开放对应权限；
- 开发 cohort 数字代表生产全量指标；
- 当前存在正式 `appId -> screenId` lineage；
- `sourceId/sourceColumns` 已成为稳定业务数据库字段；
- 已实现停止、重试、保存等写 Action；
- M6 展示契约验收已经完成。

## 10. 源码与契约索引

- `backend-java/src/main/java/com/dip3/ontologyagent/analysis/AnalysisController.java`：创建、提交、SSE stream 和 snapshot 路由。
- `backend-java/src/main/java/com/dip3/ontologyagent/capability/internal/application/StaticCapabilityRegistry.java`：candidate selection 与 capability binding。
- `backend-java/src/main/java/com/dip3/ontologyagent/easyv/internal/application/EasyVCapabilityRegistration.java`：EasyV descriptor、ontology keys、claim/evidence contract。
- `backend-java/src/main/java/com/dip3/ontologyagent/easyv/internal/application/EasyVScopeResolver.java`：creator-owned scope resolve/validate。
- `backend-java/src/main/java/com/dip3/ontologyagent/easyv/internal/application/EasyVGenerationWorkflow.java`：四源 facts、确定性 plan、coverage 和五类 claims。
- `backend-java/src/main/java/com/dip3/ontologyagent/easyv/internal/adapter/out/postgres/EasyVCanonicalFactAdapter.java`：已发布 canonical facts reader、freshness 和 duration coverage；来源库只由 ingestion connector 读取。
- `backend-java/src/main/java/com/dip3/ontologyagent/easyv/internal/adapter/out/llm/EasyVSpringAiMainAgent.java`：一次 Tool Call 与调用审计。
- `backend-java/src/main/java/com/dip3/ontologyagent/followup/AnalysisFollowUpService.java`：follow-up 创建、重规划与提交外壳。
- `docs/data-contracts/easyv-ai-generation-ontology-v1.md`：EasyV Domain Pack、Ontology v2、开发库观测和生产未知边界。
