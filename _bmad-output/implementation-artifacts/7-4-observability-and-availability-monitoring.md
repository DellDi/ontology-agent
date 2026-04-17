# Story 7.4: 建立运行监控与可用性观测

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 企业运维负责人,
I want 监控平台的可用性、任务运行状态和关键故障,
so that 我们可以在试点阶段及时发现问题并维持目标可用性。

## Acceptance Criteria

1. 运维团队必须能够看到基础服务健康状态、分析任务状态和关键错误信息。
2. 这些观测信息必须足以支持 99.5% 业务时段可用性的跟踪。
3. 当关键组件出现故障或异常时，团队必须能从指标、日志或追踪中定位问题范围，而不依赖逐节点手工排查。

## Tasks / Subtasks

- [x] 建立基础 observability 模块（AC: 1, 2, 3）
  - [x] 明确 health、metrics、structured logs、trace / correlation id 的最小契约。
  - [x] 避免日志泄露 cookie、token 或原始敏感问题文本。
- [x] 接入关键服务端入口（AC: 1, 2, 3）
  - [x] 为分析相关 API、执行链路和关键错误路径加观测。
  - [x] 若 worker 已存在，保留跨进程 trace 关联。
- [x] 覆盖观测契约测试（AC: 1, 2, 3）
  - [x] 验证 health / metrics / trace 基础配置。
  - [x] 验证关键请求产生日志字段和 correlation id。

### Implementation Notes (2026-04-17)

- 新建 `src/infrastructure/observability/` 模块，分 5 个文件：
  - `sanitize.ts` — 敏感字段脱敏（password / token / secret / cookie / session / apiKey），自由文本（question/prompt）替换为长度摘要
  - `correlation.ts` — `x-correlation-id` 入站优先 + AsyncLocalStorage 传递
  - `metrics.ts` — 进程内 counter + 最近 50 条错误采样
  - `logger.ts` — 结构化 JSON logger，输出到 stdout/stderr 供容器日志平台采集
  - `request.ts` — `withRequestObservability` wrapper 统一注入 correlation、计数、错误采样
  - `index.ts` — public surface，未来替换为 OTel 只需改这里
- `instrumentation.ts` — Next.js 16 register hook，启动时输出 service 元信息；Edge runtime 跳过
- `src/app/api/health/route.ts` — 并行探测 postgres / redis，返回结构化 `status: "ok" | "degraded"`，`degraded` 时返回 503
- `src/app/api/metrics/route.ts` — JSON 暴露 counter snapshot + recent errors，供 prometheus json_exporter 拉取
- `src/worker/main.ts` — 将所有 `console.*` 替换为结构化 logger，job 级别使用 child logger 绑定 jobId / jobType；全部关键状态转换转为 metrics counter

### Test Coverage (2026-04-17)

- `tests/story-7-4-observability.test.mts` — 19 个用例
  - sanitize (5)：敏感字段 / 长文本 / 基本类型保留 / Error 序列化 / 深度限制
  - sanitize P5 验证 (1)：publicKey/workflowKey 不误伤，apiKey 正常脱敏
  - correlation (4)：入站 header / 缺省生成 / AsyncLocalStorage 传递 / Response 头写入
  - P1 ReadableStream 保护 (1)
  - metrics (2)：counter 累加 / recordError
  - request wrapper (6)：correlation 注入 / 200 计数 / 500 计数 / unhandled exception / header 继承 / 不覆盖 handler-set header
  - P4 logger 循环引用保护 (1)

### Review Patches (2026-04-17, Wave 1)

基于 code review of commit `7e08300`，完整清溅 decision-needed 与 patch：

- `D1` `/api/metrics` 鉴权：`OBSERVABILITY_TOKEN` 支持 `x-observability-token` 或 `Authorization: Bearer`，未配置 token 时保持开发态开放
- `D2` web → worker correlation id 继承：`AnalysisExecutionJobData` 新增 `originCorrelationId`，worker 消费时 `withCorrelationAsync` 恢复 trace
- `D3 + P2` Redis singleton：`createRedisClient` 进程级缓存 + `ensureRedisConnected` 并发安全，health 探针不再每次 churn
- `D4` reasoning-summary / assumption-card renderer 归属：deferred 到 Story 10.2 renderer-registry
- `P1` `attachResponseCorrelationHeader` 对 ReadableStream body 跳过克隆，保护 SSE 流
- `P4` logger `safeStringify` 处理循环引用 / BigInt / 降级 fallback
- `P5` sanitize 移除过度激进的单独 `key` 规则，避免误伤 publicKey / workflowKey
- `P6` 外部服务 correlation 传播：deferred 到后续 LLM/ERP adapter 专项
- `W1` HMR AsyncLocalStorage 重建：dev-only，接受

## Dev Notes

- 审计和 observability 要分开建模；前者偏治理追溯，后者偏运行诊断。
- 当前若 worker 仍较薄，可以先把 web 面观测和 trace id 契约站稳。
- 设计指标时要考虑 SSE、任务状态和移动端只读入口，不能只盯 HTTP 成功率。

### Architecture Compliance

- 观测接入优先落在 Route Handler、execution service 和 worker 入口。
- 结构化日志与追踪信息仍需遵守服务端安全边界。
- 目标是支撑 NFR6，而不是仅提供一个 `/health` 页面。

### File Structure Requirements

- 重点文件预计包括：
  - `src/infrastructure/observability/`
  - `instrumentation.ts` 或等价入口
  - `compose.yaml` 视需要增加观测组件
  - 运行文档或 runbook

### Testing Requirements

- 至少覆盖：
  - health / metrics / trace 配置存在
  - 关键请求包含 correlation id
  - 错误路径可观测
  - 日志去敏

### Previous Story Intelligence

- Story 7.2 的审计事件会与这里的 trace / correlation id 形成互补。
- Story 7.3 的自托管容器基线为观测组件和 exporter 提供部署落点。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.4: 建立运行监控与可用性观测]
- [Source: _bmad-output/planning-artifacts/prd.md#非功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#基础设施与部署]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/7-4-observability-and-availability-monitoring.md
