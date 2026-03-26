import {
  getContextFieldStateLabel,
  type AnalysisContext,
  type AnalysisContextFieldState,
} from '@/domain/analysis-context/models';

type AnalysisContextPanelProps = {
  context: AnalysisContext;
};

function getStateBadgeClassName(state: AnalysisContextFieldState) {
  switch (state) {
    case 'confirmed':
      return 'bg-emerald-100 text-emerald-700';
    case 'uncertain':
      return 'bg-amber-100 text-amber-700';
    case 'missing':
      return 'bg-slate-100 text-slate-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function ContextFieldCard({
  label,
  value,
  state,
  note,
}: AnalysisContext['targetMetric']) {
  return (
    <div className="rounded-3xl bg-white/76 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[color:var(--ink-600)]">{label}</p>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${getStateBadgeClassName(state)}`}
        >
          {getContextFieldStateLabel(state)}
        </span>
      </div>
      <p className="mt-2 text-base font-medium text-[color:var(--ink-900)]">
        {value}
      </p>
      {note && (
        <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">{note}</p>
      )}
    </div>
  );
}

export function AnalysisContextPanel({
  context,
}: AnalysisContextPanelProps) {
  return (
    <article className="glass-panel p-6" data-testid="analysis-context">
      <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
        分析上下文
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <ContextFieldCard {...context.targetMetric} />
        <ContextFieldCard {...context.entity} />
        <ContextFieldCard {...context.timeRange} />
        <ContextFieldCard {...context.comparison} />
      </div>

      <div className="mt-5 rounded-3xl bg-white/76 p-5">
        <p className="text-xs text-[color:var(--ink-600)]">约束条件</p>
        {context.constraints.length > 0 ? (
          <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
            {context.constraints.map((constraint) => (
              <li key={`${constraint.label}-${constraint.value}`}>
                {constraint.label}：{constraint.value}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm leading-6 text-[color:var(--ink-600)]">
            未识别到明确约束条件（待补充）。
          </p>
        )}
      </div>
    </article>
  );
}
