import { notFound } from 'next/navigation';

import { analysisContextUseCases } from '@/infrastructure/analysis-context';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { createPostgresAnalysisUiMessageProjectionStore } from '@/infrastructure/analysis-message-projection/postgres-analysis-ui-message-projection-store';
import { createPostgresAnalysisSessionFollowUpStore } from '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresOntologyVersionStore } from '@/infrastructure/ontology/postgres-ontology-version-store';
import { requireWorkspaceSession } from '@/infrastructure/session/server-auth';
import { analysisHistoryUseCases } from '@/application/analysis-history/use-cases';
import { createAnalysisExecutionPersistenceUseCases } from '@/application/analysis-execution/persistence-use-cases';
import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import { createAnalysisUiMessageProjectionUseCases } from '@/application/analysis-message-projection/use-cases';
import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createAnalysisFollowUpUseCases } from '@/application/follow-up/use-cases';
import {
  buildMobileAnalysisProjection,
  type MobileAnalysisProjection,
} from '@/application/mobile-analysis';
import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';
import { buildAnalysisConclusionReadModel } from '@/domain/analysis-result/models';

type MobileAnalysisPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParam(value: string | string[] | undefined, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function buildExecutionStreamReadModelFromSnapshot(
  snapshot: Pick<
    AnalysisExecutionSnapshot,
    'sessionId' | 'executionId' | 'status' | 'stepResults'
  >,
): AnalysisExecutionStreamReadModel {
  return {
    sessionId: snapshot.sessionId,
    executionId: snapshot.executionId,
    currentStatus: snapshot.status,
    hasEvents: snapshot.stepResults.length > 0,
    events: snapshot.stepResults,
  };
}

function resolveMobileSnapshotForDisplay(input: {
  latestExecutionSnapshot: AnalysisExecutionSnapshot | null;
  sessionSnapshots: AnalysisExecutionSnapshot[];
  selectedHistoryRoundId: string;
  historyReadModel: ReturnType<
    typeof analysisHistoryUseCases.buildHistoryReadModel
  >;
}) {
  if (input.selectedHistoryRoundId) {
    const selectedRound =
      input.historyReadModel.rounds.find(
        (round) => round.id === input.selectedHistoryRoundId,
      ) ?? null;

    if (selectedRound?.executionId) {
      return (
        input.sessionSnapshots.find(
          (snapshot) => snapshot.executionId === selectedRound.executionId,
        ) ?? null
      );
    }
  }

  return input.latestExecutionSnapshot;
}

function getStatusLabel(projection: MobileAnalysisProjection) {
  const statusPart = projection.summaryProjection.parts.find(
    (part) => part.kind === 'status-banner',
  );

  return statusPart?.kind === 'status-banner'
    ? statusPart.label
    : projection.summaryProjection.status;
}

function getStatusTone(projection: MobileAnalysisProjection) {
  const statusPart = projection.summaryProjection.parts.find(
    (part) => part.kind === 'status-banner',
  );

  return statusPart?.kind === 'status-banner' ? statusPart.tone : 'info';
}

const analysisSessionUseCases = createAnalysisSessionUseCases({
  analysisSessionStore: createPostgresAnalysisSessionStore(),
});
const ontologyVersionStore = createPostgresOntologyVersionStore();
const analysisExecutionPersistenceUseCases =
  createAnalysisExecutionPersistenceUseCases({
    snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
    ontologyVersionStore,
  });
const analysisUiMessageProjectionUseCases =
  createAnalysisUiMessageProjectionUseCases({
    projectionStore: createPostgresAnalysisUiMessageProjectionStore(),
  });
const analysisFollowUpUseCases = createAnalysisFollowUpUseCases({
  followUpStore: createPostgresAnalysisSessionFollowUpStore(),
  ontologyVersionStore,
});

export default async function MobileAnalysisPage({
  params,
  searchParams,
}: MobileAnalysisPageProps) {
  const { sessionId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const { session: currentUser, accessDeniedMessage } =
    await requireWorkspaceSession(`/mobile/analysis/${sessionId}`);

  if (accessDeniedMessage) {
    return null;
  }

  const analysisSession = await analysisSessionUseCases.getOwnedSession({
    sessionId,
    owner: currentUser,
  });

  if (!analysisSession) {
    notFound();
  }

  await analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: currentUser.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  const contextReadModel = await analysisContextUseCases.getCurrentContext({
    sessionId: analysisSession.id,
    questionText: analysisSession.questionText,
    savedContext: analysisSession.savedContext,
  });
  const [latestExecutionSnapshot, sessionSnapshots, followUps] =
    await Promise.all([
      analysisExecutionPersistenceUseCases.getLatestSnapshotForSession({
        sessionId: analysisSession.id,
        ownerUserId: currentUser.userId,
      }),
      analysisExecutionPersistenceUseCases.listSnapshotsForSession({
        sessionId: analysisSession.id,
        ownerUserId: currentUser.userId,
      }),
      analysisFollowUpUseCases.listOwnedFollowUps({
        sessionId: analysisSession.id,
        ownerUserId: currentUser.userId,
      }),
    ]);
  const selectedHistoryRoundId = readSearchParam(
    resolvedSearchParams.historyRoundId,
  );
  const historyReadModel = analysisHistoryUseCases.buildHistoryReadModel({
    session: analysisSession,
    sessionContext: contextReadModel.context,
    followUps,
    snapshots: sessionSnapshots,
    selectedRoundId: selectedHistoryRoundId || null,
  });
  const snapshotForDisplay = resolveMobileSnapshotForDisplay({
    latestExecutionSnapshot,
    sessionSnapshots,
    selectedHistoryRoundId,
    historyReadModel,
  });
  const pcWorkspaceUrl = `/workspace/analysis/${analysisSession.id}`;
  const mobileFollowUpError = readSearchParam(
    resolvedSearchParams.mobileFollowUpError,
  );
  const mobileFollowUpCreated = readSearchParam(
    resolvedSearchParams.mobileFollowUpCreated,
  );

  if (!snapshotForDisplay) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-4 py-5">
        <header className="hero-panel p-5">
          <p className="text-xs font-semibold tracking-[0.16em] text-[color:var(--brand-700)] uppercase">
            Mobile Analysis
          </p>
          <h1 className="mt-2 text-xl font-semibold text-[color:var(--ink-900)]">
            {analysisSession.questionText}
          </h1>
        </header>
        <article className="glass-panel p-5" data-testid="mobile-analysis-empty">
          <div className="status-banner" data-tone="info">
            当前会话还没有可展示的执行结果。请在 PC 工作台完成计划确认或执行。
          </div>
          <a className="secondary-button mt-4 w-full" href={pcWorkspaceUrl}>
            打开 PC 工作台
          </a>
        </article>
      </main>
    );
  }

  const executionStreamReadModel =
    buildExecutionStreamReadModelFromSnapshot(snapshotForDisplay);
  const liveConclusionReadModel =
    snapshotForDisplay.conclusionState.causes.length > 0
      ? snapshotForDisplay.conclusionState
      : buildAnalysisConclusionReadModel(executionStreamReadModel.events);
  const projectionHydration =
    await analysisUiMessageProjectionUseCases.hydrateProjection({
      ownerUserId: currentUser.userId,
      sessionId: analysisSession.id,
      executionId: snapshotForDisplay.executionId,
      followUpId: snapshotForDisplay.followUpId,
      historyRoundId: snapshotForDisplay.followUpId ?? 'session-root',
      canonical: {
        events: executionStreamReadModel.events,
        fallbackConclusion: liveConclusionReadModel,
      },
    });

  if (!projectionHydration) {
    throw new Error(
      `mobile projection hydration failed: sessionId=${analysisSession.id}, executionId=${snapshotForDisplay.executionId}`,
    );
  }

  const mobileProjection = buildMobileAnalysisProjection({
    viewer: currentUser,
    session: analysisSession,
    runtimeProjection: projectionHydration.projection,
    resumeCursor: projectionHydration.resumeCursor,
    historyReadModel,
    pcWorkspaceUrl,
    followUpActionUrl: `/api/mobile/analysis/sessions/${analysisSession.id}/follow-ups`,
  });
  const conclusion = mobileProjection.summaryProjection.currentConclusion;
  const followUpProjection = mobileProjection.followUpProjection;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-4 py-5">
      <header className="hero-panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-[color:var(--brand-700)] uppercase">
              Mobile Analysis
            </p>
            <h1 className="mt-2 text-xl font-semibold leading-8 text-[color:var(--ink-900)]">
              {analysisSession.questionText}
            </h1>
          </div>
          <a className="secondary-button shrink-0 px-3 py-2 text-sm" href={pcWorkspaceUrl}>
            PC
          </a>
        </div>
      </header>

      {mobileFollowUpError ? (
        <div className="status-banner" data-tone="error">
          {mobileFollowUpError}
        </div>
      ) : mobileFollowUpCreated ? (
        <div className="status-banner" data-tone="success">
          轻量追问已附着到当前会话，可在 PC 工作台继续执行或查看后续结果。
        </div>
      ) : null}

      <article className="glass-panel p-5" data-testid="mobile-analysis-summary-card">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-[0.16em] text-[color:var(--brand-700)] uppercase">
            摘要
          </p>
          <span
            className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[color:var(--ink-600)]"
            data-testid="mobile-analysis-status"
          >
            {getStatusLabel(mobileProjection)}
          </span>
        </div>
        <div className="status-banner mt-4" data-tone={getStatusTone(mobileProjection)}>
          {conclusion?.summary ?? '当前执行仍在生成结论，请稍后恢复查看。'}
        </div>
        <p className="mt-3 text-xs text-[color:var(--ink-600)]">
          最近更新：{mobileProjection.summaryProjection.lastUpdatedAt}
        </p>
      </article>

      <article className="glass-panel p-5" data-testid="mobile-analysis-evidence">
        <p className="text-sm font-semibold text-[color:var(--ink-900)]">
          关键证据
        </p>
        <ul className="mt-3 space-y-3">
          {mobileProjection.summaryProjection.keyEvidence.length > 0 ? (
            mobileProjection.summaryProjection.keyEvidence.map((item) => (
              <li
                className="rounded-2xl border border-[color:var(--line-200)] bg-white/70 p-3"
                key={`${item.label}-${item.summary}`}
              >
                <p className="text-sm font-semibold text-[color:var(--ink-900)]">
                  {item.label}
                </p>
                <p className="mt-1 text-sm leading-6 text-[color:var(--ink-600)]">
                  {item.summary}
                </p>
              </li>
            ))
          ) : (
            <li className="text-sm text-[color:var(--ink-600)]">
              暂无可公开展示的关键证据。
            </li>
          )}
        </ul>
      </article>

      <article className="glass-panel p-5" data-testid="mobile-analysis-resume">
        <p className="text-sm font-semibold text-[color:var(--ink-900)]">
          恢复位置
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[color:var(--ink-600)]">Execution</dt>
            <dd className="mt-1 break-all font-mono text-xs text-[color:var(--ink-900)]">
              {mobileProjection.resumeProjection.executionId}
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--ink-600)]">Sequence</dt>
            <dd className="mt-1 font-mono text-xs text-[color:var(--ink-900)]">
              {mobileProjection.resumeProjection.lastSequence}
            </dd>
          </div>
        </dl>
      </article>

      <article className="glass-panel p-5" data-testid="mobile-analysis-history">
        <p className="text-sm font-semibold text-[color:var(--ink-900)]">
          最近上下文
        </p>
        <div className="mt-3 space-y-3">
          {mobileProjection.summaryProjection.minimalHistoryContext.map((round) => (
            <a
              className="block rounded-2xl border border-[color:var(--line-200)] bg-white/70 p-3"
              href={`/mobile/analysis/${analysisSession.id}?historyRoundId=${encodeURIComponent(round.roundId)}`}
              key={round.roundId}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[color:var(--ink-900)]">
                  {round.label}
                </p>
                {round.isLatest ? (
                  <span className="rounded-full bg-[color:var(--sky-100)] px-2 py-1 text-xs text-[color:var(--brand-700)]">
                    最新
                  </span>
                ) : null}
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-[color:var(--ink-600)]">
                {round.conclusionSummary ?? round.questionText}
              </p>
            </a>
          ))}
        </div>
      </article>

      <article className="glass-panel p-5" data-testid="mobile-analysis-follow-up">
        <p className="text-sm font-semibold text-[color:var(--ink-900)]">
          轻量追问
        </p>
        <form action={followUpProjection.action.url} className="mt-3 space-y-3" method="post">
          {followUpProjection.parentFollowUpId ? (
            <input
              name="parentFollowUpId"
              type="hidden"
              value={followUpProjection.parentFollowUpId}
            />
          ) : null}
          <textarea
            className="field-input min-h-28 resize-none"
            disabled={!followUpProjection.canSubmitLightweightFollowUp}
            maxLength={followUpProjection.boundary.maxLength}
            name="question"
            placeholder="继续解释某个证据或局部原因"
          />
          <button
            className="primary-button w-full"
            disabled={!followUpProjection.canSubmitLightweightFollowUp}
            type="submit"
          >
            继续追问
          </button>
        </form>
        <a className="secondary-button mt-3 w-full" href={followUpProjection.pcWorkspaceUrl}>
          复杂编辑去 PC
        </a>
      </article>
    </main>
  );
}
