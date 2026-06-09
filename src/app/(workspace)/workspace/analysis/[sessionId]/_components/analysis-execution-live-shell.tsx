import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAiRuntimeProjection, mergeAnalysisExecutionStreamEvents, resolveLiveShellCanonicalEvents, type AiRuntimeProjection } from '@/application/ai-runtime';
import { buildConversationViewModel } from '@/application/analysis-message-projection/conversation-view-model';
import type { ConversationThreadViewModel } from '@/application/analysis-message-projection/conversation-thread-view-model';
import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisUiMessageProjectionStreamCursor } from '@/domain/analysis-message-projection/models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { OntologyVersionBinding } from '@/domain/ontology/version-binding';
import type { ReactNode } from 'react';
import { AnalysisConversationShell } from './analysis-conversation-shell';
import { AnalysisExecutionStreamPanel } from './analysis-execution-stream-panel';
import { AnalysisDiagnosticsPanel } from './analysis-diagnostics-panel';
import { buildAnalysisExecutionStreamUrl } from '../analysis-execution-display';
import { useRouter } from 'next/navigation';

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

const SSE_MAX_DURATION_MS = 5 * 60 * 1000;

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
  const [events, setEvents] = useState<AnalysisExecutionStreamEvent[]>(initialReadModel.events);
  const [hasReceivedLiveEvents, setHasReceivedLiveEvents] = useState(false);
  const [streamConnectionIssue, setStreamConnectionIssue] = useState<{ message: string; occurredAt: string } | null>(null);
  const [reconnectEpoch, setReconnectEpoch] = useState(0);

  const handleReconnect = useCallback(() => {
    setStreamConnectionIssue(null);
    setHasReceivedLiveEvents(false);
    setReconnectEpoch((epoch) => epoch + 1);
  }, []);

  const [trackedExecutionKey, setTrackedExecutionKey] = useState(() => `${sessionId}::${executionId}`);

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

  const rebuiltProjection = useMemo(
    () => buildAiRuntimeProjection({ sessionId, executionId, events, fallbackConclusion: initialConclusionReadModel }),
    [sessionId, executionId, events, initialConclusionReadModel],
  );
  const projection = initialProjection && !hasReceivedLiveEvents ? initialProjection : rebuiltProjection;

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
        projection,
        events,
        hasConnectionIssue: !!streamConnectionIssue,
        planAssumptions,
        candidateFactors,
        conclusionCauseIds,
      }),
    [questionText, intentLabel, ontologyVersionBadge, followUpLabel, projection, events, streamConnectionIssue, planAssumptions, candidateFactors, conclusionCauseIds],
  );

  useEffect(() => {
    if (!enableLiveStream) return;

    const eventSource = new EventSource(buildAnalysisExecutionStreamUrl({ sessionId, executionId, resumeCursor }));

    const maxDurationTimer = setTimeout(() => {
      eventSource.close();
      setStreamConnectionIssue({ message: '分析执行时间较长，实时流已超时。您可以手动刷新查看最新状态。', occurredAt: new Date().toISOString() });
    }, SSE_MAX_DURATION_MS);

    eventSource.onmessage = (message) => {
      const nextEvent = JSON.parse(message.data) as AnalysisExecutionStreamEvent;
      setHasReceivedLiveEvents(true);
      setStreamConnectionIssue(null);
      setEvents((previousEvents) => mergeAnalysisExecutionStreamEvents(previousEvents, nextEvent, { sessionId, executionId, deduplicateBySequence: true }));
      if (nextEvent.kind === 'execution-status' && (nextEvent.status === 'completed' || nextEvent.status === 'failed')) {
        clearTimeout(maxDurationTimer);
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      clearTimeout(maxDurationTimer);
      setStreamConnectionIssue({ message: '事件流连接已中断，当前页面可能无法继续实时刷新。', occurredAt: new Date().toISOString() });
      eventSource.close();
    };

    return () => { clearTimeout(maxDurationTimer); eventSource.close(); };
  }, [enableLiveStream, executionId, resumeCursor, sessionId, reconnectEpoch]);

  const { diagnostics } = conversationViewModel.assistantMessage;
  const mergedDrawerContents: Record<string, ReactNode> = {
    ...drawerContents,
    'execution-log': <AnalysisExecutionStreamPanel events={events} variant="side-sheet" />,
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
      {streamConnectionIssue && (
        <div className="mx-auto mt-4 max-w-[860px] px-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p>{streamConnectionIssue.message}</p>
            <div className="mt-2 flex gap-3">
              <button onClick={handleReconnect} className="secondary-button" type="button">重新连接</button>
              <button onClick={() => router.refresh()} className="secondary-button" type="button">手动刷新</button>
            </div>
          </div>
        </div>
      )}
      <AnalysisConversationShell viewModel={conversationViewModel} thread={thread} drawerContents={mergedDrawerContents}>
        {children}
      </AnalysisConversationShell>
    </>
  );
}