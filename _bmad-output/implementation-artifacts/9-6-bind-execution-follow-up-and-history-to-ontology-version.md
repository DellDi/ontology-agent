# Story 9.6: 执行结果、追问与历史绑定本体版本

Status: done

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

- [x] 为 execution snapshot 增加 ontology version 绑定（AC: 1, 4）
  - [x] 扩展 `AnalysisExecutionSnapshot` 与对应 Postgres schema，增加 `ontologyVersionId` 或等价稳定引用。
  - [x] 在 execution 提交/保存链路中，明确该次执行读取的是哪个当前生效 ontology version。
  - [x] 不允许采用“回放时再猜当前版本”的方式补 version；执行时必须显式落库。

- [x] 为 follow-up / replan 增加 ontology version 继承语义（AC: 2, 4）
  - [x] 扩展 `AnalysisSessionFollowUp` 与对应持久化表，记录该 follow-up 的 ontology version 基线或结果引用。
  - [x] 明确 follow-up 创建、context 调整、replan、execute 时的版本规则：
    - [x] 继承当前 active grounding / execution 的版本
    - [x] 或在明确切换时写出新版本引用
  - [x] 不允许 follow-up 在没有版本语义的情况下继续只靠自由文本上下文演进。

- [x] 在 history / replay / result display 中暴露 ontology version（AC: 3, 4）
  - [x] 扩展 history read model 或等价投影，使每一轮分析可识别对应 ontology version。
  - [x] 在结果/历史展示中至少提供最小可见版本信息或诊断信息入口，不要求首期做复杂版本 diff UI。
  - [x] 对旧历史数据或迁移前记录，需要定义保守兼容策略，而不是静默显示错误版本。

- [x] 与 grounding 和治理流转对齐（AC: 1, 2, 3）
  - [x] 执行绑定的版本必须来自 `9.4` 发布后的正式生效版本，而不是未发布草稿。
  - [x] grounding 结果若已带版本信息，应在 execution / follow-up 中沿用，不重复推断。
  - [x] 为后续异常诊断留出版本溯源字段，确保能够回答“这条结论为什么和现在不同”。

- [x] 补齐 story 级验证（AC: 1, 2, 3, 4）
  - [x] 验证 execution snapshot 正确保存 ontology version。
  - [x] 验证 follow-up / replan / history 正确继承或切换版本。
  - [x] 验证回放和展示链路可识别版本信息。
  - [x] 验证旧数据兼容路径不会伪造错误版本。

### Review Findings

> Review by: bmad-code-review (2026-05-05) — 三层评审（Blind / Edge Case / Acceptance Auditor）合并后的结果。Decision-needed 必须先解决，再处理 patch。Defer 已记录为后续工作项。

#### Decision-Needed

- [x] [Review][Decision] Conclusion / live-shell badge 永远显示 `inherited`，无法呈现 `switched` — 已采用路线 2：`page.tsx` 通过 `resolveOntologyVersionBindingForDisplay` 合并 snapshot version id 与 active follow-up binding source，结果/直播面板与 history-panel 同源显示 `switched`。
- [x] [Review][Decision] `switched` 判定遗漏「legacy → 真实版本」过渡 — 已采用选项 B：`resolveOntologyVersionBindingSource` 将 `null -> 非 null` 视为 `switched`，明确标记该轮起进入治理化版本。
- [x] [Review][Decision] 缺少 runtime 防线确认绑定的版本是 `published` — 已采用选项 A：submission、snapshot persistence、follow-up create/replan 均接入 ontology version store 守卫；未发布草稿/approved-but-unpublished 版本 fail loud，历史可继续引用已发布后 deprecated 的版本。

#### Patch

- [x] [Review][Patch] Story 文件未同步实现状态 [_bmad-output/implementation-artifacts/9-6-bind-execution-follow-up-and-history-to-ontology-version.md:3] — 已同步 Status、Tasks/Subtasks、Review Findings、File List、Completion Notes 与 sprint-status。
- [x] [Review][Patch] Badge 在 `legacy/unknown` 时呈现冗余 [src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx:85-89] — 已新增 `formatOntologyVersionBindingBadge`，history / conclusion 两处统一渲染：legacy/unknown 显示 `Ontology 旧版本 / 未知`，其他来源保留 `Ontology {source}：{id}`。

#### Defer

- [x] [Review][Defer] `getPlanOntologyVersionId` 直读 `plan._groundedSource` 私有/transitional 字段 [src/domain/ontology/version-binding.ts:31] — deferred, pre-existing；该字段在 `domain/ontology/grounding.ts:264` 注释为 `_transitional: true`，未来重命名或下沉为正式 contract 时本绑定会静默退化为 legacy/unknown。建议后续提供 `OntologyGroundedPlan` 正式契约 + 单测保护。
- [x] [Review][Defer] 迁移 `0005_ancient_xavin.sql` 的两个 index 非 `CONCURRENTLY` 创建 [drizzle/0005_ancient_xavin.sql:4-5] — deferred, pre-existing；当前规模可接受，生产数据放大后短暂阻写需切 concurrent migration 模板。
- [x] [Review][Defer] PG 集成测试缺 DB 不可达守卫 [tests/story-9-6-ontology-version-binding.test.mts:347-421] — deferred, pre-existing；hardcode `127.0.0.1:55432` fallback、无 skip 守卫；与仓库其它 story-pg 测试一致，CI 形态统一改造时再加 `before` 守卫。
- [x] [Review][Defer] 本 commit 顺手关闭 9-5 review（轻度 scope creep）[_bmad-output/implementation-artifacts/9-5-ontology-governance-admin-console.md:1-4] — deferred, pre-existing；不影响代码本身，建议 git commit 时拆为 `9.5 review close` + `9.6 implementation` 两个 commit。
- [x] [Review][Defer] history `buildRound` 在 switched 场景下 snapshot vs followUp version 可能分叉 [src/application/analysis-history/use-cases.ts:329-340] — deferred, pre-existing；优先用 snapshot 的 versionId、fallback followUp，并发编辑下 badge 可能展示 snapshot id 但携带 followUp source 标签，低概率诊断歧义。

#### Dismissed (noise)

- `validateAnalysisExecutionJobData` 中 plan 校验顺序前移：行为等价。
- `submission-use-cases.ts` 末尾 `?? undefined` 形式约束：纯样式。

#### AC 对账

| AC | 结论 | 备注 |
|----|------|------|
| AC1 执行落库版本 | ✅ 实现 | 但 Decision #3：缺 published 守卫 |
| AC2 follow-up / replan 继承或切换 | ⚠ 部分 | Decision #2：legacy→real 不算 switched |
| AC3 历史 / 结果可见版本 | ⚠ 部分 | Decision #1：conclusion panel 不能显示 switched |
| AC4 不另造事实模型 | ✅ 干净 | 沿用 snapshot/follow-up 两张表 + 现有读模型 |

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
- 实现完成（2026-05-05）：
  - `analysis_execution_snapshots` 与 `analysis_session_follow_ups` 增加 `ontology_version_id` 事实字段；follow-up 额外保存 `ontology_version_binding_source`，旧数据以 `legacy/unknown` 显式呈现。
  - execution submission、worker finalize、snapshot persistence、follow-up create/replan、history read model、workspace conclusion/history UI 全链路接入 `OntologyVersionBinding`。
  - `resolveOntologyVersionBindingForDisplay` 让当前 follow-up 的 `switched` source 能正确投影到 conclusion/live-shell，同时保留 snapshot 上的执行版本 id。
  - `resolveOntologyVersionBindingSource` 将 `legacy/unknown -> governed version` 标记为 `switched`，避免从无版本进入治理版本时被误显示为 inherited。
  - runtime 写入边界新增 published-only 守卫：未发布版本 fail loud；已发布后 deprecated 的历史版本允许继续被旧执行/历史引用。
  - `formatOntologyVersionBindingBadge` 统一 history / conclusion badge 文案，避免 `legacy/unknown` 重复展示。
  - Story 回归 `tests/story-9-6-ontology-version-binding.test.mts` 覆盖 execution snapshot、follow-up 继承/切换、history/replay、Postgres 持久化、review D1/D2/D3/P2，共 11 条通过。

### File List

- _bmad-output/implementation-artifacts/9-6-bind-execution-follow-up-and-history-to-ontology-version.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- drizzle/0005_ancient_xavin.sql
- drizzle/meta/0005_snapshot.json
- drizzle/meta/_journal.json
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conclusion-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx
- src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx
- src/app/api/analysis/sessions/[sessionId]/execute/route.ts
- src/app/api/analysis/sessions/[sessionId]/follow-ups/route.ts
- src/app/api/analysis/sessions/[sessionId]/follow-ups/[followUpId]/context/route.ts
- src/app/api/analysis/sessions/[sessionId]/follow-ups/[followUpId]/replan/route.ts
- src/application/analysis-execution/persistence-use-cases.ts
- src/application/analysis-execution/submission-use-cases.ts
- src/application/analysis-history/use-cases.ts
- src/application/follow-up/ports.ts
- src/application/follow-up/use-cases.ts
- src/domain/analysis-execution/models.ts
- src/domain/analysis-execution/persistence-models.ts
- src/domain/analysis-session/follow-up-models.ts
- src/domain/ontology/version-binding.ts
- src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store.ts
- src/infrastructure/analysis-session/postgres-analysis-session-follow-up-store.ts
- src/infrastructure/ontology/runtime.ts
- src/infrastructure/postgres/schema/analysis-execution-snapshots.ts
- src/infrastructure/postgres/schema/analysis-session-follow-ups.ts
- src/shared/ontology/version-binding-display.ts
- src/worker/finalize-analysis-execution.ts
- src/worker/main.ts
- tests/story-9-6-ontology-version-binding.test.mts

### Change Log

- 2026-05-05 完成 Story 9.6：execution snapshot、follow-up、history 与 result display 已绑定 ontology version；review D1/D2/D3/P1/P2 全部收口；`npx tsx --tsconfig tsconfig.json --test tests/story-9-6-ontology-version-binding.test.mts` 11/11 通过，`pnpm exec tsc --noEmit` 通过。
