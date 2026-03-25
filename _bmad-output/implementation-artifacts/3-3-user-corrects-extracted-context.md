# Story 3.3: 用户修正抽取结果

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 在系统理解有偏差时修正指标、范围或比较条件,
so that 后续分析计划建立在我确认过的上下文上。

## Acceptance Criteria

1. 用户修改指标、实体、时间范围或比较条件后，系统必须将修正结果保存为当前会话上下文。
2. 后续规划与执行必须基于修正后的上下文，而不是继续沿用旧版本。
3. 当用户撤销一次错误修正时，系统必须恢复到上一个已确认的上下文状态，并保留原始问题文本。

## Tasks / Subtasks

- [ ] 建立上下文修正与版本回退模型（AC: 1, 2, 3）
  - [ ] 为上下文确认、修正、撤销定义显式版本或确认状态。
  - [ ] 保留原始问题文本，不允许修正覆盖问题源输入。
- [ ] 增加服务端写入口（AC: 1, 2）
  - [ ] 通过 Route Handler 或 Server Action 保存修正，不能只存在 client state。
  - [ ] 后续计划生成逻辑必须读取“当前确认版本”。
- [ ] 覆盖修正 / 撤销 / 越权测试（AC: 1, 2, 3）
  - [ ] 验证修正后重新读取会话得到最新上下文。
  - [ ] 验证撤销回到上一个确认版本。
  - [ ] 验证跨用户或无权限修改被拒绝。

## Dev Notes

- 修正是服务端事实写入，不是前端局部编辑体验优化。
- 建议从一开始就考虑“上一个确认版本”的恢复路径，避免把所有历史压成不可逆 blob。
- 这一步决定 Story 5.2 / 5.3 的后续纠偏模型是否可持续复用。

### Architecture Compliance

- 用户身份仍来自服务端会话，不能通过表单传 `ownerUserId`。
- 修正和撤销都应走 application 层，页面只负责触发动作和展示结果。
- 不得让浏览器直接写数据库或绕过 domain 校验拼装上下文对象。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-context/`
  - `src/application/analysis-context/`
  - `src/app/api/analysis/sessions/[sessionId]/context/route.ts`
  - 分析页上下文编辑组件
  - 视需要扩展 Postgres 持久化结构

### Testing Requirements

- 至少覆盖：
  - 修正后读取到最新上下文
  - 撤销恢复上一个确认版本
  - 原始问题文本不丢失
  - owner 越权修改失败

### Previous Story Intelligence

- Story 3.2 已产出上下文 read model，本故事在此基础上增加修改与确认能力。
- 3.3 的版本化选择将直接影响 5.2 补充条件与 5.4 多轮历史是否能稳定演进。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3: 用户修正抽取结果]
- [Source: _bmad-output/planning-artifacts/prd.md#功能需求]
- [Source: _bmad-output/project-context.md#关键实现规则]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- _Pending during implementation._

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- _bmad-output/implementation-artifacts/3-3-user-corrects-extracted-context.md
