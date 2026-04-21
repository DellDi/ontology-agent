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

export type AiRuntimeStatusBannerPart = {
  kind: 'status-banner';
  status: JobStatus;
  label: string;
  tone: StatusBannerTone;
  message?: string;
};

export type AiRuntimeStepTimelinePart = {
  kind: 'step-timeline';
  steps: ExecutionStepSnapshot[];
  currentStage?: ExecutionStageSnapshot;
};

export type AiRuntimeEvidenceCardPart = {
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

export type AiRuntimeConclusionCardPart = {
  kind: 'conclusion-card';
  readModel: AnalysisConclusionReadModel;
};

export type AiRuntimeResumeAnchorPart = {
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

export type AiRuntimeProjection = {
  sessionId: string;
  executionId: string;
  status: JobStatus;
  lastSequence: number;
  isTerminal: boolean;
  messages: AiRuntimeMessage[];
};

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
