'use client';

import { useCallback, useEffect, useState } from 'react';

import { mergeAnalysisExecutionStreamEvents } from '@/application/ai-runtime';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisUiMessageProjectionStreamCursor } from '@/domain/analysis-message-projection/models';

import { buildAnalysisExecutionStreamUrl } from '../analysis-execution-display';

export type StreamConnectionIssue = {
  /** 友好可见的中文提示 */
  message: string;
  /** 出错时间，便于排查 */
  occurredAt: string;
  /** 来源细化，便于诊断（'timeout' | 'error' | 'parse-error'） */
  source: 'timeout' | 'error' | 'parse-error';
  /** 原始错误细节，仅用于日志/诊断面板，不暴露给非技术用户 */
  detail?: string;
};

type UseAnalysisExecutionStreamInput = {
  sessionId: string;
  executionId: string;
  resumeCursor?: AnalysisUiMessageProjectionStreamCursor | null;
  enabled: boolean;
  onEvent: (next: AnalysisExecutionStreamEvent) => void;
};

export type UseAnalysisExecutionStreamResult = {
  hasReceivedLiveEvents: boolean;
  streamConnectionIssue: StreamConnectionIssue | null;
  reconnect: () => void;
};

const SSE_MAX_DURATION_MS = 5 * 60 * 1000;

/**
 * 订阅分析执行 SSE。处理 reconnect / timeout / parse-error。
 *
 * 不直接持有 events 集合：调用方通过 onEvent 自行合并到 canonical 列表。
 * 这样事件累积与 stream lifecycle 解耦，便于在 hook 之外测试 events 合并。
 */
export function useAnalysisExecutionStream({
  sessionId,
  executionId,
  resumeCursor,
  enabled,
  onEvent,
}: UseAnalysisExecutionStreamInput): UseAnalysisExecutionStreamResult {
  const [hasReceivedLiveEvents, setHasReceivedLiveEvents] = useState(false);
  const [streamConnectionIssue, setStreamConnectionIssue] =
    useState<StreamConnectionIssue | null>(null);
  const [reconnectEpoch, setReconnectEpoch] = useState(0);

  const reconnect = useCallback(() => {
    setStreamConnectionIssue(null);
    setHasReceivedLiveEvents(false);
    setReconnectEpoch((epoch) => epoch + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const url = buildAnalysisExecutionStreamUrl({
      sessionId,
      executionId,
      resumeCursor,
    });
    const eventSource = new EventSource(url);

    const maxDurationTimer = setTimeout(() => {
      eventSource.close();
      setStreamConnectionIssue({
        message: '分析执行时间较长，实时流已超时。您可以手动刷新查看最新状态。',
        occurredAt: new Date().toISOString(),
        source: 'timeout',
      });
    }, SSE_MAX_DURATION_MS);

    eventSource.onmessage = (message) => {
      try {
        const nextEvent = JSON.parse(message.data) as AnalysisExecutionStreamEvent;
        setHasReceivedLiveEvents(true);
        setStreamConnectionIssue(null);
        onEvent(nextEvent);
        if (
          nextEvent.kind === 'execution-status' &&
          (nextEvent.status === 'completed' || nextEvent.status === 'failed')
        ) {
          clearTimeout(maxDurationTimer);
          eventSource.close();
        }
      } catch (error) {
        // 不静默：保留来源 + 详情，便于诊断面板复盘
        const detail =
          error instanceof Error ? error.message : String(error);
        console.warn(
          '[analysis-execution-stream] 解析 SSE 消息失败',
          { sessionId, executionId, detail },
        );
        setStreamConnectionIssue({
          message: '收到无法解析的事件，实时流暂停。可点击重新连接重试。',
          occurredAt: new Date().toISOString(),
          source: 'parse-error',
          detail,
        });
      }
    };

    eventSource.onerror = () => {
      clearTimeout(maxDurationTimer);
      setStreamConnectionIssue({
        message: '事件流连接已中断，当前页面可能无法继续实时刷新。',
        occurredAt: new Date().toISOString(),
        source: 'error',
      });
      eventSource.close();
    };

    return () => {
      clearTimeout(maxDurationTimer);
      eventSource.close();
    };
    // resumeCursor 只在初次连接生效（断点续传），后续 reconnect 由 reconnectEpoch 触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, executionId, reconnectEpoch]);

  return {
    hasReceivedLiveEvents,
    streamConnectionIssue,
    reconnect,
  };
}

/**
 * 提供一个稳定的合并回调，供 `useAnalysisExecutionStream.onEvent` 复用。
 */
export function makeAnalysisStreamEventMerger(
  setEvents: (
    updater: (
      previous: AnalysisExecutionStreamEvent[],
    ) => AnalysisExecutionStreamEvent[],
  ) => void,
  context: { sessionId: string; executionId: string },
) {
  return (nextEvent: AnalysisExecutionStreamEvent) => {
    setEvents((previous) =>
      mergeAnalysisExecutionStreamEvents(previous, nextEvent, {
        sessionId: context.sessionId,
        executionId: context.executionId,
        deduplicateBySequence: true,
      }),
    );
  };
}
