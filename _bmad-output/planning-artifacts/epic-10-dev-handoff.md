# Epic 10 Dev Handoff

**Author:** Codex
**Date:** 2026-04-09
**Purpose:** 明天换电脑后可直接开工的 Epic 10 开发顺序与工件索引

## What Is Ready

Epic 10 当前已经具备完整的开发前置工件：

- 规划层：
  - [epics.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/epics.md)
  - [architecture.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/architecture.md)
  - [prd.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/prd.md)
  - [sprint-change-proposal-2026-04-09-vercel-ai-sdk.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09-vercel-ai-sdk.md)
- UX 层：
  - [ux-design-specification.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-design-specification.md)
  - [ux-epic-10-ai-native-interaction-addendum.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-epic-10-ai-native-interaction-addendum.md)
  - [ux-epic-10-main-canvas-wireframes.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-epic-10-main-canvas-wireframes.md)
- Story 层：
  - [10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md)
  - [10-2-renderer-registry-for-rich-analysis-blocks.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-2-renderer-registry-for-rich-analysis-blocks.md)
  - [10-3-ui-message-projection-persistence-and-resume.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-3-ui-message-projection-persistence-and-resume.md)
  - [10-4-runtime-bridge-for-memory-knowledge-skills-and-tools.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-4-runtime-bridge-for-memory-knowledge-skills-and-tools.md)
  - [10-5-mobile-projection-and-lightweight-follow-up-on-shared-interaction-schema.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-5-mobile-projection-and-lightweight-follow-up-on-shared-interaction-schema.md)

## Development Order

推荐的实际开发顺序不是简单按 story 编号平铺，而是按风险和依赖推进：

1. `10.1`
   先站稳 runtime contract、execution facts -> messages/parts mapper、AI SDK adapter、live shell consumption。
2. `10.2` 第一刀
   只做 foundation parts、`evidence-card`、`conclusion-card`、`table` 和 registry 基础路径。
3. `10.3`
   在主画布骨架不变的前提下补 projection persistence、resume、history replay。
4. `10.5`
   消费既有 interaction schema 和 projection，做 mobile 受限投影。
5. `10.4`
   作为 runtime capability 扩展面推进，但不阻塞 10.1-10.3 的主画布闭环。

## First Practical Cut

如果明天只想开第一刀，建议只做这些：

### Story 10.1 First Cut

- 建 `src/application/ai-runtime/` contract
- 建 execution facts -> message/part mapper
- 建 `src/infrastructure/ai-runtime/` adapter
- 改 `analysis-execution-live-shell.tsx` 消费 runtime projection

### Story 10.2 First Cut

- part taxonomy 的代码化基础
- renderer registry 基础设施
- `status-banner`
- `step-timeline`
- `evidence-card`
- `conclusion-card`
- `table`

做到这里，就已经能证明 Epic 10 路线成立。

## Non-Negotiable Boundaries

无论哪台电脑上继续推进，以下边界都不能丢：

- canonical truth 仍然是 execution events、snapshots、result blocks、follow-up/history
- `Vercel AI SDK` 是 AI application runtime layer，不是 orchestration truth
- PC/mobile 是同源 projection，不是两套协议
- `Context Rail` 不是第二条主叙事线
- `resume` 是恢复 projection，不是重建事实
- `memory / knowledge / skills / tools` 通过 runtime bridge 接入，但不替代 ontology / governance / audit

## Immediate File Targets

### For 10.1

- `src/application/ai-runtime/`
- `src/infrastructure/ai-runtime/`
- `src/app/api/analysis/sessions/[sessionId]/stream/route.ts`
- `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx`

### For 10.2

- `src/application/analysis-interaction/`
- `src/domain/analysis-execution/stream-models.ts`
- `src/domain/analysis-result/models.ts`
- `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx`
- `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conclusion-panel.tsx`

### For 10.3

- `src/domain/analysis-message-projection/`
- `src/application/analysis-message-projection/`
- `src/infrastructure/postgres/schema/analysis-ui-message-projections.ts`
- `src/app/(workspace)/workspace/analysis/[sessionId]/analysis-execution-display.ts`

## Validation Order

每次实现都按这个顺序验证：

1. 先跑目标 story 测试
2. 再回归 `5.2 / 5.4 / 6.4`
3. 再跑 `pnpm lint`
4. 再跑 `pnpm build`

如果 `10.1` 之后旧的流式执行、快照持久化或多轮历史退化，先修根因，不进入 `10.2`。

## Tomorrow Resume Checklist

明天换电脑后直接做：

1. 拉到包含这些文档改动的最新代码
2. 如本地数据库落后，先跑 `pnpm db:migrate`
3. 打开 [10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md)
4. 同时参考：
   - [ux-epic-10-ai-native-interaction-addendum.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-epic-10-ai-native-interaction-addendum.md)
   - [ux-epic-10-main-canvas-wireframes.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-epic-10-main-canvas-wireframes.md)
5. 从 `10.1 First Cut` 开始实现

## References

- [sprint-status.yaml](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/sprint-status.yaml)
- [ux-epic-10-ai-native-interaction-addendum.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-epic-10-ai-native-interaction-addendum.md)
- [ux-epic-10-main-canvas-wireframes.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/planning-artifacts/ux-epic-10-main-canvas-wireframes.md)
- [10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-1-ai-application-runtime-layer-and-vercel-ai-sdk-adapter.md)
- [10-2-renderer-registry-for-rich-analysis-blocks.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-2-renderer-registry-for-rich-analysis-blocks.md)
- [10-3-ui-message-projection-persistence-and-resume.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-3-ui-message-projection-persistence-and-resume.md)
- [10-4-runtime-bridge-for-memory-knowledge-skills-and-tools.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-4-runtime-bridge-for-memory-knowledge-skills-and-tools.md)
- [10-5-mobile-projection-and-lightweight-follow-up-on-shared-interaction-schema.md](/Users/zhouxia/Documents/open-code/ontology-agent/_bmad-output/implementation-artifacts/10-5-mobile-projection-and-lightweight-follow-up-on-shared-interaction-schema.md)
