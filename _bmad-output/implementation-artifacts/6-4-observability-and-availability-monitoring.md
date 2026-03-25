# Story 6.4: 建立运行监控与可用性观测

Status: ready-for-dev

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

- [ ] 建立基础 observability 模块（AC: 1, 2, 3）
  - [ ] 明确 health、metrics、structured logs、trace / correlation id 的最小契约。
  - [ ] 避免日志泄露 cookie、token 或原始敏感问题文本。
- [ ] 接入关键服务端入口（AC: 1, 2, 3）
  - [ ] 为分析相关 API、执行链路和关键错误路径加观测。
  - [ ] 若 worker 已存在，保留跨进程 trace 关联。
- [ ] 覆盖观测契约测试（AC: 1, 2, 3）
  - [ ] 验证 health / metrics / trace 基础配置。
  - [ ] 验证关键请求产生日志字段和 correlation id。

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

- Story 6.2 的审计事件会与这里的 trace / correlation id 形成互补。
- Story 6.3 的自托管容器基线为观测组件和 exporter 提供部署落点。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.4: 建立运行监控与可用性观测]
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

- _bmad-output/implementation-artifacts/6-4-observability-and-availability-monitoring.md
