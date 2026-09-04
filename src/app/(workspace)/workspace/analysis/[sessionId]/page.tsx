import { notFound, redirect } from 'next/navigation';

import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import {
  validateAnalysisExecutionStreamEvent,
  type AnalysisExecutionStreamEvent,
} from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import { buildFollowUpContextDiff } from '@/domain/analysis-session/follow-up-models';
import {
  getAnalysisSession,
  getCurrentViewer,
  JavaBackendHttpError,
  type JavaAnalysisSession,
} from '@/infrastructure/java-backend';

import { AnalysisAutoExecuteGate } from './_components/analysis-auto-execute-gate';
import { AnalysisExecutionLiveShell } from './_components/analysis-execution-live-shell';
import { AnalysisFollowUpInput } from './_components/analysis-follow-up-input';
import { AnalysisFollowUpPanel } from './_components/analysis-follow-up-panel';
import { AnalysisHistoryPanel } from './_components/analysis-history-panel';
import { AnalysisPendingRefreshGate } from './_components/analysis-pending-refresh-gate';
import { AnalysisRuntimeContractPanel } from './_components/analysis-runtime-contract-panel';
import {
  buildJavaFollowUpFeedback,
  buildJavaHistoryReadModel,
  followUpsFromJava,
  resolveJavaActiveFollowUp,
  rootContextFromJava,
} from './java-follow-up-view-model';

type AnalysisSessionPageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function eventsFromJava(
  events: JavaAnalysisSession['events'],
): AnalysisExecutionStreamEvent[] {
  return events.map((event) => validateAnalysisExecutionStreamEvent({
    ...event,
    status: event.status ?? undefined,
    message: event.message ?? undefined,
  }));
}

function conclusionFromJava(
  aggregate: JavaAnalysisSession,
): AnalysisConclusionReadModel | null {
  const snapshot = aggregate.snapshot;
  if (!snapshot) return null;

  const validated = validateAnalysisExecutionStreamEvent({
    id: 'snapshot-render-blocks',
    sessionId: snapshot.sessionId,
    executionId: snapshot.executionId,
    sequence: 1,
    kind: 'execution-status',
    timestamp: snapshot.updatedAt,
    status: snapshot.status,
    renderBlocks: snapshot.conclusionState.renderBlocks,
    metadata: {},
  });

  return {
    causes: snapshot.conclusionState.causes,
    renderBlocks: validated.renderBlocks ?? [],
  };
}

function planAssumptions(aggregate: JavaAnalysisSession) {
  const value = aggregate.snapshot?.planSnapshot._executionAssumptions;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export default async function AnalysisSessionPage({
  params,
  searchParams,
}: AnalysisSessionPageProps) {
  const { sessionId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const executionId = readSearchParam(resolvedSearchParams.executionId);
  const requestedFollowUpId = readSearchParam(resolvedSearchParams.followUpId);

  let viewer;
  let aggregate;
  try {
    [viewer, aggregate] = await Promise.all([
      getCurrentViewer(),
      getAnalysisSession(sessionId, executionId),
    ]);
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401) {
      redirect(`/login?next=${encodeURIComponent(`/workspace/analysis/${sessionId}`)}`);
    }
    if (error instanceof JavaBackendHttpError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  if (!viewer.workspaceAccess) return null;

  const requestedFollowUp = requestedFollowUpId
    ? aggregate.followUps.find((followUp) => followUp.id === requestedFollowUpId)
    : undefined;
  if (requestedFollowUpId && !requestedFollowUp) notFound();
  const requestedHistoryRoundId = readSearchParam(resolvedSearchParams.historyRoundId);
  const requestedHistoryRound = requestedHistoryRoundId
    ? aggregate.history.find((round) => round.id === requestedHistoryRoundId)
    : undefined;
  if (requestedHistoryRoundId && !requestedHistoryRound) notFound();
  if (requestedFollowUp && requestedHistoryRound
    && requestedHistoryRound.followUpId !== requestedFollowUp.id) notFound();
  if (executionId && requestedHistoryRound
    && requestedHistoryRound.executionId !== executionId) notFound();
  if (executionId && requestedFollowUp
    && requestedFollowUp.resultExecutionId !== executionId) notFound();
  const selectedExecutionId = executionId
    ?? requestedHistoryRound?.executionId
    ?? requestedFollowUp?.resultExecutionId
    ?? null;
  if (selectedExecutionId
    && selectedExecutionId !== aggregate.runtime.resolvedExecutionId) {
    try {
      aggregate = await getAnalysisSession(sessionId, selectedExecutionId);
    } catch (error) {
      if (error instanceof JavaBackendHttpError && error.status === 404) notFound();
      throw error;
    }
  }

  const resolvedExecutionId = aggregate.runtime.resolvedExecutionId;
  const followUps = followUpsFromJava(aggregate);
  const executionFollowUp = aggregate.runtime.resolvedExecutionId
    ? followUps.find((followUp) => followUp.resultExecutionId === aggregate.runtime.resolvedExecutionId) ?? null
    : null;
  const activeFollowUp = requestedHistoryRoundId
    ? requestedHistoryRound?.followUpId
      ? followUps.find((followUp) => followUp.id === requestedHistoryRound.followUpId) ?? null
      : null
    : requestedFollowUpId
      ? resolveJavaActiveFollowUp(followUps, requestedFollowUpId)
      : executionId
        ? executionFollowUp
        : resolveJavaActiveFollowUp(followUps);
  const historyReadModel = buildJavaHistoryReadModel(
    aggregate,
    readSearchParam(resolvedSearchParams.historyRoundId),
  );
  const followUpFeedback = buildJavaFollowUpFeedback(resolvedSearchParams);
  const activeHistoryRound = activeFollowUp
    ? aggregate.history.find((round) => round.followUpId === activeFollowUp.id) ?? null
    : null;
  const displayedFollowUp = requestedHistoryRoundId
    ? requestedHistoryRound?.followUpId
      ? followUps.find((followUp) => followUp.id === requestedHistoryRound.followUpId) ?? null
      : null
    : activeFollowUp;
  const displayedQuestion = displayedFollowUp?.questionText
    ?? requestedHistoryRound?.questionText
    ?? aggregate.session.questionText;
  const completedConclusion = activeHistoryRound?.status === 'completed'
    ? activeHistoryRound.conclusionState?.causes[0] ?? null
    : activeFollowUp
      ? null
      : aggregate.history[0]?.conclusionState?.causes[0]
        ?? aggregate.snapshot?.conclusionState.causes[0]
        ?? null;
  const displayedSourceConclusion = completedConclusion ?? (activeFollowUp ? {
    title: activeFollowUp.referencedConclusionTitle,
    summary: activeFollowUp.referencedConclusionSummary,
  } : null);
  const inheritedContext = activeFollowUp?.mergedContext ?? rootContextFromJava(aggregate);
  const canFollowUp = Boolean(completedConclusion && inheritedContext
    && (!activeFollowUp || activeHistoryRound?.status === 'completed'));
  const followUpDetails = activeFollowUp && inheritedContext ? (
    <AnalysisFollowUpPanel
      sessionId={sessionId}
      activeFollowUpId={activeFollowUp?.id}
      latestConclusionTitle={displayedSourceConclusion?.title ?? null}
      latestConclusionSummary={displayedSourceConclusion?.summary ?? null}
      inheritedContext={inheritedContext}
      followUps={followUps}
      adjustmentDraft={followUpFeedback.adjustmentDraft}
      conflictItems={followUpFeedback.conflictItems}
      feedback={followUpFeedback.feedback}
      replanFeedback={followUpFeedback.replanFeedback}
      showComposer={false}
      showCards={false}
    />
  ) : null;
  const followUpInput = canFollowUp ? (
    <AnalysisFollowUpInput
      sessionId={sessionId}
      activeFollowUpId={activeFollowUp?.id}
      drawerContent={followUpDetails}
    />
  ) : null;
  const isJavaInitialSession =
    aggregate.session.savedContext._executionContract === 'java-initial-v1';
  const activeFollowUpPending = Boolean(displayedFollowUp && !displayedFollowUp.resultExecutionId);
  const activeFollowUpDiff = activeFollowUp ? buildFollowUpContextDiff({
    inheritedContext: activeFollowUp.inheritedContext,
    mergedContext: activeFollowUp.mergedContext,
  }) : null;
  const activeFollowUpNeedsReplan = Boolean(activeFollowUp
    && !activeFollowUp.currentPlanSnapshot
    && activeFollowUpDiff
    && (activeFollowUpDiff.added.length || activeFollowUpDiff.overridden.length));
  const events = eventsFromJava(aggregate.events);
  const readModel: AnalysisExecutionStreamReadModel | null = resolvedExecutionId
    ? {
        sessionId,
        executionId: resolvedExecutionId,
        currentStatus: aggregate.runtime.status,
        hasEvents: events.length > 0,
        events,
      }
    : null;

  return (
    <section className="mx-auto w-full max-w-[920px] space-y-6 px-2">
      <AnalysisAutoExecuteGate
        sessionId={sessionId}
        enabled={aggregate.runtime.autoExecute && !activeFollowUp}
      />
      <AnalysisPendingRefreshGate
        enabled={Boolean(resolvedExecutionId && !aggregate.runtime.terminal && !aggregate.runtime.streamEnabled)}
      />

      {followUpFeedback.feedback || followUpFeedback.replanFeedback ? (
        <div className="mx-auto max-w-[860px] space-y-2 px-4" data-testid="java-follow-up-feedback">
          {[followUpFeedback.feedback, followUpFeedback.replanFeedback].filter(Boolean).map((feedback) => (
            <p
              className={feedback?.tone === 'error' ? 'text-sm text-destructive' : 'text-sm text-primary'}
              key={feedback?.message}
            >
              {feedback?.message}
            </p>
          ))}
        </div>
      ) : null}

      <AnalysisRuntimeContractPanel snapshot={aggregate.snapshot} />

      {resolvedExecutionId && readModel && !activeFollowUpPending ? (
        <AnalysisExecutionLiveShell
          sessionId={sessionId}
          executionId={resolvedExecutionId}
          ownerUserId={viewer.userId}
          initialReadModel={readModel}
          initialConclusionReadModel={conclusionFromJava(aggregate)}
          resumeCursor={{
            lastSequence: aggregate.runtime.resumeAfterSequence,
            lastEventId: events.at(-1)?.id ?? null,
          }}
          enableLiveStream={aggregate.runtime.streamEnabled}
          planAssumptions={planAssumptions(aggregate)}
          questionText={displayedQuestion}
          followUpLabel={displayedFollowUp ? '追问模式' : undefined}
          ontologyVersionBadge={aggregate.snapshot?.ontologyVersionId ?? undefined}
          drawerContents={{
            history: (
              <AnalysisHistoryPanel
                sessionId={sessionId}
                readModel={historyReadModel}
              />
            ),
          }}
        >
          {followUpInput}
        </AnalysisExecutionLiveShell>
      ) : (
        <div
          className="mx-auto w-full max-w-[860px] space-y-6 px-4"
          data-testid="analysis-pending-conversation"
        >
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-primary px-5 py-3.5">
              <p className="text-base leading-7 text-primary-foreground">
                {displayedQuestion}
              </p>
            </div>
          </div>
          <div className="flex justify-start">
            <div className="w-full max-w-[90%]">
              <p className="text-sm font-medium text-foreground">
                {activeFollowUp
                  ? '正在准备追问分析'
                  : isJavaInitialSession ? '正在准备首次分析' : '旧执行尚未迁移'}
              </p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {activeFollowUp
                  ? '可先纠正本轮上下文并重生成计划；确认无误后手动执行。本轮不会自动提交。'
                  : isJavaInitialSession
                  ? '系统会提交当前问题；如未自动开始，可手动执行。'
                  : '该会话属于旧后端事实，本切片不会自动或手动重跑。请等待后续历史迁移切片。'}
              </p>
              {isJavaInitialSession && !activeFollowUpNeedsReplan ? (
                <form
                  action={`/api/analysis/sessions/${sessionId}/execute`}
                  className="mt-4"
                  method="post"
                >
                  {activeFollowUp ? (
                    <input name="followUpId" type="hidden" value={activeFollowUp.id} />
                  ) : null}
                  <button
                    className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-input bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    type="submit"
                  >
                    手动执行
                  </button>
                </form>
              ) : activeFollowUpNeedsReplan ? (
                <p className="mt-4 text-sm font-medium text-destructive">
                  当前上下文已变更，请先重生成后续计划，再手动执行。
                </p>
              ) : null}
            </div>
          </div>
          {followUpInput}
        </div>
      )}

      {activeFollowUp && inheritedContext ? (
        <AnalysisFollowUpPanel
          sessionId={sessionId}
          activeFollowUpId={activeFollowUp?.id}
          latestConclusionTitle={displayedSourceConclusion?.title ?? null}
          latestConclusionSummary={displayedSourceConclusion?.summary ?? null}
          inheritedContext={inheritedContext}
          followUps={followUps}
          adjustmentDraft={followUpFeedback.adjustmentDraft}
          conflictItems={followUpFeedback.conflictItems}
          feedback={null}
          replanFeedback={null}
          showComposer={false}
        />
      ) : null}

      <AnalysisHistoryPanel
        sessionId={sessionId}
        readModel={historyReadModel}
      />
    </section>
  );
}
