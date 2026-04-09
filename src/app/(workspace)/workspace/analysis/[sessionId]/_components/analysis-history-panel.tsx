import type { AnalysisHistoryReadModel } from '@/application/analysis-history/use-cases';

type AnalysisHistoryPanelProps = {
  sessionId: string;
  activeFollowUpId?: string;
  readModel: AnalysisHistoryReadModel;
};

function buildHistoryHref({
  sessionId,
  roundId,
  activeFollowUpId,
}: {
  sessionId: string;
  roundId: string;
  activeFollowUpId?: string;
}) {
  const params = new URLSearchParams();

  if (activeFollowUpId) {
    params.set('followUpId', activeFollowUpId);
  }

  params.set('historyRoundId', roundId);

  return `/workspace/analysis/${sessionId}?${params.toString()}`;
}

export function AnalysisHistoryPanel({
  sessionId,
  activeFollowUpId,
  readModel,
}: AnalysisHistoryPanelProps) {
  if (readModel.rounds.length < 2 || !readModel.selectedRound) {
    return null;
  }

  const selectedRound = readModel.selectedRound;

  return (
    <article className="glass-panel p-6" data-testid="analysis-history-panel">
      <div>
        <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
          多轮历史
        </p>
        <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
          轮次历史与结论演化
        </h3>
        <p className="mt-3 text-sm leading-6 text-[color:var(--ink-600)]">
          每轮输入、计划和主要结论都单独保留。切到历史轮次时，只读查看，不会被新一轮覆盖。
        </p>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          {readModel.rounds.map((round) => (
            <a
              className="block rounded-3xl border border-[color:var(--line-200)] bg-white/78 p-4"
              data-active={selectedRound.id === round.id ? 'true' : 'false'}
              href={buildHistoryHref({
                sessionId,
                roundId: round.id,
                activeFollowUpId,
              })}
              key={round.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[color:var(--ink-900)]">
                  {round.label}
                </p>
                <span className="rounded-full bg-[color:var(--sky-100)] px-3 py-1 text-xs font-medium text-[color:var(--brand-700)]">
                  {round.isLatest ? '最新结论' : '历史结论'}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                {round.questionText}
              </p>
              <p className="mt-2 text-xs text-[color:var(--ink-600)]">
                {round.conclusionTitle ?? '尚未产出结论'}
              </p>
            </a>
          ))}
        </div>

        <section
          className="rounded-3xl border border-[color:var(--line-200)] bg-white/82 p-5"
          data-testid="analysis-history-detail"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                当前查看轮次
              </p>
              <h4 className="mt-2 text-xl font-semibold text-[color:var(--ink-900)]">
                {selectedRound.label}
              </h4>
            </div>
            <span className="rounded-full bg-[color:var(--sky-100)] px-3 py-1 text-xs font-medium text-[color:var(--brand-700)]">
              {selectedRound.isLatest ? '最新轮次' : '历史轮次'}
            </span>
          </div>

          <div className="mt-4 rounded-3xl bg-white/76 p-4">
            <p className="text-xs text-[color:var(--ink-600)]">当轮输入</p>
            <p className="mt-2 text-base font-semibold text-[color:var(--ink-900)]">
              {selectedRound.questionText}
            </p>
            <ul className="mt-3 space-y-1 text-sm text-[color:var(--ink-600)]">
              {selectedRound.inputSummary.map((item) => (
                <li key={`${selectedRound.id}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl bg-white/76 p-4">
              <p className="text-xs text-[color:var(--ink-600)]">计划摘要</p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--ink-900)]">
                {selectedRound.planSummary ?? '该轮尚未生成计划摘要。'}
              </p>
              {selectedRound.planSteps.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-[color:var(--ink-600)]">
                  {selectedRound.planSteps.map((step) => (
                    <li key={`${selectedRound.id}-step-${step.order}`}>
                      步骤 {step.order} · {step.title}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="rounded-3xl bg-white/76 p-4">
              <p className="text-xs text-[color:var(--ink-600)]">主要结论</p>
              <p className="mt-2 text-base font-semibold text-[color:var(--ink-900)]">
                {selectedRound.conclusionTitle ?? '尚未产出结论'}
              </p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                {selectedRound.conclusionSummary ?? '该轮尚未回传主要结论摘要。'}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-3xl bg-white/76 p-4">
            <p className="text-xs text-[color:var(--ink-600)]">关键证据</p>
            {selectedRound.evidence.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
                {selectedRound.evidence.map((evidence, index) => (
                  <li key={`${selectedRound.id}-evidence-${index}`}>
                    {evidence.label}：{evidence.summary}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                该轮暂无可展示的关键证据摘要。
              </p>
            )}
          </div>
        </section>
      </div>
    </article>
  );
}
