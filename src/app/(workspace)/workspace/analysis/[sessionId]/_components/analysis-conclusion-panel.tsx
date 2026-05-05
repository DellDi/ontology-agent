'use client';

import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { OntologyVersionBinding } from '@/domain/ontology/version-binding';
import { formatOntologyVersionBindingBadge } from '@/shared/ontology/version-binding-display';

type AnalysisConclusionPanelProps = {
  readModel: AnalysisConclusionReadModel;
  // D5 / P12: 本轮结论所依赖的显式假设。
  // Story 5.1 AC-B 要求 "结果中展示 assumptions"，保证用户在阅读结论时能识别
  // 哪些条件是系统自动补齐的，支撑 auditable 与可靠追问。
  planAssumptions?: string[];
  ontologyVersionBinding?: OntologyVersionBinding | null;
};

export function AnalysisConclusionPanel({
  readModel,
  planAssumptions,
  ontologyVersionBinding,
}: AnalysisConclusionPanelProps) {
  if (readModel.causes.length === 0) {
    return null;
  }

  const hasAssumptions = (planAssumptions?.length ?? 0) > 0;

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
        {ontologyVersionBinding ? (
          <span
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-[color:var(--ink-600)]"
            data-testid="analysis-conclusion-ontology-version"
          >
            {formatOntologyVersionBindingBadge(ontologyVersionBinding)}
          </span>
        ) : null}
      </div>

      {hasAssumptions ? (
        <section
          className="mt-5 rounded-3xl border border-amber-100 bg-amber-50/80 p-4"
          data-testid="analysis-conclusion-assumptions"
        >
          <p className="text-xs font-medium tracking-[0.18em] text-amber-700 uppercase">
            本轮结论所依赖的自动执行假设
          </p>
          <ul className="mt-2 space-y-1 text-sm leading-7 text-amber-900">
            {planAssumptions?.map((assumption) => (
              <li key={assumption}>- {assumption}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-6 text-amber-700">
            若与你的真实意图不一致，可通过追问或「继续追问」纠偏，系统会重规划后再次执行。
          </p>
        </section>
      ) : null}

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
                {typeof cause.confidence === 'number'
                  ? `置信度 ${Math.round(cause.confidence * 100)}%`
                  : '证据评分待补充'}
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
