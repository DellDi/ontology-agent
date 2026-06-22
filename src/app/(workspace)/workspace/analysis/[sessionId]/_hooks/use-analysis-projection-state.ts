'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  buildAiRuntimeProjection,
  resolveLiveShellCanonicalEvents,
  type AiRuntimeProjection,
} from '@/application/ai-runtime';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';

type UseAnalysisProjectionStateInput = {
  sessionId: string;
  executionId: string;
  initialEvents: readonly AnalysisExecutionStreamEvent[];
  fallbackConclusion: AnalysisConclusionReadModel | null;
  initialProjection?: AiRuntimeProjection | null;
  hasReceivedLiveEvents: boolean;
};

export type UseAnalysisProjectionStateResult = {
  events: AnalysisExecutionStreamEvent[];
  setEvents: React.Dispatch<React.SetStateAction<AnalysisExecutionStreamEvent[]>>;
  projection: AiRuntimeProjection;
  /** 重置时返回 true，可用于联动清理 stream 错误等。 */
  didJustReset: boolean;
};

/**
 * 维护 live shell 在 (sessionId, executionId) 维度上的 canonical events 与 projection。
 *
 * 关键修复：原实现把 resolveLiveShellCanonicalEvents 的 didReset 分支放在 render 阶段，
 * 直接 setState 触发额外渲染并违反 React 规则。这里改为在 effect 中处理 reset，
 * 渲染阶段仅消费已经稳定的 state，避免"render 阶段 setState"反模式。
 */
export function useAnalysisProjectionState({
  sessionId,
  executionId,
  initialEvents,
  fallbackConclusion,
  initialProjection,
  hasReceivedLiveEvents,
}: UseAnalysisProjectionStateInput): UseAnalysisProjectionStateResult {
  const [trackingKey, setTrackingKey] = useState(
    () => `${sessionId}::${executionId}`,
  );
  const [events, setEvents] = useState<AnalysisExecutionStreamEvent[]>(
    () => [...initialEvents],
  );
  const [didJustReset, setDidJustReset] = useState(false);

  useEffect(() => {
    const resolution = resolveLiveShellCanonicalEvents({
      sessionId,
      executionId,
      previousTrackingKey: trackingKey,
      previousEvents: events,
      initialEventsForCurrentExecution: initialEvents,
    });

    if (!resolution.didReset) {
      if (didJustReset) {
        setDidJustReset(false);
      }
      return;
    }

    setTrackingKey(resolution.trackingKey);
    setEvents(resolution.events as AnalysisExecutionStreamEvent[]);
    setDidJustReset(true);
    // 仅在 (sessionId, executionId, initialEvents) 变化时触发；events 是输出不参与依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, executionId, initialEvents]);

  const rebuiltProjection = useMemo(
    () =>
      buildAiRuntimeProjection({
        sessionId,
        executionId,
        events,
        fallbackConclusion,
      }),
    [sessionId, executionId, events, fallbackConclusion],
  );

  const projection =
    initialProjection && !hasReceivedLiveEvents
      ? initialProjection
      : rebuiltProjection;

  return { events, setEvents, projection, didJustReset };
}
