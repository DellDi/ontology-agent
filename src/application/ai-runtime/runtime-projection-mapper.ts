import type {
  AnalysisExecutionStreamEvent,
  ExecutionStageSnapshot,
  ExecutionStepSnapshot,
} from '@/domain/analysis-execution/stream-models';
import {
  getExecutionStatusLabel,
  getExecutionStatusTone,
} from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import { buildAnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { JobStatus } from '@/domain/job-contract/models';

import type {
  AiRuntimeConclusionCardPart,
  AiRuntimeEvidenceCardPart,
  AiRuntimeMessage,
  AiRuntimeMessagePart,
  AiRuntimeProjection,
  AiRuntimeProjectionInput,
  AiRuntimeResumeAnchorPart,
  AiRuntimeStatusBannerPart,
  AiRuntimeStepTimelinePart,
} from './runtime-contract';

const ASSISTANT_MESSAGE_ID_PREFIX = 'ai-runtime:assistant:';

function resolveAssistantMessageId(executionId: string) {
  return `${ASSISTANT_MESSAGE_ID_PREFIX}${executionId}`;
}

function resolveLatestStatusEvent(
  events: readonly AnalysisExecutionStreamEvent[],
) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind === 'execution-status' && event.status) {
      return event;
    }
  }
  return null;
}

function resolveStatus(
  events: readonly AnalysisExecutionStreamEvent[],
): JobStatus {
  const latest = resolveLatestStatusEvent(events);
  return latest?.status ?? 'processing';
}

function isTerminalStatus(status: JobStatus) {
  return status === 'completed' || status === 'failed';
}

function resolveLastSequence(
  events: readonly AnalysisExecutionStreamEvent[],
) {
  let lastSequence = 0;
  for (const event of events) {
    if (event.sequence > lastSequence) {
      lastSequence = event.sequence;
    }
  }
  return lastSequence;
}

function mergeSteps(
  events: readonly AnalysisExecutionStreamEvent[],
): ExecutionStepSnapshot[] {
  const bySequence = new Map<
    string,
    { step: ExecutionStepSnapshot; sequence: number }
  >();
  for (const event of events) {
    // step 快照可能随 step-lifecycle 或 stage-result 等事件一起到达；
    // 只要事件携带 step 就纳入 timeline，并以 sequence 最大者为准。
    if (!event.step) continue;
    const existing = bySequence.get(event.step.id);
    if (!existing || event.sequence > existing.sequence) {
      bySequence.set(event.step.id, {
        step: event.step,
        sequence: event.sequence,
      });
    }
  }
  return [...bySequence.values()]
    .map((entry) => entry.step)
    .sort((left, right) => left.order - right.order);
}

function resolveCurrentStage(
  events: readonly AnalysisExecutionStreamEvent[],
): ExecutionStageSnapshot | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.stage) return event.stage;
  }
  return undefined;
}

function buildStatusBannerPart(
  events: readonly AnalysisExecutionStreamEvent[],
  status: JobStatus,
): AiRuntimeStatusBannerPart {
  const latest = resolveLatestStatusEvent(events);
  return {
    kind: 'status-banner',
    status,
    label: getExecutionStatusLabel(status),
    tone: getExecutionStatusTone(status),
    message: latest?.message,
  };
}

function buildStepTimelinePart(
  events: readonly AnalysisExecutionStreamEvent[],
): AiRuntimeStepTimelinePart {
  return {
    kind: 'step-timeline',
    steps: mergeSteps(events),
    currentStage: resolveCurrentStage(events),
  };
}

function buildEvidenceCardParts(
  events: readonly AnalysisExecutionStreamEvent[],
): AiRuntimeEvidenceCardPart[] {
  const parts: AiRuntimeEvidenceCardPart[] = [];
  for (const event of events) {
    if (event.renderBlocks.length === 0) continue;
    const title =
      event.step?.title ?? event.stage?.label ?? event.message ?? undefined;
    parts.push({
      kind: 'evidence-card',
      sourceEventId: event.id,
      sequence: event.sequence,
      title,
      blocks: event.renderBlocks,
    });
  }
  return parts;
}

function buildConclusionCardPart(
  events: readonly AnalysisExecutionStreamEvent[],
  fallbackConclusion: AnalysisConclusionReadModel | null | undefined,
): AiRuntimeConclusionCardPart | null {
  const derived = buildAnalysisConclusionReadModel([...events]);
  if (derived.causes.length > 0) {
    return { kind: 'conclusion-card', readModel: derived };
  }
  if (fallbackConclusion && fallbackConclusion.causes.length > 0) {
    return { kind: 'conclusion-card', readModel: fallbackConclusion };
  }
  return null;
}

function buildResumeAnchorPart(input: {
  sessionId: string;
  executionId: string;
  lastSequence: number;
  status: JobStatus;
}): AiRuntimeResumeAnchorPart {
  return {
    kind: 'resume-anchor',
    sessionId: input.sessionId,
    executionId: input.executionId,
    lastSequence: input.lastSequence,
    status: input.status,
    isTerminal: isTerminalStatus(input.status),
  };
}

function resolveTimestamps(events: readonly AnalysisExecutionStreamEvent[]) {
  if (events.length === 0) {
    const now = new Date().toISOString();
    return { createdAt: now, updatedAt: now };
  }
  let createdAt = events[0].timestamp;
  let updatedAt = events[0].timestamp;
  for (const event of events) {
    if (event.timestamp < createdAt) createdAt = event.timestamp;
    if (event.timestamp > updatedAt) updatedAt = event.timestamp;
  }
  return { createdAt, updatedAt };
}

function buildAssistantMessage(input: {
  executionId: string;
  events: readonly AnalysisExecutionStreamEvent[];
  status: JobStatus;
  lastSequence: number;
  sessionId: string;
  fallbackConclusion: AnalysisConclusionReadModel | null | undefined;
}): AiRuntimeMessage {
  const parts: AiRuntimeMessagePart[] = [];
  parts.push(buildStatusBannerPart(input.events, input.status));
  parts.push(buildStepTimelinePart(input.events));
  parts.push(...buildEvidenceCardParts(input.events));

  const conclusion = buildConclusionCardPart(
    input.events,
    input.fallbackConclusion,
  );
  if (conclusion) parts.push(conclusion);

  parts.push(
    buildResumeAnchorPart({
      sessionId: input.sessionId,
      executionId: input.executionId,
      lastSequence: input.lastSequence,
      status: input.status,
    }),
  );

  const timestamps = resolveTimestamps(input.events);
  return {
    id: resolveAssistantMessageId(input.executionId),
    role: 'assistant',
    parts,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  };
}

/**
 * 把 canonical execution facts 映射为稳定的 AiRuntimeProjection。
 *
 * 稳定顺序约束：
 *   status-banner → step-timeline → evidence-card* → conclusion-card(可选) → resume-anchor
 * 这是 Primary Narrative Lane 的 contract，严格按序。
 */
export function buildAiRuntimeProjection(
  input: AiRuntimeProjectionInput,
): AiRuntimeProjection {
  const status = resolveStatus(input.events);
  const lastSequence = resolveLastSequence(input.events);
  const isTerminal = isTerminalStatus(status);

  const message = buildAssistantMessage({
    executionId: input.executionId,
    events: input.events,
    status,
    lastSequence,
    sessionId: input.sessionId,
    fallbackConclusion: input.fallbackConclusion,
  });

  return {
    sessionId: input.sessionId,
    executionId: input.executionId,
    status,
    lastSequence,
    isTerminal,
    messages: [message],
  };
}

/**
 * 交互层状态切换语义：当承载多条 execution 的 live-shell 组件因父层路由 / follow-up
 * 切换触发 props.executionId / sessionId 变化时，必须把 canonical events 重置为
 * 新 execution 的 initial snapshot，否则 projection 会混入上一条 execution 的事实。
 *
 * 本函数是纯函数版本的"状态重置决策"，以便在无 React 环境下做回归验证：
 *   - 若 tracking key 未变：保留既有 events
 *   - 若 tracking key 变化：返回新 execution 的 initial events，并返回新 key
 *
 * 注意：不得在本函数里合并新老 events，那等价于允许 canonical truth 跨 execution 串流。
 */
export type LiveShellCanonicalEventsResolution = {
  trackingKey: string;
  events: readonly AnalysisExecutionStreamEvent[];
  didReset: boolean;
};

export function resolveLiveShellCanonicalEvents(input: {
  sessionId: string;
  executionId: string;
  previousTrackingKey: string;
  previousEvents: readonly AnalysisExecutionStreamEvent[];
  initialEventsForCurrentExecution: readonly AnalysisExecutionStreamEvent[];
}): LiveShellCanonicalEventsResolution {
  const trackingKey = `${input.sessionId}::${input.executionId}`;

  if (trackingKey === input.previousTrackingKey) {
    return {
      trackingKey,
      events: input.previousEvents,
      didReset: false,
    };
  }

  return {
    trackingKey,
    events: input.initialEventsForCurrentExecution,
    didReset: true,
  };
}

/**
 * 纯函数 event 合并：幂等、按 sequence 排序。
 *
 * 设计约束：
 *   - live-shell 仍然持有 canonical events 数组作为 UI 的"已知事实"，
 *     reducer 模式不从 projection 反推事件，避免 projection 被当成二号事实源。
 *   - 同 id 重复到达时返回原数组引用以便 React 跳过重渲染。
 *   - 跨 session/execution 事件直接忽略且 warn，防止交互层被串流污染。
 */
export function mergeAnalysisExecutionStreamEvents(
  events: readonly AnalysisExecutionStreamEvent[],
  nextEvent: AnalysisExecutionStreamEvent,
  context?: { sessionId?: string; executionId?: string },
): AnalysisExecutionStreamEvent[] {
  if (
    context?.sessionId &&
    context.sessionId !== nextEvent.sessionId
  ) {
    console.warn('[ai-runtime] 忽略跨 session 事件。', {
      expected: context.sessionId,
      received: nextEvent.sessionId,
    });
    return [...events];
  }

  if (
    context?.executionId &&
    context.executionId !== nextEvent.executionId
  ) {
    console.warn('[ai-runtime] 忽略跨 execution 事件。', {
      expected: context.executionId,
      received: nextEvent.executionId,
    });
    return [...events];
  }

  if (events.some((event) => event.id === nextEvent.id)) {
    return [...events];
  }

  return [...events, nextEvent].sort(
    (left, right) => left.sequence - right.sequence,
  );
}
