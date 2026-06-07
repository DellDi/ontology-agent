---
title: '12.7 follow-up result dedup and turn isolation'
type: 'bugfix'
created: '2026-06-07'
status: 'completed'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-07-analysis-result-ux-correction.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** 多轮追问展开后，页面会重复展示指标结果和候选因素，并且不同轮次可能混用当前 follow-up 的候选因素、假设或结论 cause 信息。业务用户无法判断哪些内容属于当前追问，哪些只是上一轮或诊断信息。

**Approach:** 让每个 conversation turn 使用自己 execution 对应的 projection、events、candidate factors、conclusion cause ids 和 assumptions；在 conversation projection 层对同一轮的结果块做 stable 去重，避免主阅读流重复渲染同一指标表、候选因素表或图表。

## Boundaries & Constraints

**Always:** 保持 canonical truth 来自 execution events、snapshots、projection 和 follow-up facts；保持 renderer registry 只负责渲染，不负责决定 block 是否出现；中文用户文案必须业务可读；任何无法确定归属的历史信息宁可隐藏为诊断，也不能混入当前轮主结果。

**Ask First:** 如果需要改数据库 schema、重写 execution snapshot 格式、删除历史数据、或把多轮线程改成新的 API 协议，必须先停下确认。

**Never:** 不通过吞掉重复 block 来伪装成功；不在页面层硬编码一套新的结果渲染逻辑；不把当前 active follow-up 的候选因素套用到所有历史轮次；不改动 Docker/运行日志。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 多轮追问展开 | 初始轮 + 月份追问轮，各自有 execution snapshot | 展开当前追问时只展示该轮 execution 的结果块；折叠历史轮只显示摘要 | 缺失 projection 时用该轮 events 构建降级 view model |
| 候选因素归属 | 初始轮和追问轮候选因素不同 | 每轮 diagnostics 只使用本轮候选因素；未知时为空摘要，不借用其他轮候选因素 | 不显示错误候选列表 |
| 重复结果块 | 同一 execution 中多个 evidence part 携带相同 table/chart | 主结果只保留一份 stable block | 去重不影响 render error 诊断 |

</frozen-after-approval>

## Code Map

- `src/application/analysis-message-projection/conversation-thread-view-model.ts` -- 多轮 turn 输入与每轮 view model 构建入口。
- `src/application/analysis-message-projection/conversation-view-model.ts` -- 主结果 block 分类、metric card / visualization 提取和 diagnostics 构建。
- `src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx` -- page 级 threadRounds 组装和每轮 facts 注入。
- `tests/story-12-7-follow-up-result-dedup-and-turn-isolation.test.mjs` -- 新增 story regression，覆盖轮次候选因素隔离和结果块去重。

## Tasks & Acceptance

**Execution:**
- [ ] `conversation-thread-view-model.ts` -- 扩展 `ConversationTurnInput` 并传入 `buildConversationViewModel` -- 保证每轮使用自己的 facts。
- [ ] `page.tsx` -- 为初始轮和 follow-up 轮组装 per-turn candidate factors / conclusion cause ids / assumptions -- 避免当前 active follow-up 污染历史轮。
- [ ] `conversation-view-model.ts` -- 增加 result block stable identity 去重 -- 避免重复指标结果和候选因素表。
- [ ] `tests/story-12-7-follow-up-result-dedup-and-turn-isolation.test.mjs` -- 覆盖 I/O matrix -- 防止回归。

**Acceptance Criteria:**
- Given 多轮追问存在不同 execution，when 构建 conversation thread，then 每个 turn 的 view model 只使用该轮传入的 candidate factors 和 conclusion cause ids。
- Given 同一轮 events 中重复出现同标题同 payload 的 table/chart/kv-list，when 构建 conversation view model，then 主结果 blocks、metricCards、visualizations 不重复。
- Given 某一历史轮缺少 candidate factors，when 构建该轮 diagnostics，then 候选验证为空摘要而不是借用当前轮因素。

## Spec Change Log

- 2026-06-07: 实施范围从 12.7 扩展到同一缺陷簇的 12.6/12.8 根因修复：
  - execution job data 正式携带 candidateFactors，worker 在 validate-candidate-factors 的 stage-result metadata 中生成 validatedFactors。
  - 多轮 conversation turn 改为每轮注入自己的 candidateFactors、conclusionCauseIds、planAssumptions。
  - conversation result blocks、metricCards、visualizations 增加语义去重；候选因素表归入诊断而非主图表。
  - analysis conclusion 聚合保留业务 rich blocks，并避免把普通过程阶段误排为原因。

## Design Notes

去重发生在 projection-to-conversation 的应用层，不发生在 renderer 层。这样保留 canonical events 完整性，也避免 renderer registry 反向承载业务选择逻辑。

## Verification

**Commands:**
- `node --test --test-concurrency=1 tests/story-12-6-candidate-validation-metadata.test.mjs tests/story-12-7-follow-up-result-dedup-and-turn-isolation.test.mjs tests/story-12-8-attribution-report-rich-results.test.mjs tests/story-phase-1-result-projection.test.mjs tests/story-12-candidate-validation-diagnostics.test.mjs tests/story-12-3-conversation-view-model-v2.test.mjs` -- actual: 40/40 pass。
- `pnpm exec eslint "src/application/analysis-execution/candidate-factor-validation.ts" "src/domain/analysis-execution/models.ts" "src/application/analysis-execution/submission-use-cases.ts" "src/app/api/analysis/sessions/[sessionId]/execute/route.ts" "src/worker/analysis-execution-renderer.ts" "src/worker/handlers.ts" "src/domain/analysis-result/models.ts" "src/application/ai-runtime/runtime-projection-mapper.ts" "src/application/analysis-message-projection/conversation-view-model.ts" "src/application/analysis-message-projection/conversation-thread-view-model.ts" "src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx" "src/application/analysis-message-projection/candidate-validation-model.ts" "tests/story-12-6-candidate-validation-metadata.test.mjs" "tests/story-12-7-follow-up-result-dedup-and-turn-isolation.test.mjs" "tests/story-12-8-attribution-report-rich-results.test.mjs"` -- actual: pass。
- `pnpm exec tsc --noEmit` -- actual: pass。
- `pnpm lint` -- actual: fail，原因是既有 `scripts/pgloader/migrate-node-fast.js` 使用 CommonJS `require()` 并有未用变量；不属于本次改动文件。已用定向 eslint 验证本次改动通过。
