# Story 5.1: 提交分析计划到后台执行

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 将已生成的分析计划提交给系统执行,
so that 系统可以按照既定步骤而不是单次查询完成分析。

## Acceptance Criteria

1. 当当前会话存在可执行计划时，用户发起执行后系统必须创建分析执行任务并开始按步骤处理。
2. 执行任务必须与当前分析会话建立明确关联。
3. 当某个步骤需要调用外部数据或分析能力时，系统必须按计划顺序编排对应能力，而不是退化成一次性查询。

## Tasks / Subtasks

- [x] 建立 analysis execution 模型与提交入口（AC: 1, 2, 3）
  - [x] 定义 execution identity、状态和与 session / plan 的关联。
  - [x] 新增执行提交 Route Handler，不在请求线程内同步跑完整分析。
- [x] 建立最小 dispatcher / enqueue 边界（AC: 1, 3）
  - [x] 将执行提交到 worker / queue 契约，而不是页面轮询直跑。
  - [x] 对不可执行计划给出稳定拒绝结果。
- [x] 覆盖执行提交测试（AC: 1, 2, 3）
  - [x] 验证 execution record 创建。
  - [x] 验证 owner / scope 校验。
  - [x] 验证步骤顺序信息被保留。

## Dev Notes

- 本故事是“提交执行”，不是“展示结果”；流式反馈属于 Story 5.2，结论输出属于 Story 5.3。
- 即使 worker 还很薄，也应先把 execution application service 和 queue / dispatcher port 抽稳，避免未来返工。
- 执行与会话的关联字段从一开始就要明确，因为 5.4、6.x 和 8.x 都要回放它。

### Architecture Compliance

- 必须遵循架构中的 `submit -> enqueue -> stream` 路径。
- Route Handler 只负责创建执行并投递，不负责同步完成长耗时分析。
- 身份与权限仍从服务端会话与 scope policy 获取。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-execution/`
  - `src/application/analysis-execution/`
  - `src/app/api/analysis/sessions/[sessionId]/execute/route.ts`
  - 视需要新增 execution 持久化 schema / repository

### Testing Requirements

- 至少覆盖：
  - 提交执行后创建 execution record
  - 当前用户只能提交自己的会话
  - 无计划或非法计划被拒绝
  - 多步骤顺序信息保持稳定

### Previous Story Intelligence

- Story 2.6 的 worker skeleton 与最小 job contract 是本故事的直接基础。
- Story 3.5 的 plan model 会直接作为执行输入，不应在 4.1 重写另一套计划结构。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1: 提交分析计划到后台执行]
- [Source: _bmad-output/planning-artifacts/architecture.md#应用通信与执行模型]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-5-1-analysis-execution.test.mjs`
- `node --test --test-concurrency=1 tests/story-2-6-worker-skeleton.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 新增 analysis execution 提交用例，基于当前会话和计划快照创建 `analysis-execution` 任务并投递到 Redis 队列。
- 新增 `/api/analysis/sessions/[sessionId]/execute`，在服务端重建当前计划后提交执行，不在请求线程内同步跑完整分析。
- 分析计划面板新增“开始执行分析”入口；会话页支持展示执行提交成功/失败反馈和 execution ID。
- `analysis-execution` 任务类型已接入 job contract 与 worker handler，占位结果为后续 5.2/5.3 流式与结论输出保留边界。

### File List

- _bmad-output/implementation-artifacts/5-1-submit-analysis-plan-for-execution.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/api/analysis/sessions/[sessionId]/execute/route.ts
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-plan-panel.tsx
- src/application/analysis-execution/submission-use-cases.ts
- src/application/analysis-planning/use-cases.ts
- src/domain/analysis-execution/models.ts
- src/domain/job-contract/models.ts
- src/infrastructure/job/runtime.ts
- src/worker/handlers.ts
- tests/story-5-1-analysis-execution.test.mjs

### Change Log

- 2026-04-07: 完成 Story 5.1，新增执行提交路由、队列投递边界、页面执行入口与故事级测试覆盖。
