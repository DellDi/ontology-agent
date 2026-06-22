import { notFound } from 'next/navigation';

import { createCompositionRoot, requireWorkspaceSession } from '@/composition-root';
import { analysisHistoryUseCases } from '@/application/analysis-history/use-cases';
import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
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

export default async function MobileAnalysisPage({
  params,
  searchParams,
}: MobileAnalysisPageProps) {
  const root = createCompositionRoot();
  const { sessionId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const { session: currentUser, accessDeniedMessage } =
    await requireWorkspaceSession(`/mobile/analysis/${sessionId}`);

  if (accessDeniedMessage) {
    return null;
  }

  const analysisSession = await root.analysisSessionUseCases.getOwnedSession({
    sessionId,
    owner: currentUser,
  });

  if (!analysisSession) {
    notFound();
  }

  await root.analysisContextUseCases.initializeContext({
    sessionId: analysisSession.id,
    ownerUserId: currentUser.userId,
    questionText: analysisSession.questionText,
    initialContext: analysisSession.savedContext,
  });

  const contextReadModel = await root.analysisContextUseCases.getCurrentContext({
    sessionId: analysisSession.id,
    questionText: analysisSession.questionText,
    savedContext: analysisSession.savedContext,
  });
  const [latestExecutionSnapshot, sessionSnapshots, followUps] =
    await Promise.all([
      root.analysisExecutionPersistenceUseCases.getLatestSnapshotForSession({
        sessionId: analysisSession.id,
        ownerUserId: currentUser.userId,
      }),
      root.analysisExecutionPersistenceUseCases.listSnapshotsForSession({
        sessionId: analysisSession.id,
        ownerUserId: currentUser.userId,
      }),
      root.analysisFollowUpUseCases.listOwnedFollowUps({
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
        <header className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]">
          <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
            移动分析
          </p>
          <h1 className="mt-2 text-xl font-semibold text-foreground">
            {analysisSession.questionText}
          </h1>
        </header>
        <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-empty">
          <div
            className="rounded-md border border-[color:var(--brand-300)]/40 bg-[color:color-mix(in_srgb,var(--brand-500)_10%,transparent)] px-4 py-3 text-sm leading-6 text-foreground"
            role="status"
            aria-live="polite"
          >
            当前会话还没有可展示的执行结果。请在桌面工作台完成计划确认或执行。
          </div>
          <a
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-input bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 mt-4 w-full"
            href={pcWorkspaceUrl}
          >
            打开桌面工作台
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
    await root.analysisUiMessageProjectionUseCases.hydrateProjection({
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
      <header className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
              移动分析
            </p>
            <h1 className="mt-2 text-xl font-semibold leading-8 text-foreground">
              {analysisSession.questionText}
            </h1>
          </div>
          <a
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-input bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 shrink-0 px-3 py-2 text-sm"
            href={pcWorkspaceUrl}
          >
            桌面
          </a>
        </div>
      </header>

      {mobileFollowUpError ? (
        <div
          className="rounded-md border border-[color:var(--danger-500)]/40 bg-[color:color-mix(in_srgb,var(--danger-500)_10%,transparent)] px-4 py-3 text-sm leading-6 text-foreground"
          role="alert"
          aria-live="assertive"
        >
          {mobileFollowUpError}
        </div>
      ) : mobileFollowUpCreated ? (
        <div
          className="rounded-md border border-[color:var(--success-500)]/40 bg-[color:color-mix(in_srgb,var(--success-500)_12%,transparent)] px-4 py-3 text-sm leading-6 text-foreground"
          role="status"
          aria-live="polite"
        >
          轻量追问已附着到当前会话，可在 PC 工作台继续执行或查看后续结果。
        </div>
      ) : null}

      <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-summary-card">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
            摘要
          </p>
          <span
            className="rounded-md bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground"
            data-testid="mobile-analysis-status"
          >
            {getStatusLabel(mobileProjection)}
          </span>
        </div>
        <div
          className="mt-4 rounded-md border border-border bg-card px-4 py-3 text-sm leading-6 text-foreground data-[tone=error]:border-[color:var(--danger-500)]/40 data-[tone=error]:bg-[color:color-mix(in_srgb,var(--danger-500)_10%,transparent)] data-[tone=success]:border-[color:var(--success-500)]/40 data-[tone=success]:bg-[color:color-mix(in_srgb,var(--success-500)_12%,transparent)] data-[tone=info]:border-[color:var(--brand-300)]/40 data-[tone=info]:bg-[color:color-mix(in_srgb,var(--brand-500)_10%,transparent)] data-[tone=warning]:border-[color:var(--warning-500)]/40 data-[tone=warning]:bg-[color:color-mix(in_srgb,var(--warning-500)_14%,transparent)]"
          data-tone={getStatusTone(mobileProjection)}
        >
          {conclusion?.summary ?? '当前执行仍在生成结论，请稍后恢复查看。'}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          最近更新：{mobileProjection.summaryProjection.lastUpdatedAt}
        </p>
      </article>

      <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-evidence">
        <p className="text-sm font-semibold text-foreground">
          关键证据
        </p>
        <ul className="mt-3 space-y-3">
          {mobileProjection.summaryProjection.keyEvidence.length > 0 ? (
            mobileProjection.summaryProjection.keyEvidence.map((item) => (
              <li
                className="rounded-lg border border-border bg-card p-3"
                key={`${item.label}-${item.summary}`}
              >
                <p className="text-sm font-semibold text-foreground">
                  {item.label}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {item.summary}
                </p>
              </li>
            ))
          ) : (
            <li className="text-sm text-muted-foreground">
              暂无可公开展示的关键证据。
            </li>
          )}
        </ul>
      </article>

      <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-resume">
        <p className="text-sm font-semibold text-foreground">
          恢复位置
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">执行编号</dt>
            <dd className="mt-1 break-all font-mono text-xs text-foreground">
              {mobileProjection.resumeProjection.executionId}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">事件序号</dt>
            <dd className="mt-1 font-mono text-xs text-foreground">
              {mobileProjection.resumeProjection.lastSequence}
            </dd>
          </div>
        </dl>
      </article>

      <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-history">
        <p className="text-sm font-semibold text-foreground">
          最近上下文
        </p>
        <div className="mt-3 space-y-3">
          {mobileProjection.summaryProjection.minimalHistoryContext.map((round) => (
            <a
              className="block rounded-lg border border-border bg-card p-3"
              href={`/mobile/analysis/${analysisSession.id}?historyRoundId=${encodeURIComponent(round.roundId)}`}
              key={round.roundId}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">
                  {round.label}
                </p>
                {round.isLatest ? (
                  <span className="rounded-md bg-[color:var(--sky-100)] px-2 py-1 text-xs text-[color:var(--brand-700)]">
                    最新
                  </span>
                ) : null}
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {round.conclusionSummary ?? round.questionText}
              </p>
            </a>
          ))}
        </div>
      </article>

      <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-follow-up">
        <p className="text-sm font-semibold text-foreground">
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
            className="min-h-28 w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-sm leading-7 text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40 resize-none"
            disabled={!followUpProjection.canSubmitLightweightFollowUp}
            maxLength={followUpProjection.boundary.maxLength}
            name="question"
            placeholder="继续解释某个证据或局部原因"
          />
          <button
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 w-full"
            disabled={!followUpProjection.canSubmitLightweightFollowUp}
            type="submit"
          >
            继续追问
          </button>
        </form>
        <a
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-input bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 mt-3 w-full"
          href={followUpProjection.pcWorkspaceUrl}
        >
          复杂编辑到桌面处理
        </a>
      </article>
    </main>
  );
}
