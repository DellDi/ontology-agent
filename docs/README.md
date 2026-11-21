# 文档总索引

> 按「当前系统真相（Living Specs）」「运行与环境」「活跃验收与设计」「历史归档」组织 `docs/` 下全部文档；任何实现细节与当前状态以对应源码及标注环境的最新验收回执为准，详见 [AGENTS.md](../AGENTS.md) 与 [README.md](../README.md)。

## 当前系统真相（Living Specs）

- [architecture/ontology-agent-runtime.md](./architecture/ontology-agent-runtime.md)：本体契约、时间语义、受治理工具边界、A/B/C/D 分阶段基线与 V33–V35 当前运行真相。
- [architecture/java-architecture-baseline.md](./architecture/java-architecture-baseline.md)：`backend-java` 模块化单体分层规范、类型边界、Spring AI 隔离规则与 ArchUnit 架构门禁。
- [architecture/multi-domain-runtime-architecture.md](./architecture/multi-domain-runtime-architecture.md)：多领域运行时内核（Capability、Job Pin、Scope、Evidence/Conclusion 契约）与新领域接入标准。
- [data-contracts/easyv-ai-generation-ontology-v1.md](./data-contracts/easyv-ai-generation-ontology-v1.md)：EasyV AI 大屏生产领域首个本体 V1 设计与只读域能力边界基线。
- [data-contracts/cube-semantic-baseline.md](./data-contracts/cube-semantic-baseline.md)：Property 领域进入 Cube 语义层的项目口径与尾欠口径收费指标契约（随 Property 域封存待恢复）。
- [data-contracts/graph-sync-baseline.md](./data-contracts/graph-sync-baseline.md)：Property 领域 Neo4j 图谱层首批实体、关系边与受控同步来源基线。
- [data-contracts/graph-sync-operating-model.md](./data-contracts/graph-sync-operating-model.md)：Java Graph Sync 从冻结 PostgreSQL canonical facts 构建按版本隔离 Neo4j 投影的运行模型。

## 运行与环境

- [environments.md](./environments.md)：本地开发（3000）与公司验收 `easyv-dev`（3100）的环境隔离、数据快照来源、账号体系与防错护栏（操作前必读）。
- [local-infrastructure.md](./local-infrastructure.md)：本地 Docker Compose 基础设施拓扑（PostgreSQL 18、Redis 8、Cube、Neo4j 5）与宿主机联调约定。
- [easyv-dev-deployment.md](./easyv-dev-deployment.md)：`easyv-dev` 共享平台库内部演示部署、V11–V35 运维发布边界、备份清理及历史发布回执。
- [deployment.md](./deployment.md)：自托管生产容器拓扑（`compose.prod.yaml`）、preflight 检查、Flyway 独立迁移与健康诊断指南。
- [runbooks/graph-sync-operations.md](./runbooks/graph-sync-operations.md)：Java Graph Sync 管理/系统 API、故障排查顺序与按冻结集合重放恢复 Runbook。

## 活跃验收与设计

### 验收与专题推进

- [acceptance/b-closeout.md](./acceptance/b-closeout.md)：B 阶段（对象与智能体）工程收尾范围、本地/公司验证结果与遗留业务评审依赖。
- [acceptance/easyv-block-improvement-plan.md](./acceptance/easyv-block-improvement-plan.md)：C 阶段 EasyV 普通原型块主题/指标/图形诊断与块内改造实施边界及验收记录。
- [acceptance/easyv-writeback-adapter.md](./acceptance/easyv-writeback-adapter.md)：C 阶段替换源项目 API 改造依赖的数据库写回适配器（`EasyVBlockActionDatabaseAdapter`）实现与真实测试源验证边界。
- [acceptance/d-operations-plan.md](./acceptance/d-operations-plan.md)：D 阶段「一批大屏的检查与改进」闭环目标、能力边界与本地推进/未通过项记录（含早期运维基础）。
- [acceptance/easyv-core-metrics-refresh.md](./acceptance/easyv-core-metrics-refresh.md)：V33 核心指标区域适配与 `saas-test` 全量数据刷新（2026-10-27）实施与本地快照验证回执。
- [acceptance/easyv-dynamic-panels.md](./acceptance/easyv-dynamic-panels.md)：V34 原型动态面板（`tabV2` / `panelSwitch`）标准源契约、代码实现与本地契约验证记录（待新源快照页面验收）。
- [acceptance/easyv-chart-configuration.md](./acceptance/easyv-chart-configuration.md)：V35 EasyV 图表配置规则与后台配置审计接入实现、权限边界及公司 test 发布验收回执（2026-11-05）。
- [acceptance/easyv-business-questions.md](./acceptance/easyv-business-questions.md)：EasyV 自然业务问题清单、带业务语义的布局复用验收标准与多轮复验判定记录。
- [acceptance/easyv-quality-evaluation-plan.md](./acceptance/easyv-quality-evaluation-plan.md)：EasyV 生成质量闭环评估的价值定义、问题集、P0/P1 字段补采优先级与验收口径设计（草案 v3）。
- [acceptance/easyv-quality-p0-implementation.md](./acceptance/easyv-quality-p0-implementation.md)：V27 生成质量 P0 字段采集、公司源只读覆盖核实与 B 阶段质量回看发布验证记录。
- [acceptance/workspace-process-presentation.md](./acceptance/workspace-process-presentation.md)：工作台回答正文去框与单层分析过程呈现改动的本地验证记录（2026-10-22）。

### UI 设计与审查

- [design/workspace-ui-redesign.md](./design/workspace-ui-redesign.md)：工作台暖白与陶土橙视觉改版方向、信息层级基准与阶段状态记录（视觉参考图见 [assets/workspace-warm-visual-reference.png](./design/assets/workspace-warm-visual-reference.png)）。
- [design/workspace-ui-audit-20261029.md](./design/workspace-ui-audit-20261029.md)：2026-10-29 工作台 UI 与文案逐页审查发现及四轮减法改进建议。
- [design/workspace-ui-improvement-plan-20261029.md](./design/workspace-ui-improvement-plan-20261029.md)：依据 UI 审查结论执行的四批次文案收敛与交互改进本地实施回执。

## 历史归档

- [acceptance/archive/ontology-agent-runtime-2026-09-10-log.md](./acceptance/archive/ontology-agent-runtime-2026-09-10-log.md)：自原 `ontology-agent-runtime.md` 无损迁出的 2026-09-24 至 2026-10-19 历史实施与验收流水账（原 §9–§14.34）。
- [architecture/ontology-data-platform-implementation-plan.md](./architecture/ontology-data-platform-implementation-plan.md)：早期统一 Ontology 数据底座（P0–P6）架构设计与历史实施基线（后续运行演进见 [Ontology Agent Runtime](./architecture/ontology-agent-runtime.md)）。
