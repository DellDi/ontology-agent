'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import {
  buildAiRuntimeProjection,
  mergeAnalysisExecutionStreamEvents,
  resolveLiveShellCanonicalEvents,
  type AiRuntimeProjection,
} from '@/application/ai-runtime';
import { buildConversationViewModel } from '@/application/analysis-message-projection/conversation-view-model';
import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisUiMessageProjectionStreamCursor } from '@/domain/analysis-message-projection/models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { OntologyVersionBinding } from '@/domain/ontology/version-binding';
import { AnalysisConversationShell } from './analysis-conversation-shell';
import { AnalysisExecutionStreamPanel } from './analysis-execution-stream-panel';
import { AnalysisDiagnosticsPanel } from './analysis-diagnostics-panel';
import { buildAnalysisExecutionStreamUrl } from '../analysis-execution-display';

type AnalysisExecutionLiveShellProps = {
  sessionId: string;
  executionId: string;
  ownerUserId: string;
  initialReadModel: AnalysisExecutionStreamReadModel;
  initialConclusionReadModel: AnalysisConclusionReadModel | null;
  initialProjection?: AiRuntimeProjection | null;
  resumeCursor?: AnalysisUiMessageProjectionStreamCursor | null;
  enableLiveStream?: boolean;
  planAssumptions?: string[];
  ontologyVersionBinding?: OntologyVersionBinding | null;
  /** 对话视图所需的 session 元数据 */
  questionText: string;
  intentLabel?: string;
  ontologyVersionBadge?: string;
  followUpLabel?: string;
  /** 详情抽屉内容（由 page 级 server component 预渲染） */
  drawerContents?: Record<string, ReactNode>;
  /** 对话区底部追加内容（如追问输入框） */
  children?: ReactNode;
};

// SSE 连接最大持续时间（5 分钟），超时后自动关闭并提示用户。
const SSE_MAX_DURATION_MS = 5 * 60 * 1000;

// 向后兼容：process board 相关纯函数保留导出，供 story-10-7 回归测试使用。
export const PROCESS_BOARD_STORAGE_KEY_PREFIX = 'analysis-process-board-open-v2';

export function buildProcessBoardStorageKey(ownerUserId: string) {
  return `${PROCESS_BOARD_STORAGE_KEY_PREFIX}:${ownerUserId}`;
}

export function shouldRestoreProcessBoardOpenState(
  persistedValue: string | null,
) {
  return persistedValue === '1';
}

export function shouldCloseProcessBoardOnKeydown(key: string) {
  return key === 'Escape';
}

export function AnalysisExecutionLiveShell({
  sessionId,
  executionId,
  initialReadModel,
  initialConclusionReadModel,
  initialProjection,
  resumeCursor,
  enableLiveStream = true,
  planAssumptions,
  questionText,
  intentLabel,
  ontologyVersionBadge,
  followUpLabel,
  drawerContents = {},
  children,
}: AnalysisExecutionLiveShellProps) {
  const router = useRouter();
  const [events, setEvents] = useState<AnalysisExecutionStreamEvent[]>(
    initialReadModel.events,
  );
  const [hasReceivedLiveEvents, setHasReceivedLiveEvents] = useState(false);
  const [streamConnectionIssue, setStreamConnectionIssue] = useState<{
    message: string;
    occurredAt: string;
  } | null>(null);
  // 用于强制重新挂载 SSE useEffect，实现"重新连接"功能。
  const [reconnectEpoch, setReconnectEpoch] = useState(0);

  const handleReconnect = useCallback(() => {
    setStreamConnectionIssue(null);
    setHasReceivedLiveEvents(false);
    setReconnectEpoch((epoch) => epoch + 1);
  }, []);

  // 当父层切换 execution 时，重置 canonical events 到新 execution 的 initial snapshot。
  const [trackedExecutionKey, setTrackedExecutionKey] = useState(
    () => `${sessionId}::${executionId}`,
  );
  const canonicalResolution = resolveLiveShellCanonicalEvents({
    sessionId,
    executionId,
    previousTrackingKey: trackedExecutionKey,
    previousEvents: events,
    initialEventsForCurrentExecution: initialReadModel.events,
  });
  if (canonicalResolution.didReset) {
    setTrackedExecutionKey(canonicalResolution.trackingKey);
    setEvents(canonicalResolution.events as AnalysisExecutionStreamEvent[]);
    setHasReceivedLiveEvents(false);
    setStreamConnectionIssue(null);
  }

  // 从 events 构建 projection
  const rebuiltProjection = useMemo(
    () =>
      buildAiRuntimeProjection({
        sessionId,
        executionId,
        events,
        fallbackConclusion: initialConclusionReadModel,
      }),
    [sessionId, executionId, events, initialConclusionReadModel],
  );
  const projection =
    initialProjection && !hasReceivedLiveEvents
      ? initialProjection
      : rebuiltProjection;

  // 构建对话视图模型
  const conversationViewModel = useMemo(
    () =>
      buildConversationViewModel({
        questionText,
        intentLabel,
        ontologyVersion: ontologyVersionBadge,
        followUpLabel,
        projection,
        events,
        hasConnectionIssue: !!streamConnectionIssue,
        planAssumptions,
      }),
    [
      questionText,
      intentLabel,
      ontologyVersionBadge,
      followUpLabel,
      projection,
      events,
      streamConnectionIssue,
      planAssumptions,
    ],
  );

  // SSE 连接（含最大持续时间保护）
  useEffect(() => {
    if (!enableLiveStream) {
      return;
    }

    const eventSource = new EventSource(
      buildAnalysisExecutionStreamUrl({
        sessionId,
        executionId,
        resumeCursor,
      }),
    );

    // 最大连接时长保护：超时后自动断开并提示用户。
    const maxDurationTimer = setTimeout(() => {
      eventSource.close();
      setStreamConnectionIssue({
        message: '分析执行时间较长，实时流已超时。您可以手动刷新查看最新状态。',
        occurredAt: new Date().toISOString(),
      });
    }, SSE_MAX_DURATION_MS);

    eventSource.onmessage = (message) => {
      const nextEvent = JSON.parse(message.data) as AnalysisExecutionStreamEvent;
      setHasReceivedLiveEvents(true);
      setStreamConnectionIssue(null);

      setEvents((previousEvents) =>
        mergeAnalysisExecutionStreamEvents(previousEvents, nextEvent, {
          sessionId,
          executionId,
          deduplicateBySequence: true,
        }),
      );

      if (
        nextEvent.kind === 'execution-status' &&
        (nextEvent.status === 'completed' || nextEvent.status === 'failed')
      ) {
        clearTimeout(maxDurationTimer);
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      clearTimeout(maxDurationTimer);
      setStreamConnectionIssue({
        message: '事件流连接已中断，当前页面可能无法继续实时刷新。',
        occurredAt: new Date().toISOString(),
      });
      eventSource.close();
    };

    return () => {
      clearTimeout(maxDurationTimer);
      eventSource.close();
    };
  }, [enableLiveStream, executionId, resumeCursor, sessionId, reconnectEpoch]);

  // 把执行日志面板和诊断面板作为抽屉内容注入
  const { diagnostics } = conversationViewModel.assistantMessage;
  const mergedDrawerContents: Record<string, ReactNode> = {
    ...drawerContents,
    'execution-log': (
      <AnalysisExecutionStreamPanel events={events} variant="side-sheet" />
    ),
    diagnostics: (
      <AnalysisDiagnosticsPanel
        timelineBlocks={diagnostics.timelineBlocks}
        processBoardBlocks={diagnostics.processBoardBlocks}
        renderErrors={diagnostics.renderErrors}
        otherBlocks={diagnostics.otherBlocks}
        eventCount={diagnostics.eventCount}
        lastSequence={diagnostics.lastSequence}
        executionId={diagnostics.executionId}
      />
    ),
  };

  return (
    <>
      {streamConnectionIssue && (
        <div className="mx-auto mt-4 max-w-[860px] px-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p>{streamConnectionIssue.message}</p>
            <div className="mt-2 flex gap-3">
              <button
                onClick={handleReconnect}
                className="secondary-button"
                type="button"
              >
                重新连接
              </button>
              <button
                onClick={() => router.refresh()}
                className="secondary-button"
                type="button"
              >
                手动刷新
              </button>
            </div>
          </div>
        </div>
      )}
      <AnalysisConversationShell
        viewModel={conversationViewModel}
        drawerContents={mergedDrawerContents}
      >
        {children}
      </AnalysisConversationShell>
    </>
  );
}
