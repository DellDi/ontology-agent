import { notFound, redirect } from 'next/navigation';

import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import {
  validateAnalysisExecutionStreamEvent,
  type AnalysisExecutionStreamEvent,
} from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import {
  getAnalysisSession,
  getCurrentViewer,
  JavaBackendHttpError,
  type JavaAnalysisSession,
} from '@/infrastructure/java-backend';

import { AnalysisAutoExecuteGate } from './_components/analysis-auto-execute-gate';
import { AnalysisExecutionLiveShell } from './_components/analysis-execution-live-shell';
import { AnalysisConversationShell } from './_components/analysis-conversation-shell';
import { buildChatTurns } from './_components/analysis-chat-turns';
import { AnalysisPendingRefreshGate } from './_components/analysis-pending-refresh-gate';
import { AnalysisAttributionPanel } from './_components/analysis-attribution-panel';
import { AnalysisActionsPanel } from './_components/analysis-actions-panel';
import type { DetailDrawerType } from './_components/analysis-detail-drawer';

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
  const selectedExecutionId = executionId
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
  const events = eventsFromJava(aggregate.events);

  // 归因 SQL：仅当前执行轮有逐工具事件载荷
  const activeAttributionTools = Array.from(
    aggregate.events
      .map((event) => event.tool)
      .filter(
        (tool): tool is NonNullable<typeof tool> =>
          tool != null && typeof tool.fact === 'string',
      )
      .reduce(
        (map, tool) => map.set(tool.name, tool),
        new Map<string, NonNullable<(typeof aggregate.events)[number]['tool']>>(),
      )
      .values(),
  );
  const resolvedContext = aggregate.snapshot?.planSnapshot._resolvedContext;
  const activeRangeLabel =
    resolvedContext &&
    typeof resolvedContext['from'] === 'string' &&
    typeof resolvedContext['to'] === 'string'
      ? `${resolvedContext['from']} ~ ${resolvedContext['to']}`
      : undefined;

  // 全轮次对话线程：历史轮用各自 conclusionState 静态渲染，当前执行轮走 live viewModel
  const turns = buildChatTurns(aggregate, resolvedExecutionId);

  // 每轮独立的业务抽屉（归因 / 动作建议）
  const turnDrawerContents: Record<
    string,
    Partial<Record<Exclude<DetailDrawerType, null>, React.ReactNode>>
  > = {};
  for (const turn of turns) {
    const state = turn.conclusionState;
    if (!state) continue;
    const contents: Partial<Record<Exclude<DetailDrawerType, null>, React.ReactNode>> = {};
    const isActive = turn.live;
    if (state.claims?.length || state.evidence?.length) {
      contents.attribution = (
        <AnalysisAttributionPanel
          claims={state.claims ?? []}
          evidence={state.evidence ?? []}
          rangeLabel={isActive ? activeRangeLabel : undefined}
          tools={isActive ? activeAttributionTools : []}
        />
      );
    }
    if (state.suggestedActions?.length) {
      contents.actions = (
        <AnalysisActionsPanel actions={state.suggestedActions} />
      );
    }
    if (Object.keys(contents).length > 0) {
      turnDrawerContents[turn.key] = contents;
    }
  }

  // 上下文建议：取最近一轮完成态的建议问题，作为对话内容展示
  const latestCompletedTurn = [...turns].reverse().find(
    (turn) => turn.status === 'completed',
  );
  const suggestions =
    latestCompletedTurn?.conclusionState?.suggestedQuestions
    ?? aggregate.snapshot?.conclusionState.suggestedQuestions;

  const readModel: AnalysisExecutionStreamReadModel | null = resolvedExecutionId
    ? {
        sessionId,
        executionId: resolvedExecutionId,
        currentStatus: aggregate.runtime.status,
        hasEvents: events.length > 0,
        events,
      }
    : null;

  const activeTurn = turns.find((turn) => turn.live) ?? null;
  const initialPending = !resolvedExecutionId
    && aggregate.runtime.autoExecute;

  return (
    <section className="w-full">
      <AnalysisAutoExecuteGate
        enabled={initialPending}
        sessionId={sessionId}
      />
      <AnalysisPendingRefreshGate
        enabled={Boolean(resolvedExecutionId && !aggregate.runtime.terminal && !aggregate.runtime.streamEnabled)}
      />

      {resolvedExecutionId && readModel ? (
        <AnalysisExecutionLiveShell
          activeTurnKey={activeTurn?.key ?? turns.at(-1)?.key ?? ''}
          enableLiveStream={aggregate.runtime.streamEnabled}
          executionId={resolvedExecutionId}
          initialConclusionReadModel={conclusionFromJava(aggregate)}
          initialReadModel={readModel}
          ownerUserId={viewer.userId}
          planAssumptions={planAssumptions(aggregate)}
          questionText={activeTurn?.questionText ?? aggregate.session.questionText}
          resumeCursor={{
            lastSequence: aggregate.runtime.resumeAfterSequence,
            lastEventId: events.at(-1)?.id ?? null,
          }}
          sessionId={sessionId}
          suggestions={suggestions}
          turnDrawerContents={turnDrawerContents}
          turns={turns}
        />
      ) : (
        <AnalysisConversationShell
          preparingInitial={initialPending}
          sessionId={sessionId}
          suggestions={suggestions}
          turnDrawerContents={turnDrawerContents}
          turns={turns}
          viewModel={null}
        />
      )}
    </section>
  );
}
