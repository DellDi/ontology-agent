# Story 9.6: 执行结果、追问与历史绑定本体版本

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户和平台团队,
I want 让 execution、follow-up 与 history 绑定 ontology version,
so that 结论来源、历史回放和问题诊断可以追溯到明确的知识版本。

## Acceptance Criteria

1. 当某次分析执行被提交并保存 execution snapshot 时，系统必须记录该次执行所使用的 ontology version 或等价稳定引用。
2. 当 follow-up、replan 和多轮 history 继续基于已有分析结果推进时，系统必须继承或显式切换 ontology version，并能够说明该轮分析基于哪个知识版本。
3. 历史回放、结果展示和诊断链路必须能够读取 ontology version 信息，以便判断结论是基于哪一版定义生成的。
4. ontology version 绑定必须建立在现有 execution snapshot、follow-up、history canonical facts 之上，不得为了加版本号再发明第二套历史事实模型。

## Tasks / Subtasks

- [ ] 为 execution snapshot 增加 ontology version 绑定（AC: 1, 4）
  - [ ] 扩展 `AnalysisExecutionSnapshot` 与对应 Postgres schema，增加 `ontologyVersionId` 或等价稳定引用。
  - [ ] 在 execution 提交/保存链路中，明确该次执行读取的是哪个当前生效 ontology version。
  - [ ] 不允许采用“回放时再猜当前版本”的方式补 version；执行时必须显式落库。

- [ ] 为 follow-up / replan 增加 ontology version 继承语义（AC: 2, 4）
  - [ ] 扩展 `AnalysisSessionFollowUp` 与对应持久化表，记录该 follow-up 的 ontology version 基线或结果引用。
  - [ ] 明确 follow-up 创建、context 调整、replan、execute 时的版本规则：
    - [ ] 继承当前 active grounding / execution 的版本
    - [ ] 或在明确切换时写出新版本引用
  - [ ] 不允许 follow-up 在没有版本语义的情况下继续只靠自由文本上下文演进。

- [ ] 在 history / replay / result display 中暴露 ontology version（AC: 3, 4）
  - [ ] 扩展 history read model 或等价投影，使每一轮分析可识别对应 ontology version。
  - [ ] 在结果/历史展示中至少提供最小可见版本信息或诊断信息入口，不要求首期做复杂版本 diff UI。
  - [ ] 对旧历史数据或迁移前记录，需要定义保守兼容策略，而不是静默显示错误版本。

- [ ] 与 grounding 和治理流转对齐（AC: 1, 2, 3）
  - [ ] 执行绑定的版本必须来自 `9.4` 发布后的正式生效版本，而不是未发布草稿。
  - [ ] grounding 结果若已带版本信息，应在 execution / follow-up 中沿用，不重复推断。
  - [ ] 为后续异常诊断留出版本溯源字段，确保能够回答“这条结论为什么和现在不同”。

- [ ] 补齐 story 级验证（AC: 1, 2, 3, 4）
  - [ ] 验证 execution snapshot 正确保存 ontology version。
  - [ ] 验证 follow-up / replan / history 正确继承或切换版本。
  - [ ] 验证回放和展示链路可识别版本信息。
  - [ ] 验证旧数据兼容路径不会伪造错误版本。

## Dev Notes

- `9.6` 的作用是把治理体系真正接到运行事实层。没有这一步，ontology registry 和治理后台都只是“定义存在”，无法解释某条历史结论为什么会那样。
- 这张 story 重点是**绑定现有事实模型**，不是再造一套版本历史系统。
- 如果最后只是把 version 显示在页面上，但 execution / follow-up / history 本身没有落库绑定，这张 story就没完成。

### Review Adjustments

- 需要补一条最小 UI 规则：历史回放和多轮追问中，每一轮至少可见 `ontology version badge`，并区分：
  - `inherited`
  - `switched`
  - `legacy/unknown`
- 对“同一 follow-up 链跨版本”的场景，文档应明确展示原则：版本信息按轮次显示，不允许把整条链压成单一版本标签。
- 对迁移前旧数据，建议显式展示 `legacy/unknown`，不要伪造为当前版本，也不要静默留空。

### Architecture Compliance

- 必须遵循 [ontology-governance-architecture.md]({project-root}/_bmad-output/planning-artifacts/ontology-governance-architecture.md#10. Phase 4: 建立本体约束下的执行与结论)：
  - execution snapshot 增加 ontology version 引用
  - follow-up / replan 基于 grounded context
  - 历史回放可识别结论所用知识版本
- 必须建立在现有 canonical runtime facts 上：
  - `analysis_execution_snapshots`
  - `analysis_session_follow_ups`
  - history read model
- 不得为了补版本追踪重做历史体系或另造 projection truth。

### Library / Framework Requirements

- 继续沿用现有 execution snapshot、follow-up store、history use case 和 Postgres schema 路线。
- 不引入新事件溯源框架。
- 保持与现有 worker / submission / replay 主链兼容。

### File Structure Requirements

- 重点文件预计包括：
  - `src/domain/analysis-execution/persistence-models.ts`
  - `src/domain/analysis-session/follow-up-models.ts`
  - `src/application/analysis-history/use-cases.ts`
  - `src/application/follow-up/`
  - `src/application/analysis-execution/`
  - `src/infrastructure/postgres/schema/analysis-execution-snapshots.ts`
  - `src/infrastructure/postgres/schema/analysis-session-follow-ups.ts`
  - `tests/story-9-6-*.test.mjs`

### Testing Requirements

- 至少覆盖：
  - 新执行保存 ontology version
  - follow-up / replan 继承版本
  - history / replay 读取版本
  - 旧数据兼容
- 若涉及页面展示，只要求最小可见版本信息，不做复杂 UI 特效。

### Previous Story Intelligence

- `9.3` 已把运行时输入边界切到 grounded context；`9.6` 要把这种 grounding 结果落成可追溯版本事实。
- Epic 6 已经把 follow-up、replan、history 做成正式数据库事实；`9.6` 必须复用这条链，而不是另起一套版本历史。
- Epic 5 已经把 execution snapshot 与回放站稳；ontology version 最自然的落点就是这里。

### Git Intelligence Summary

- 当前仓库已经形成“运行事实落 Postgres、页面读 read model”的模式。`9.6` 应继续沿用，不要把版本追踪只放到页面 projection。

### Latest Technical Information

- 当前 `AnalysisExecutionSnapshot` 结构中还没有 ontology version 字段。
- 当前 `AnalysisSessionFollowUp` 已包含 `referencedExecutionId / resultExecutionId / mergedContext / planVersion` 等字段，是最合适的扩展位置之一。
- 当前 history 面板已能按轮次回看，这为展示 ontology version 提供了自然位置。

### Project Structure Notes

- 本 story 不负责治理后台页面，那是 `9.5`。
- 本 story 不负责审批发布流程，那是 `9.4`。
- 本 story 的重点是“版本绑定与溯源”，不是“版本编辑”。

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.6: 执行结果、追问与历史绑定本体版本]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#10. 建议实施顺序]
- [Source: _bmad-output/planning-artifacts/ontology-governance-architecture.md#Phase 4: 建立本体约束下的执行与结论]
- [Source: src/domain/analysis-execution/persistence-models.ts]
- [Source: src/domain/analysis-session/follow-up-models.ts]
- [Source: _bmad-output/implementation-artifacts/9-3-ontology-grounding-for-context-planning-and-tool-selection.md]
- [Source: _bmad-output/project-context.md#关键实现规则]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Completion Notes List

- Story created as the runtime fact binding phase for Epic 9, focused on attaching ontology version semantics to existing execution, follow-up, and history facts.

### File List

- _bmad-output/implementation-artifacts/9-6-bind-execution-follow-up-and-history-to-ontology-version.md
