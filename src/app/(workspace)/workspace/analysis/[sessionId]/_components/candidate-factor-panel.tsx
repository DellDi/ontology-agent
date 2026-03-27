import type { CandidateFactorReadModel } from '@/application/factor-expansion/use-cases';

type CandidateFactorPanelProps = {
  readModel: CandidateFactorReadModel;
};

export function CandidateFactorPanel({
  readModel,
}: CandidateFactorPanelProps) {
  return (
    <article className="glass-panel p-6" data-testid="candidate-factor-panel">
      <p className="text-sm font-medium tracking-[0.22em] text-[color:var(--brand-700)] uppercase">
        {readModel.headline}
      </p>
      <p className="mt-3 text-sm leading-7 text-[color:var(--ink-600)]">
        {readModel.disclaimer}
      </p>

      {readModel.mode === 'skip' ? (
        <div className="mt-5 rounded-3xl bg-white/76 p-5">
          <p className="text-sm font-medium text-[color:var(--ink-900)]">
            {readModel.skipReason}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
            后续会直接沿当前问题进入查询、对比或展示步骤，不额外强加无关因素。
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {readModel.factors.map((factor) => (
            <section key={factor.key} className="rounded-3xl bg-white/76 p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-[color:var(--ink-900)]">
                  {factor.label}
                </h3>
                <span className="rounded-full bg-[color:var(--sky-100)] px-3 py-1 text-xs font-medium text-[color:var(--brand-700)]">
                  候选方向
                </span>
              </div>
              <p className="mt-3 text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                {readModel.basisLabel}
              </p>
              <p className="mt-2 text-sm leading-7 text-[color:var(--ink-600)]">
                {factor.rationale}
              </p>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
