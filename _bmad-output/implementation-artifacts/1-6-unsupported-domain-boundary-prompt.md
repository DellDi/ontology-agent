# Story 1.6: 非支持领域问题的边界提示

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 物业分析用户,
I want 当我尝试进入非支持领域时收到明确提示,
so that 我知道当前版本只支持物业分析，不会误以为平台支持客服或其他业务系统能力。

## Acceptance Criteria

1. 对明显属于客服系统、客服会话、营销或呼叫中心的问题，系统提示当前版本仅支持物业分析。
2. 这些问题不会进入后续分析流程。
3. 工作台帮助信息中明确支持范围与不支持范围。

## Tasks / Subtasks

- [x] 建立范围边界判定能力（AC: 1, 2）
  - [x] 在会话创建入口之前增加“是否属于支持领域”的判定步骤。
  - [x] 先采用可解释、可替换的判定策略，例如规则表或受控分类器接口。
  - [x] 判定逻辑应易于后续接入更强的意图识别，但本故事不需要引入复杂模型编排。
- [x] 在新建分析流程中接入边界拦截（AC: 1, 2）
  - [x] 当输入属于不支持领域时，阻止创建分析会话或阻止进入后续流程。
  - [x] 返回统一、清晰、非歧义的提示文案。
  - [x] 不把这类请求继续投递给后续分析、规划或执行模块。
- [x] 在工作台中补充范围说明（AC: 3）
  - [x] 在首页、帮助区或空状态提示中明确当前支持范围与不支持范围。
  - [x] 文案应明确写出“客服系统相关能力不在当前版本范围内”。
- [x] 让边界提示符合品牌与一致性规范（AC: 1, 2, 3）
  - [x] 边界拦截卡或提示样式应符合 UX 中定义的反馈模式和品牌语气。
  - [x] 提示要清晰、克制、可恢复，避免制造“报错式惊吓感”。
  - [x] 在 PC 与移动端都保持一致的边界说明语义，但允许不同的信息密度。
- [x] 保持实现可维护性（AC: 1, 2, 3）
  - [x] 将边界判定封装在应用层或领域服务中，不把规则散落在多个页面组件里。
  - [x] 为后续 Epic 2 的意图识别预留单一接入点，避免重复判断逻辑。
- [x] 完成验证（AC: 1, 2, 3）
  - [x] 验证支持领域问题可继续创建，会外领域问题被阻止。
  - [x] 验证帮助信息能看到支持/不支持范围说明。
  - [x] 运行 `pnpm lint` 与 `pnpm build`。

## Dev Notes

- 这不是完整的意图识别故事；本故事只解决“产品范围边界是否被明确表达和执行”。
- 判定策略应优先可解释和可替换，避免在 Epic 1 就引入不可控黑盒模型依赖。
- 拦截位置建议尽量靠近会话创建入口，这样可以避免后续链路无效消耗。
- 工作台提示文案要和 PRD 的范围定义保持一致，尤其要明确排除客服系统、CRM、营销、呼叫中心。
- UX 已明确错误 / 警告反馈模式，因此本故事的提示不能只是技术错误 toast，而应成为可理解的产品边界说明。

### Project Structure Notes

- 建议文件落点：
  - `src/application/scope-boundary/`
  - `src/domain/scope-boundary/`
  - `src/app/api/analysis/sessions/route.ts`（创建前接入边界判定）
  - `src/app/(workspace)/page.tsx` 或 `src/app/(workspace)/help/page.tsx`
- 不建议把边界判定写死在 `page.tsx` 中；应通过可复用服务封装。

### References

- [Source: {project-root}/_bmad-output/planning-artifacts/epics.md#Story 1.6: 非支持领域问题的边界提示]
- [Source: {project-root}/_bmad-output/planning-artifacts/prd.md#明确不做]
- [Source: {project-root}/_bmad-output/planning-artifacts/prd.md#FR-14 领域聚焦]
- [Source: {project-root}/_bmad-output/planning-artifacts/architecture.md#项目上下文分析]
- [Source: {project-root}/_bmad-output/planning-artifacts/ux-design-specification.md#Desired Emotional Response]
- [Source: {project-root}/_bmad-output/planning-artifacts/ux-design-specification.md#UX Consistency Patterns]
- [Source: {project-root}/_bmad-output/implementation-artifacts/1-4-create-analysis-session.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- 先补一条独立集成测试，覆盖工作台支持/不支持范围说明、支持范围内问题可继续、会外问题被阻止三条主路径。
- 将范围判定从分析会话模型内部抽出为独立领域策略，保持规则可解释且便于后续替换。
- 在工作台右侧补充明确的范围说明卡片，让“支持范围 / 不支持范围 / 边界说明”成为稳定 UI 资产，而不是一次性错误提示。
- 继续复用 Story 1.4 的会话创建入口，只在创建前执行边界策略，不引入额外的路由分叉。

### Debug Log References

- `node --test tests/story-1-6-scope-boundary.test.mjs`（先失败，后通过）
- `node --test --test-concurrency=1 tests/story-1-3-workspace-home.test.mjs tests/story-1-4-analysis-session.test.mjs tests/story-1-6-scope-boundary.test.mjs`
- `node --test --test-concurrency=1 tests/story-1-1-foundation.test.mjs tests/story-1-2-auth.test.mjs tests/story-1-3-workspace-home.test.mjs tests/story-1-4-analysis-session.test.mjs tests/story-1-5-history.test.mjs tests/story-1-6-scope-boundary.test.mjs`
- `pnpm lint`
- `pnpm build`

### Completion Notes List

- 本故事默认与 Story 1.4 的会话创建入口集成，避免额外分叉入口。
- 本故事只做边界表达与阻断，不替代 Epic 2 的结构化意图识别。
- 本故事已补充 UX 对边界提示语气和反馈样式的约束。
- 范围边界规则已从分析会话模型中抽出到独立的 `scope-boundary` 领域策略，当前采用可解释规则表，后续可直接替换为更强的受控分类能力。
- 工作台右侧新增了稳定的“范围说明”卡片，明确列出支持范围、不支持范围，以及“客服系统相关能力不在当前版本范围内”的产品边界。
- 会外问题仍在会话创建入口被拦截，但提示文案已经升级为更明确的产品边界说明，不会继续进入后续分析流程。
- Story 1.3 的首页测试已同步调整为新的产品事实：首页现在应该明确展示范围说明，而不是回避相关字样。
- `node --test --test-concurrency=1 tests/story-1-1-foundation.test.mjs tests/story-1-2-auth.test.mjs tests/story-1-3-workspace-home.test.mjs tests/story-1-4-analysis-session.test.mjs tests/story-1-5-history.test.mjs tests/story-1-6-scope-boundary.test.mjs`、`pnpm lint`、`pnpm build` 全部通过。
- Epic 1 review 修复后，范围边界归一化已补充 `NFKC` 标准化和空白折叠，`C R M`、全角字符、拆字输入等变体也会被稳定拦截。

### File List

- {project-root}/_bmad-output/implementation-artifacts/1-6-unsupported-domain-boundary-prompt.md
- {project-root}/_bmad-output/implementation-artifacts/sprint-status.yaml
- {project-root}/src/app/(workspace)/_components/workspace-home-shell.tsx
- {project-root}/src/application/workspace/home.ts
- {project-root}/src/domain/analysis-session/models.ts
- {project-root}/src/domain/scope-boundary/policy.ts
- {project-root}/tests/story-1-3-workspace-home.test.mjs
- {project-root}/tests/story-1-6-scope-boundary.test.mjs

## Change Log

- 2026-03-25：完成 Story 1.6，实现非支持领域边界策略、工作台范围说明和统一阻断提示。
- 2026-03-27：完成 Epic 1 review 修复回写，补充变体关键词归一化拦截，并回写为 done。
