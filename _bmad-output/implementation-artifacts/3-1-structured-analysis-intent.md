# Story 3.1: 生成结构化分析意图

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在提交自然语言问题后看到系统识别出的分析类型和核心目标,
so that 我能确认系统理解的是我真正想分析的问题。

## Acceptance Criteria

1. 用户在分析会话中提交自然语言问题后，系统必须生成结构化分析意图结果。
2. 意图结果至少包含分析类型以及目标指标、主题或核心目标说明。
3. 对于支持范围内的问题，用户必须在 5 秒内看到首个可见反馈；该反馈可以是意图识别结果或处理中状态提示。

## Tasks / Subtasks

- [ ] 建立结构化分析意图 domain model（AC: 1, 2）
  - [ ] 在 domain / application 层定义 intent DTO 或模型，而不是把解析结果散落在页面组件中。
  - [ ] 明确支持范围内的基础分析类型与最小输出字段。
- [ ] 将意图识别接入分析会话流程（AC: 1, 2, 3）
  - [ ] 在服务端分析入口中触发问题理解，不信任浏览器提交的结构化结果。
  - [ ] 将 intent 结果与当前 analysis session 关联。
  - [ ] 首个反馈可为“理解中”或 intent 结果，但不能伪造最终结论。
- [ ] 建立反馈时效与契约测试（AC: 3）
  - [ ] 覆盖支持范围内问题的基础分类与字段提取。
  - [ ] 覆盖首个反馈在 5 秒内可见的故事级验证。

## Dev Notes

- 本故事先建立平台内部的“意图模型与识别契约”，不要求接入真实 LLM、ERP、Cube 或 Neo4j。
- 建议先使用 deterministic stub / rule-based provider 站稳接口，避免一开始把能力实现和系统边界耦死。
- 页面层只负责展示服务器给出的 intent，不承担业务判断。

### Architecture Compliance

- 继续遵循 `Route Handler -> application use case -> domain` 模式。
- 身份和 scope 仍来自服务端会话，不能从客户端传 `userId`、`organizationId` 或权限范围。
- 首个反馈要满足 NFR1，但不能通过客户端假状态掩盖服务端未开始处理的事实。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-intent/` 下新增模型
  - `src/application/analysis-intent/` 或 `src/application/analysis-session/` 下新增 use case
  - `src/app/api/analysis/sessions/route.ts`
  - `src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx`
  - 视需要新增分析页局部组件

### Testing Requirements

- 至少覆盖：
  - 支持范围内问题生成结构化 intent
  - 输出字段包含分析类型与目标说明
  - 首个反馈在 5 秒内可见
  - owner 绑定与会话关联不丢失

### Previous Story Intelligence

- Story 1.4 和 2.4 已建立分析会话创建与持久化边界；3.1 必须把 intent 关联到现有 session，而不是另起一套记录。
- `src/domain/scope-boundary/policy.ts` 已存在范围约束模型，intent 不得绕过现有权限边界假设。
- 后续 3.2 到 3.5 都将基于本故事输出的 intent 继续展开。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1: 生成结构化分析意图]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/planning-artifacts/architecture.md#应用通信与执行模型]
- [Source: _bmad-output/project-context.md#关键实现规则]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/3-1-structured-analysis-intent.md
