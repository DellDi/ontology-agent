'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import type { AiRuntimeProjection } from '@/application/ai-runtime';
import { buildConversationViewModel } from '@/application/analysis-message-projection/conversation-view-model';
import type { ConversationThreadViewModel } from '@/application/analysis-message-projection/conversation-thread-view-model';
import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import type { AnalysisUiMessageProjectionStreamCursor } from '@/domain/analysis-message-projection/models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { OntologyVersionBinding } from '@/domain/ontology/version-binding';

import { Button } from '@/app/_components/workbench/button';
import { StatusBanner } from '@/app/_components/workbench/status-banner';

import {
  makeAnalysisStreamEventMerger,
  useAnalysisExecutionStream,
} from '../_hooks/use-analysis-execution-stream';
import { useAnalysisProjectionState } from '../_hooks/use-analysis-projection-state';

import { AnalysisConversationShell } from './analysis-conversation-shell';
import { AnalysisDiagnosticsPanel } from './analysis-diagnostics-panel';
import { AnalysisExecutionStreamPanel } from './analysis-execution-stream-panel';

// 抽离以便 tests 与外部模块复用
export const PROCESS_BOARD_STORAGE_KEY_PREFIX = 'analysis-process-board-open-v2';

export function buildProcessBoardStorageKey(ownerUserId: string) {
  return `${PROCESS_BOARD_STORAGE_KEY_PREFIX}:${ownerUserId}`;
}

export function shouldRestoreProcessBoardOpenState(persistedValue: string | null) {
  return persistedValue === '1';
}

export function shouldCloseProcessBoardOnKeydown(key: string) {
  return key === 'Escape';
}

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
  questionText: string;
  intentLabel?: string;
  ontologyVersionBadge?: string;
  followUpLabel?: string;
  candidateFactors?: readonly { key: string; label: string }[];
  thread?: ConversationThreadViewModel;
  drawerContents?: Record<string, ReactNode>;
  children?: ReactNode;
};

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
  candidateFactors,
  thread,
  drawerContents = {},
  children,
}: AnalysisExecutionLiveShellProps) {
  const router = useRouter();

  // 1) canonical events 与 projection（reset 已经迁入 effect 内部）
  const { events, setEvents, projection } = useAnalysisProjectionState({
    sessionId,
    executionId,
    initialEvents: initialReadModel.events,
    fallbackConclusion: initialConclusionReadModel,
    initialProjection,
    hasReceivedLiveEvents: false, // 由下方覆盖
  });

  // 2) SSE 订阅 + 重连
  const onEvent = useMemo(
    () => makeAnalysisStreamEventMerger(setEvents, { sessionId, executionId }),
    [setEvents, sessionId, executionId],
  );
  const { hasReceivedLiveEvents, streamConnectionIssue, reconnect } =
    useAnalysisExecutionStream({
      sessionId,
      executionId,
      resumeCursor,
      enabled: enableLiveStream,
      onEvent,
    });

  // 已收到 live 事件后，优先使用本地重建的 projection，避免回退到旧 initialProjection
  const liveProjection = useMemo(() => projection, [projection]);

  // 3) view model 派生（保留原 selector）
  const conclusionCauseIds = useMemo(
    () => initialConclusionReadModel?.causes?.map((cause) => cause.id) ?? [],
    [initialConclusionReadModel],
  );

  const conversationViewModel = useMemo(
    () =>
      buildConversationViewModel({
        questionText,
        intentLabel,
        ontologyVersion: ontologyVersionBadge,
        followUpLabel,
        projection: hasReceivedLiveEvents
          ? liveProjection
          : (initialProjection ?? liveProjection),
        events,
        hasConnectionIssue: !!streamConnectionIssue,
        planAssumptions,
        candidateFactors,
        conclusionCauseIds,
      }),
    [
      questionText,
      intentLabel,
      ontologyVersionBadge,
      followUpLabel,
      hasReceivedLiveEvents,
      liveProjection,
      initialProjection,
      events,
      streamConnectionIssue,
      planAssumptions,
      candidateFactors,
      conclusionCauseIds,
    ],
  );

  const handleManualRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  // 4) 抽屉内容拼装
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
        candidateValidation={diagnostics.candidateValidation}
      />
    ),
  };

  return (
    <>
      {streamConnectionIssue ? (
        <div className="mx-auto mt-4 max-w-[860px] px-4">
          <StatusBanner
            tone="warning"
            title="实时连接已中断"
            action={
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={reconnect}
                  type="button"
                  data-testid="analysis-live-stream-reconnect"
                >
                  重新连接
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleManualRefresh}
                  type="button"
                  data-testid="analysis-live-stream-refresh"
                >
                  手动刷新
                </Button>
              </div>
            }
          >
            <p>{streamConnectionIssue.message}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              出现时间：{formatLocalTime(streamConnectionIssue.occurredAt)}
              {streamConnectionIssue.detail
                ? ` · 细节：${streamConnectionIssue.detail}`
                : ''}
            </p>
          </StatusBanner>
        </div>
      ) : null}
      <AnalysisConversationShell
        viewModel={conversationViewModel}
        thread={thread}
        drawerContents={mergedDrawerContents}
      >
        {children}
      </AnalysisConversationShell>
    </>
  );
}

function formatLocalTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}
