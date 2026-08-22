import { notFound, redirect } from 'next/navigation';

import {
  getAnalysisSession,
  JavaBackendHttpError,
} from '@/infrastructure/java-backend';
import { buildJavaMobileAnalysisView } from '@/infrastructure/java-backend/mobile-view-model';

type MobileAnalysisPageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

export default async function MobileAnalysisPage({
  params,
  searchParams,
}: MobileAnalysisPageProps) {
  const { sessionId } = await params;
  const query = (await searchParams) ?? {};
  const executionId = readParam(query.executionId);
  const historyRoundId = readParam(query.historyRoundId);
  const followUpId = readParam(query.followUpId);

  let aggregate;
  try {
    aggregate = await getAnalysisSession(sessionId, executionId);
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401) {
      redirect(`/login?next=${encodeURIComponent(`/mobile/analysis/${sessionId}`)}`);
    }
    if (error instanceof JavaBackendHttpError && error.status === 404) notFound();
    throw error;
  }

  const historyRound = historyRoundId
    ? aggregate.history.find((round) => round.id === historyRoundId)
    : undefined;
  if (historyRoundId && !historyRound) notFound();
  if (executionId && historyRound?.executionId !== executionId) notFound();
  if (historyRound?.executionId
    && historyRound.executionId !== aggregate.runtime.resolvedExecutionId) {
    try {
      aggregate = await getAnalysisSession(sessionId, historyRound.executionId);
    } catch (error) {
      if (error instanceof JavaBackendHttpError && error.status === 404) notFound();
      throw error;
    }
  }

  const selectedFollowUp = followUpId
    ? aggregate.followUps.find((followUp) => followUp.id === followUpId)
    : undefined;
  if (followUpId && !selectedFollowUp) notFound();
  if (historyRoundId && followUpId && historyRound?.followUpId !== followUpId) notFound();
  if (executionId && followUpId && selectedFollowUp?.resultExecutionId !== executionId) notFound();
  if (selectedFollowUp?.resultExecutionId
    && selectedFollowUp.resultExecutionId !== aggregate.runtime.resolvedExecutionId) {
    try {
      aggregate = await getAnalysisSession(sessionId, selectedFollowUp.resultExecutionId);
    } catch (error) {
      if (error instanceof JavaBackendHttpError && error.status === 404) notFound();
      throw error;
    }
  }

  const view = buildJavaMobileAnalysisView(aggregate);
  const followUpError = readParam(query.followUpError) ?? readParam(query.followUpExecutionError);
  const activeParentId = view.activeFollowUpId ?? '';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-4 py-5">
      <header className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">移动分析</p>
            <h1 className="mt-2 text-xl font-semibold leading-8 text-foreground">{view.questionText}</h1>
          </div>
          <a className="rounded-md border border-input px-3 py-2 text-sm font-semibold" href={`/workspace/analysis/${sessionId}`}>
            桌面
          </a>
        </div>
      </header>

      {followUpError ? (
        <div className="rounded-md border border-[color:var(--danger-500)]/40 px-4 py-3 text-sm" role="alert">
          {followUpError}
        </div>
      ) : null}

      <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-summary-card">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">摘要</p>
          <span className="rounded-md bg-secondary px-3 py-1 text-xs font-semibold" data-testid="mobile-analysis-status">
            {view.statusLabel}
          </span>
        </div>
        <div className="mt-4 rounded-md border border-border px-4 py-3 text-sm leading-6">
          {view.summary ?? '当前轮次尚未生成完成结论。'}
        </div>
        {view.updatedAt ? <p className="mt-3 text-xs text-muted-foreground">最近更新：{view.updatedAt}</p> : null}
      </article>

      <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-evidence">
        <p className="text-sm font-semibold">关键证据</p>
        <ul className="mt-3 space-y-3">
          {view.evidence.length ? view.evidence.map((item) => (
            <li className="rounded-lg border border-border p-3" key={`${item.label}-${item.summary}`}>
              <p className="text-sm font-semibold">{item.label}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.summary}</p>
            </li>
          )) : <li className="text-sm text-muted-foreground">暂无可展示证据。</li>}
        </ul>
      </article>

      <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-resume">
        <p className="text-sm font-semibold">恢复位置</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted-foreground">执行编号</dt><dd className="mt-1 break-all font-mono text-xs">{view.executionId ?? '—'}</dd></div>
          <div><dt className="text-muted-foreground">事件序号</dt><dd className="mt-1 font-mono text-xs">{view.resumeAfterSequence}</dd></div>
        </dl>
      </article>

      <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-history">
        <p className="text-sm font-semibold">历史轮次</p>
        <div className="mt-3 space-y-3">
          {view.history.map((round) => (
            <a className="block rounded-lg border border-border p-3" href={`/mobile/analysis/${sessionId}?historyRoundId=${encodeURIComponent(round.id)}`} key={round.id}>
              <p className="text-sm font-semibold">{round.label}{round.isLatest ? ' · 最新' : ''}</p>
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{round.conclusionSummary ?? round.questionText}</p>
            </a>
          ))}
        </div>
      </article>

      <article className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-panel)]" data-testid="mobile-analysis-follow-up">
        {selectedFollowUp && !selectedFollowUp.resultExecutionId ? (
          <div className="mb-5 rounded-md border border-[color:var(--brand-300)]/50 bg-[color:color-mix(in_srgb,var(--brand-500)_8%,transparent)] p-4">
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">追问待执行</p>
            <p className="mt-2 text-sm leading-6">{selectedFollowUp.questionText}</p>
            <form action={`/api/mobile/analysis/sessions/${sessionId}/execute`} className="mt-3" method="post">
              <input name="followUpId" type="hidden" value={selectedFollowUp.id} />
              <button className="min-h-[44px] w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground" type="submit">
                执行这轮追问
              </button>
            </form>
          </div>
        ) : null}
        <p className="text-sm font-semibold">继续追问</p>
        <form action={`/api/mobile/analysis/sessions/${sessionId}/follow-ups`} className="mt-3 space-y-3" method="post">
          {activeParentId ? <input name="parentFollowUpId" type="hidden" value={activeParentId} /> : null}
          <textarea className="min-h-28 w-full rounded-md border border-input px-3.5 py-2.5 text-sm" disabled={!view.canCreateFollowUp} maxLength={300} name="question" />
          <button className="min-h-[44px] w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60" disabled={!view.canCreateFollowUp} type="submit">
            创建追问
          </button>
        </form>
        <a className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-input px-4 py-2.5 text-sm font-semibold" href={`/workspace/analysis/${sessionId}`}>
          到桌面纠正上下文并执行
        </a>
      </article>
    </main>
  );
}
