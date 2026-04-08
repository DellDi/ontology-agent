'use client';

import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';

type AnalysisConclusionPanelProps = {
  readModel: AnalysisConclusionReadModel;
};

export function AnalysisConclusionPanel({
  readModel,
}: AnalysisConclusionPanelProps) {
  if (readModel.causes.length === 0) {
    return null;
  }

  return (
    <article className="glass-panel p-6" data-testid="analysis-conclusion-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
            归因结论
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
            排序后的原因列表
          </h3>
        </div>
        <span className="rounded-full bg-[color:var(--sky-100)] px-4 py-2 text-sm font-medium text-[color:var(--brand-700)]">
          {readModel.causes.length} 个候选原因
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {readModel.causes.map((cause) => (
          <section
            key={cause.id}
            className="rounded-3xl border border-[color:var(--line-200)] bg-white/76 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                  原因 {cause.rank}
                </p>
                <h4 className="mt-2 text-lg font-semibold text-[color:var(--ink-900)]">
                  {cause.title}
                </h4>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                置信度 {Math.round(cause.confidence * 100)}%
              </span>
            </div>

            <p className="mt-3 text-sm leading-7 text-[color:var(--ink-600)]">
              {cause.summary}
            </p>

            <div className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4">
              <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                关键证据
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
                {cause.evidence.map((evidence) => (
                  <li key={`${cause.id}-${evidence.label}`}>
                    {evidence.label}：{evidence.summary}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>

      {readModel.renderBlocks.map((block, index) =>
        block.type === 'table' ? (
          <div
            key={`${block.title}-${index}`}
            className="mt-6 rounded-3xl border border-[color:var(--line-200)] bg-white/78 p-5"
          >
            <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
              {block.title}
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-[color:var(--ink-900)]">
                <thead>
                  <tr className="border-b border-[color:var(--line-200)] text-[color:var(--ink-600)]">
                    {block.columns.map((column) => (
                      <th key={column} className="px-3 py-2 font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr
                      key={`${block.title}-row-${rowIndex}`}
                      className="border-b border-[color:var(--line-200)] last:border-b-0"
                    >
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`${block.title}-cell-${rowIndex}-${cellIndex}`}
                          className="px-3 py-2"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null,
      )}
    </article>
  );
}
