import type { AnalysisPlanReadModel } from '@/application/analysis-planning/use-cases';

type AnalysisPlanPanelProps = {
  sessionId: string;
  readModel: AnalysisPlanReadModel;
  followUpId?: string;
};

export function AnalysisPlanPanel({
  sessionId,
  readModel,
  followUpId,
}: AnalysisPlanPanelProps) {
  return (
    <article className="glass-panel p-6" data-testid="analysis-plan-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
            {readModel.headline}
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
            {readModel.mode === 'multi-step' ? '计划骨架' : '极简计划'}
          </h3>
        </div>
        <span className="rounded-full bg-[color:var(--sky-100)] px-4 py-2 text-sm font-medium text-[color:var(--brand-700)]">
          {readModel.steps.length} 个步骤
        </span>
      </div>

      <p className="mt-4 text-sm leading-7 text-[color:var(--ink-600)]">
        {readModel.summary}
      </p>

      <div className="mt-5 space-y-4">
        {readModel.steps.map((step) => (
          <section
            key={step.id}
            className="rounded-3xl border border-[color:var(--line-200)] bg-white/76 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                  步骤 {step.order}
                </p>
                <h4 className="mt-2 text-lg font-semibold text-[color:var(--ink-900)]">
                  {step.title}
                </h4>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {step.dependencyLabels.length > 0 ? '有依赖' : '起始步骤'}
              </span>
            </div>

            <p className="mt-3 text-sm leading-7 text-[color:var(--ink-600)]">
              {step.objective}
            </p>

            <div className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4">
              <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                依赖步骤
              </p>
              {step.dependencyLabels.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-[color:var(--ink-900)]">
                  {step.dependencyLabels.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[color:var(--ink-600)]">
                  无，系统会从这里开始建立本次分析路径。
                </p>
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 rounded-3xl border border-[color:var(--line-200)] bg-white/78 p-5">
        <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
          执行入口
        </p>
        <p className="mt-3 text-sm leading-7 text-[color:var(--ink-600)]">
          系统会将当前计划提交到后台执行，不会在当前请求里同步跑完整个分析链路。
        </p>
        <form
          action={`/api/analysis/sessions/${sessionId}/execute`}
          className="mt-4"
          method="post"
        >
          {followUpId ? (
            <input name="followUpId" type="hidden" value={followUpId} />
          ) : null}
          <button className="primary-button" type="submit">
            开始执行分析
          </button>
        </form>
      </div>
    </article>
  );
}
