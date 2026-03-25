# Story 4.1: 提交分析计划到后台执行

Status: ready-for-dev

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

- [ ] 建立 analysis execution 模型与提交入口（AC: 1, 2, 3）
  - [ ] 定义 execution identity、状态和与 session / plan 的关联。
  - [ ] 新增执行提交 Route Handler，不在请求线程内同步跑完整分析。
- [ ] 建立最小 dispatcher / enqueue 边界（AC: 1, 3）
  - [ ] 将执行提交到 worker / queue 契约，而不是页面轮询直跑。
  - [ ] 对不可执行计划给出稳定拒绝结果。
- [ ] 覆盖执行提交测试（AC: 1, 2, 3）
  - [ ] 验证 execution record 创建。
  - [ ] 验证 owner / scope 校验。
  - [ ] 验证步骤顺序信息被保留。

## Dev Notes

- 本故事是“提交执行”，不是“展示结果”；流式反馈属于 Story 4.2，结论输出属于 Story 4.3。
- 即使 worker 还很薄，也应先把 execution application service 和 queue / dispatcher port 抽稳，避免未来返工。
- 执行与会话的关联字段从一开始就要明确，因为 4.4、5.x 和 7.x 都要回放它。

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

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1: 提交分析计划到后台执行]
- [Source: _bmad-output/planning-artifacts/architecture.md#应用通信与执行模型]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/4-1-submit-analysis-plan-for-execution.md
