# Story 6.1: 基于既有结论发起追问

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在已有归因结论上继续追问更细的问题,
so that 我可以逐层下钻到更具体的原因。

## Acceptance Criteria

1. 当当前会话已经存在一轮归因结论时，用户输入新的追问或下钻问题后，系统必须将其附着到原会话上下文中。
2. 追问不能创建脱离上下文的独立分析记录。
3. 当追问引用上一轮中的项目、区域、原因或指标时，系统必须默认复用这些已存在上下文，并允许用户增量补充范围条件。

## Tasks / Subtasks

- [x] 建立 follow-up / iteration 模型（AC: 1, 2, 3）
  - [x] 为会话内轮次或追问记录建立显式结构。
  - [x] 保证追问与原 session、上一轮结论、上下文之间的关联稳定。
- [x] 接入追问提交入口（AC: 1, 2, 3）
  - [x] 新增 follow-up route 或 application service。
  - [x] 默认复用上一轮上下文并允许增量输入。
- [x] 覆盖追问附着与复用测试（AC: 1, 2, 3）
  - [x] 验证追问不生成新 session。
  - [x] 验证上一轮上下文被默认复用。

## Dev Notes

- 这是“在同一会话内继续一轮”，不是新建独立分析。
- iteration / follow-up 模型会影响 6.2 到 6.4 的历史、重规划和演化展示。
- 追问入口仍应通过服务端身份与权限边界处理。

### Architecture Compliance

- follow-up 写入必须走服务端 Route Handler 或 Server Action。
- 不得允许客户端指定非本人 session 作为追问挂载目标。
- 追问依赖现有结果持久化和会话 owner 边界。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-session/` 扩展 iteration / follow-up 模型
  - `src/application/follow-up/`
  - 新增 follow-up route
  - analysis detail page 追问入口

### Testing Requirements

- 至少覆盖：
  - 追问附着到原会话
  - 不创建新 session ID
  - 默认复用上一轮上下文
  - owner 越权失败

### Previous Story Intelligence

- Story 5.4 必须先保留既有计划、结果和结论，否则无法可靠承接追问。
- 本故事会为 7.3 的移动端轻量追问提供基础会话内多轮模型。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.1: 基于既有结论发起追问]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#应用通信与执行模型]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --test --test-concurrency=1 tests/story-6-1-follow-up-on-existing-conclusion.test.mjs`
- `npm run lint`
- `npm run build`
- `node --test --test-concurrency=1 tests/story-3-3-context-correction.test.mjs tests/story-5-1-analysis-execution.test.mjs tests/story-6-1-follow-up-on-existing-conclusion.test.mjs`

### Completion Notes List

- 新增显式 follow-up 持久化模型，追问记录与原 session、最新 execution 和继承上下文稳定关联。
- 新增服务端 follow-up route，默认复用当前确认上下文并写入 merged context，不会创建新的 analysis session。
- 会话页新增追问入口和历史列表，用户可在已有归因结论上继续下钻并看到追问附着结果。

### File List

- _bmad-output/implementation-artifacts/6-1-follow-up-on-existing-conclusion.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- drizzle/0008_analysis_session_follow_ups.sql
- drizzle/meta/_journal.json
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-follow-up-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/app/api/analysis/sessions/[sessionId]/follow-ups/route.ts
- src/application/follow-up/ports.ts
- src/application/follow-up/use-cases.ts
- src/domain/analysis-session/follow-up-models.ts
- src/infrastructure/analysis-session/postgres-analysis-session-follow-up-store.ts
- src/infrastructure/postgres/schema/analysis-session-follow-ups.ts
- src/infrastructure/postgres/schema/index.ts
- tests/story-6-1-follow-up-on-existing-conclusion.test.mjs
