# Story 7.8: 图谱同步调度、补偿与一致性巡检

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 企业运维负责人,
I want 为 graph sync 提供 scheduler、失败补偿和一致性巡检,
so that 图谱同步可以长期运行并在异常后恢复，而不是依赖人工盯守。

## Acceptance Criteria

1. 当 graph sync 进入常态运行后，平台必须支持 `incremental / dispatch / consistency-sweep` 三类 job，并保留人工触发 `bootstrap / org-rebuild` 的能力。
2. 当某次增量扫描、组织重建或派发失败时，系统必须保留失败 run、重试次数和待补偿 dirty scope，不能因为单次失败而丢失恢复上下文。
3. 当运维团队查看系统状态时，必须能够从统一的运行入口或观测面板看到 graph sync 的任务状态、积压情况和关键失败信息，从而支持重试、补偿和人工介入。

## Tasks / Subtasks

- [x] 建立 graph sync job 拆分与统一入口（AC: 1, 3）
  - [x] 在现有 [graph:sync:neo4j](/Users/delldi/work-code/open-code/ontology-agent/package.json) 基础上，拆出明确的运行入口，至少覆盖：
    - `graph:sync:bootstrap`
    - `graph:sync:org`
    - `graph:sync:incremental`
    - `graph:sync:dispatch`
    - `graph:sync:consistency-sweep`
  - [x] 统一各入口的参数、日志格式和退出码语义，避免不同脚本各自定义成功/失败标准。
  - [x] 保留手工按组织触发 `org-rebuild` 的运维入口，便于补偿与灾后校正。
- [x] 建立失败补偿与重试语义（AC: 2, 3）
  - [x] 定义 dirty scope 的失败状态、重试次数与最大重试阈值。
  - [x] 对失败 run 与 dirty scope 提供显式的重试路径，不允许“失败后静默消失”。
  - [x] 明确单组织失败不回滚全局 run，但必须保留 `failed / partial` 终态和足够的错误上下文。
- [x] 建立 consistency sweep 机制（AC: 1, 2）
  - [x] 新增一致性巡检 use case，用于周期性抽取关键组织或指定范围执行补偿性 `org-rebuild`。
  - [x] sweep 不得绕过 `7.6` 和 `7.7` 的正式运行模型，仍需复用 run metadata 与受控 rebuild 路径。
  - [x] 明确 sweep 与增量任务的职责边界：增量负责追新，sweep 负责查漏补缺和定期校正。
- [x] 把 graph sync 运行状态接入观测与运维信息面（AC: 3）
  - [x] 与 [Story 7.4](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-4-observability-and-availability-monitoring.md) 对齐，至少暴露：
    - 最近 run 状态
    - dirty scope pending / failed 数量
    - 最近失败摘要
    - 可触发的手工重试入口或 runbook 指引
  - [x] 为 graph sync job 补结构化日志字段和最小 metrics，不要求一次做完整 dashboard，但要有可消费的观测面。
- [x] 补齐调度、补偿与 sweep 测试（AC: 1, 2, 3）
  - [x] 验证不同 job 入口能路由到正确 use case。
  - [x] 验证失败 dirty scope 可被重试且不会提前清空。
  - [x] 验证 consistency sweep 调用的是受控 `org-rebuild`。
  - [x] 验证运维状态输出能体现 run / backlog / failure 信息。

## Dev Notes

- `7.8` 是 graph sync 运行化的“长期运营层”，但它不应该重新定义前面的核心执行语义：
  - `7.6` 负责 run metadata + org-rebuild + scoped cleanup
  - `7.7` 负责 watermark 扫描 + dirty scope + cursor 推进
  - `7.8` 负责把这些东西接成可长期运行的 job 系统
- 这里的关键不是“做一个 cron”，而是把 graph sync 变成**可恢复、可重试、可巡检、可观测**的运行能力。
- 失败恢复策略要尽量保守：
  - 单组织失败不拖垮全局
  - 但也不能把失败吞掉
  - cursor 与 dirty scope 仍要维持严格一致性
- consistency sweep 的目的不是替代增量，而是应对：
  - 源端漏标
  - 时间字段质量差
  - 中途故障后的补偿
- 如果当前仓库还没有完整的统一 scheduler，可以先落成本地/自托管可执行的脚本级调度边界，但接口和运行语义要按长期运行来设计。

### Architecture Compliance

- 必须遵循 [graph-sync-operating-model.md](/Users/delldi/work-code/open-code/ontology-agent/docs/data-contracts/graph-sync-operating-model.md) 中对 job 分类、失败恢复和 CI/CD 边界的定义。
- 调度、补偿和巡检仍属于平台运行管理层，不得重新回退成“人工手敲脚本 + 无状态补丁”。
- 所有 job 最终都应复用 `7.6 / 7.7` 的正式路径，不得再出现一条旁路同步链。
- 观测接入应与 `7.4` 对齐，graph sync 不能成为监控盲区。

### Library / Framework Requirements

- 暂不强制引入外部任务调度平台；优先在现有 Node/脚本/worker 能力上建立清晰 job 边界。
- 继续沿用项目现有 `Drizzle ORM`、`node:test`、`tsx` 等基础设施，不因为调度而引入第二套重型框架。
- 若需要结构化日志或 metrics 扩展，应与现有 observability 方向兼容，不单独造一套 graph sync 专属协议。

### File Structure Requirements

- 重点文件预计包括：
  - `scripts/` 下的 graph sync job 入口
  - `src/application/graph-sync/`
  - `src/infrastructure/graph-sync/` 或等价目录中的 dispatch / retry / status 逻辑
  - `src/infrastructure/observability/` 中与 graph sync 相关的指标或日志接入
  - 运维文档 / runbook
  - `tests/story-7-8-*.test.mjs` 或等价测试文件

### Testing Requirements

- 至少覆盖：
  - job 入口分流
  - 失败 dirty scope 保留与重试
  - consistency sweep 调用正式 rebuild 路径
  - graph sync 状态输出可观测

### Previous Story Intelligence

- [Story 7.6](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-6-graph-sync-run-metadata-and-org-rebuild.md) 定义了运行元数据和 `org-rebuild`；`7.8` 不得绕过它。
- [Story 7.7](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-7-graph-sync-incremental-scan-and-dirty-scope-dispatch.md) 定义了 cursor、dirty scope 和派发语义；`7.8` 负责把这些能力接入长期调度与补偿。
- [Story 7.4](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-4-observability-and-availability-monitoring.md) 后续要看到 graph sync run 状态、积压和失败摘要，因此 `7.8` 需要留出稳定的状态输出与观测接口。
- 最近提交 [06bf22f](/Users/delldi/work-code/open-code/ontology-agent/.git) 已经证明 graph sync 不再是文档级概念，而是真实运行链路；`7.8` 要把这种“能跑”升级成“可长期运营”。

### Git Intelligence Summary

- 最近几次提交都在把真实基础设施链路做稳，因此 `7.8` 的重点应是长期运行可靠性，而不是再做一层抽象概念包装。
- graph sync 现在已经有真实 baseline 和真实执行依赖，所以调度与补偿能力是平台必需项，不是后补优化项。

### Latest Technical Information

- 本故事不依赖新增框架版本更新，重点是把现有运行方案文档变成正式的 job/补偿/巡检交付面。
- 若暂无完整常驻调度器，也应先把命令边界和失败恢复契约做好，便于后续接入 cron、容器定时任务或更正式的 scheduler。

### Project Context Reference

- [project-context.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/project-context.md) 依然要求：
  - 以服务端边界和分层实现为优先
  - 多文件测试串行执行
  - 当前真实实现事实优先于旧规划

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.8: 图谱同步调度、补偿与一致性巡检]
- [Source: docs/data-contracts/graph-sync-operating-model.md](/Users/delldi/work-code/open-code/ontology-agent/docs/data-contracts/graph-sync-operating-model.md)
- [Source: _bmad-output/implementation-artifacts/7-6-graph-sync-run-metadata-and-org-rebuild.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-6-graph-sync-run-metadata-and-org-rebuild.md)
- [Source: _bmad-output/implementation-artifacts/7-7-graph-sync-incremental-scan-and-dirty-scope-dispatch.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-7-graph-sync-incremental-scan-and-dirty-scope-dispatch.md)
- [Source: _bmad-output/implementation-artifacts/7-4-observability-and-availability-monitoring.md](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/implementation-artifacts/7-4-observability-and-availability-monitoring.md)
- [Source: _bmad-output/planning-artifacts/architecture.md#基础设施与部署](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md)
- [Source: _bmad-output/planning-artifacts/prd.md#非功能需求](/Users/delldi/work-code/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `git log --oneline -5`
- `sed -n '220,360p' docs/data-contracts/graph-sync-operating-model.md`
- `sed -n '1,280p' _bmad-output/implementation-artifacts/7-7-graph-sync-incremental-scan-and-dirty-scope-dispatch.md`
- `sed -n '1,260p' _bmad-output/implementation-artifacts/7-4-observability-and-availability-monitoring.md`
- `node --test tests/story-7-8-graph-sync-operations.test.mjs`
- `node --test tests/story-4-5-graph-sync-use-cases.test.mjs tests/story-7-6-graph-sync-runtime.test.mjs tests/story-7-7-graph-sync-incremental.test.mjs tests/story-7-8-graph-sync-operations.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 新增 graph sync 运行 orchestration use case 与 job runner，把 `bootstrap / org / incremental / dispatch / consistency-sweep / status` 收敛到统一入口。
- 将增量链路拆分为独立 `incremental` 扫描与 `dispatch` 派发 job，并为扫描失败与派发部分失败补 run 记录，保留补偿上下文。
- 扩展 dirty scope / run store 的查询与状态能力，支持显式 failed scope 重试、最大重试阈值和运维状态聚合。
- 新增 graph sync runbook 与统一 JSON 日志包络，提供 backlog、失败摘要和人工介入指引。
- graph sync 相关 story 回归、`pnpm lint` 与 `pnpm build` 已通过；本次未重跑仓库全量串行 suite。

### File List

- _bmad-output/implementation-artifacts/7-8-graph-sync-scheduling-compensation-and-consistency-sweep.md
- docs/runbooks/graph-sync-operations.md
- package.json
- scripts/lib/run-graph-sync-job.ts
- scripts/sync-neo4j-baseline.mts
- scripts/sync-neo4j-bootstrap.mts
- scripts/sync-neo4j-consistency-sweep.mts
- scripts/sync-neo4j-dispatch.mts
- scripts/sync-neo4j-incremental.mts
- scripts/sync-neo4j-org.mts
- scripts/sync-neo4j-status.mts
- src/application/graph-sync/incremental-use-cases.ts
- src/application/graph-sync/job-runner.ts
- src/application/graph-sync/operations-use-cases.ts
- src/application/graph-sync/runtime-ports.ts
- src/domain/graph-sync/models.ts
- src/infrastructure/graph-sync/postgres-graph-sync-dirty-scope-store.ts
- src/infrastructure/graph-sync/postgres-graph-sync-organization-source.ts
- src/infrastructure/graph-sync/postgres-graph-sync-run-store.ts
- tests/story-7-8-graph-sync-operations.test.mjs

### Change Log

- 2026-04-08: 实现 graph sync 统一 job 入口、失败补偿、consistency sweep、状态汇总与运维 runbook，并完成 story 级验证。
