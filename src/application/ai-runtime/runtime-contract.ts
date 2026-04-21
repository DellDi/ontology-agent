/**
 * AI Application Runtime Layer — Interaction Contract.
 *
 * Story 10.1 First-Cut 只承诺：
 *   - 定义 application 层 runtime 的消息 / parts / projection 接口
 *   - 承载从 execution facts 到交互 projection 的映射语义
 *
 * 明确不承诺的事：
 *   - 不承担 execution planning、Worker orchestration、result persistence、ontology governance
 *   - 不引入独立于服务端事实的第二套协议
 *   - 不替代 canonical truth（event/snapshot/follow-up/conclusion/ontology）
 *
 * 参考：
 *   - Story 10.1 Dev Notes → Primary Narrative Lane / Context Rail / Action Layer
 *   - foundation parts: status-banner / step-timeline / evidence-card / conclusion-card / resume-anchor
 */

import type {
  AnalysisExecutionStreamEvent,
  ExecutionRenderBlock,
  ExecutionStageSnapshot,
  ExecutionStepSnapshot,
} from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { JobStatus } from '@/domain/job-contract/models';

// ---------------------------------------------------------------------------
// Foundation Part Types
//
// 这些 part 仅用于“交互投影”，不构成业务真相。
// 任何业务语义仍需回到上游 ontology / execution event / conclusion read model。
// ---------------------------------------------------------------------------

export const AI_RUNTIME_PART_KINDS = [
  'status-banner',
  'step-timeline',
  'evidence-card',
  'conclusion-card',
  'resume-anchor',
] as const;

export type AiRuntimePartKind = (typeof AI_RUNTIME_PART_KINDS)[number];

export type StatusBannerTone = 'neutral' | 'info' | 'success' | 'error';

/**
 * Story 10.1.p1：foundation part 稳定 id 策略。
 *
 * - 所有 foundation parts 必须携带显式 `id`，作为 UI / renderer registry / SDK 层的一级键。
 * - id 必须由 canonical truth 的稳定锚点（sessionId / executionId / event.sequence）纯函数推导，
 *   禁用 `Date.now()` / `Math.random()` / `crypto.randomUUID()` 等非确定性源。
 * - 同一 canonical 输入两次映射必须产生完全相同的 id 序列（幂等）。
 *
 * 生成规则（单一入口 `computeAiRuntimePartId`）：
 *   status-banner   → `status-banner::{sessionId}::{executionId}`
 *   step-timeline   → `step-timeline::{sessionId}::{executionId}`
 *   evidence-card   → `evidence::{sessionId}::{executionId}::seq-{eventSequence}`
 *   conclusion-card → `conclusion::{sessionId}::{executionId}`
 *   resume-anchor   → `resume-anchor::{sessionId}::{executionId}`
 *
 * 扩展规则：
 *   - 若后续 evidence-card 按 block 拆分，应追加 `::block-{blockIndex}` 而不是重写现有规则，
 *     以保持"id 只追加新段、不删不改已有段"的向后兼容承诺。
 */
export type AiRuntimePartIdAnchors = {
  sessionId: string;
  executionId: string;
  /** evidence-card 必填：对应 canonical event.sequence。其他 kind 忽略。 */
  eventSequence?: number;
};

export function computeAiRuntimePartId(
  kind: AiRuntimePartKind,
  anchors: AiRuntimePartIdAnchors,
): string {
  switch (kind) {
    case 'status-banner':
      return `status-banner::${anchors.sessionId}::${anchors.executionId}`;
    case 'step-timeline':
      return `step-timeline::${anchors.sessionId}::${anchors.executionId}`;
    case 'evidence-card':
      if (anchors.eventSequence === undefined) {
        throw new Error(
          'computeAiRuntimePartId(evidence-card) requires anchors.eventSequence',
        );
      }
      return `evidence::${anchors.sessionId}::${anchors.executionId}::seq-${anchors.eventSequence}`;
    case 'conclusion-card':
      return `conclusion::${anchors.sessionId}::${anchors.executionId}`;
    case 'resume-anchor':
      return `resume-anchor::${anchors.sessionId}::${anchors.executionId}`;
  }
}

// ---------------------------------------------------------------------------
// Story 10.1.p2：slot / lane / placement 显式布局语义
//
// 设计目标：
//   - 把 10.1 First-Cut 的 implicit 数组顺序升级为 explicit 布局契约
//   - 为 10.2 renderer registry 与未来多前端（Web / Mobile / Expert Mode）
//     按语义（而非数组 index）命中 renderer 提供稳定键
//
// 字段语义：
//   - slot：part 所属的叙事位置（narrative 区 / 流程板 / 恢复点）
//   - lane：叙事重要性（主叙事 vs 辅助），renderer 可据此决定视觉层级
//   - placement：在 slot 内部的相对位置（inline / sticky / floating）
//
// 扩展规则：
//   - 新增枚举值必须通过独立 patch story 推进，不得 free-string
//   - renderer 的具体布局实现由 10.2 承接，本契约只负责语义标签
// ---------------------------------------------------------------------------

export const AI_RUNTIME_PART_SLOTS = [
  'narrative-header',
  'narrative-body',
  'narrative-footer',
  'process-board',
  'resume',
] as const;
export type AiRuntimePartSlot = (typeof AI_RUNTIME_PART_SLOTS)[number];

export const AI_RUNTIME_PART_LANES = ['primary', 'secondary'] as const;
export type AiRuntimePartLane = (typeof AI_RUNTIME_PART_LANES)[number];

export const AI_RUNTIME_PART_PLACEMENTS = [
  'inline',
  'sticky-top',
  'sticky-bottom',
  'floating',
] as const;
export type AiRuntimePartPlacement =
  (typeof AI_RUNTIME_PART_PLACEMENTS)[number];

/**
 * Foundation part base：所有 part 必须携带稳定 id 与显式布局语义。
 *   - id 由 `computeAiRuntimePartId` 统一生成，调用方不得手写
 *   - slot / lane / placement 由 `resolveAiRuntimePartLayout` 统一解析，
 *     保证语义在 mapper 内不散落
 */
export type AiRuntimePartBase = {
  id: string;
  slot: AiRuntimePartSlot;
  lane: AiRuntimePartLane;
  placement: AiRuntimePartPlacement;
};

/**
 * 把 part kind 映射为稳定的 slot / lane / placement。
 * 这里与 10.1 First-Cut 的 Primary Narrative Lane 顺序语义严格对齐，
 * 保证视觉叙事不退化。
 */
export function resolveAiRuntimePartLayout(kind: AiRuntimePartKind): {
  slot: AiRuntimePartSlot;
  lane: AiRuntimePartLane;
  placement: AiRuntimePartPlacement;
} {
  switch (kind) {
    case 'status-banner':
      return { slot: 'narrative-header', lane: 'primary', placement: 'sticky-top' };
    case 'step-timeline':
      // Expert Mode / 10.6 流程板是否把 timeline fork 到 process-board 由 10.2 决定，
      // 本契约默认把 timeline 留在 primary narrative 内，保持与 First-Cut 一致。
      return { slot: 'narrative-body', lane: 'primary', placement: 'inline' };
    case 'evidence-card':
      return { slot: 'narrative-body', lane: 'primary', placement: 'inline' };
    case 'conclusion-card':
      return { slot: 'narrative-footer', lane: 'primary', placement: 'inline' };
    case 'resume-anchor':
      return { slot: 'resume', lane: 'primary', placement: 'floating' };
  }
}

export type AiRuntimeStatusBannerPart = AiRuntimePartBase & {
  kind: 'status-banner';
  status: JobStatus;
  label: string;
  tone: StatusBannerTone;
  message?: string;
};

export type AiRuntimeStepTimelinePart = AiRuntimePartBase & {
  kind: 'step-timeline';
  steps: ExecutionStepSnapshot[];
  currentStage?: ExecutionStageSnapshot;
};

export type AiRuntimeEvidenceCardPart = AiRuntimePartBase & {
  kind: 'evidence-card';
  /**
   * 每张 evidence card 追溯到产生它的原始事件 id，
   * 便于后续 resume / history replay 时保持和 canonical event 对齐。
   */
  sourceEventId: string;
  sequence: number;
  title?: string;
  blocks: ExecutionRenderBlock[];
};

export type AiRuntimeConclusionCardPart = AiRuntimePartBase & {
  kind: 'conclusion-card';
  readModel: AnalysisConclusionReadModel;
};

export type AiRuntimeResumeAnchorPart = AiRuntimePartBase & {
  kind: 'resume-anchor';
  sessionId: string;
  executionId: string;
  lastSequence: number;
  status: JobStatus;
  isTerminal: boolean;
};

export type AiRuntimeMessagePart =
  | AiRuntimeStatusBannerPart
  | AiRuntimeStepTimelinePart
  | AiRuntimeEvidenceCardPart
  | AiRuntimeConclusionCardPart
  | AiRuntimeResumeAnchorPart;

// ---------------------------------------------------------------------------
// Messages & Projection
// ---------------------------------------------------------------------------

/**
 * Runtime message 是交互层单轮“assistant 叙事”的最小承载单位。
 *
 * 稳定顺序约束（Primary Narrative Lane）：
 *   status-banner → step-timeline → evidence-card* → conclusion-card → resume-anchor
 * 这个顺序直接决定 Epic 10 后续 renderer / projection 能否复用同一套语法。
 */
export type AiRuntimeMessage = {
  id: string;
  role: 'assistant';
  parts: AiRuntimeMessagePart[];
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Story 10.1.p3：schemaVersion / contractVersion 显式版本号
//
// 两个版本号分开的理由：part schema 与 mapper 行为可能独立演化。
// 合并一个版本号会让"mapper 行为调整"强制 bump schema，导致下游 migration 代价虚高。
//
// Bump 决策树：
//   - 新增 part kind / 修改 part 字段形状 / 字面量枚举扩展 → bump SCHEMA
//   - mapper 投影规则变化 / slot/lane/placement 解析变化 / 新的 derivation 策略 → bump CONTRACT
//   - 两者都变 → 两个都 bump（不要合并成一次）
//
// 未来 10.3 projection 持久化会用这两个字段做 migration 分支；因此版本号是单调整数，
// 不使用 semver 字符串。
// ---------------------------------------------------------------------------

export const AI_RUNTIME_SCHEMA_VERSION = 1 as const;
export const AI_RUNTIME_CONTRACT_VERSION = 1 as const;

export type AiRuntimeProjection = {
  sessionId: string;
  executionId: string;
  status: JobStatus;
  lastSequence: number;
  isTerminal: boolean;
  messages: AiRuntimeMessage[];
  /** part schema 版本（part kind / 字段形状的版本） */
  schemaVersion: number;
  /** mapper 投影契约版本（投影规则 / 派生行为的版本） */
  contractVersion: number;
};

/**
 * 版本号校验：fail-loud 抛错，不得返回 fallback。
 *
 * 使用场景：
 *   - 10.3 projection 持久化读取旧 snapshot 时，先校验再决定 migration 策略
 *   - runtime adapter 跨进程传输 UIMessage 时做 sanity check
 *
 * 参数：
 *   - subject：携带 schemaVersion / contractVersion 的对象（projection 或 UIMessage.metadata）
 *   - expected：可选；若提供，必须严格等于才通过；若不提供，仅做 shape 校验
 */
export function assertAiRuntimeVersions(
  subject: { schemaVersion?: unknown; contractVersion?: unknown },
  expected?: { schemaVersion?: number; contractVersion?: number },
): void {
  const actualSchema = subject.schemaVersion;
  const actualContract = subject.contractVersion;
  if (typeof actualSchema !== 'number' || typeof actualContract !== 'number') {
    throw new Error(
      `ai-runtime version mismatch: field=shape, expected=number, actual={schemaVersion: ${String(actualSchema)}, contractVersion: ${String(actualContract)}}`,
    );
  }
  if (expected?.schemaVersion !== undefined && actualSchema !== expected.schemaVersion) {
    throw new Error(
      `ai-runtime version mismatch: field=schemaVersion, expected=${expected.schemaVersion}, actual=${actualSchema}`,
    );
  }
  if (
    expected?.contractVersion !== undefined &&
    actualContract !== expected.contractVersion
  ) {
    throw new Error(
      `ai-runtime version mismatch: field=contractVersion, expected=${expected.contractVersion}, actual=${actualContract}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Mapper Input / Output
// ---------------------------------------------------------------------------

export type AiRuntimeProjectionInput = {
  sessionId: string;
  executionId: string;
  events: readonly AnalysisExecutionStreamEvent[];
  /**
   * fallback conclusion 仅用于“事件自身还未产出结论”的过渡态，
   * 一旦事件流内部已有结论证据，fallback 就会被派生结论取代。
   */
  fallbackConclusion?: AnalysisConclusionReadModel | null;
};

/**
 * Mapper 约束：
 *   - 输入是 canonical execution facts；输出只是 UI projection
 *   - 不得写回 canonical truth
 *   - 不得新增独立于事件的交互事实源
 */
export type AiRuntimeProjectionMapper = (
  input: AiRuntimeProjectionInput,
) => AiRuntimeProjection;

// Reducer 模式刻意不引入：live-shell 仍持有 canonical events 数组，
// 新事件到达后通过 `mergeAnalysisExecutionStreamEvents` 合并，再触发 projection 全量重建。
// 这样 projection 永远只读，不会被误用为第二套事实源。
