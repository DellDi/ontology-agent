'use client';

import {
  buildAssumptionCardPart,
  normalizeExecutionRenderBlock,
  renderAnalysisInteractionPart,
} from '@/application/analysis-interaction';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { OntologyVersionBinding } from '@/domain/ontology/version-binding';
import { formatOntologyVersionBindingBadge } from '@/shared/ontology/version-binding-display';

import { AnalysisInteractionRenderedBlock } from './analysis-interaction-rendered-block';

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
  const assumptionsRenderedBlock = hasAssumptions
    ? renderAnalysisInteractionPart(
        buildAssumptionCardPart({
          assumptions: planAssumptions ?? [],
          title: '本轮结论所依赖的自动执行假设',
          note: '若与你的真实意图不一致，可通过追问或「继续追问」纠偏，系统会重规划后再次执行。',
          testId: 'analysis-conclusion-assumptions',
          source: {
            sourceType: 'conclusion-read-model',
            eventId: 'conclusion-assumptions',
            blockIndex: -1,
          },
        }),
        {
          surface: 'workspace',
        },
      )
    : null;

  return (
    <article className="rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)]" data-testid="analysis-conclusion-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.12em] text-primary">
            归因结论
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-foreground">
            排序后的原因列表
          </h3>
        </div>
        <span className="rounded-md bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
          {readModel.causes.length} 个候选原因
        </span>
        {ontologyVersionBinding ? (
          <span
            className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-muted-foreground"
            data-testid="analysis-conclusion-ontology-version"
          >
            {formatOntologyVersionBindingBadge(ontologyVersionBinding)}
          </span>
        ) : null}
      </div>

      {hasAssumptions ? (
        <AnalysisInteractionRenderedBlock
          className="mt-5"
          renderedBlock={assumptionsRenderedBlock!}
        />
      ) : null}

      <div className="mt-5 space-y-4">
        {readModel.causes.map((cause) => (
          <section
            key={cause.id}
            className="rounded-lg border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium tracking-[0.12em] text-primary">
                  原因 {cause.rank}
                </p>
                <h4 className="mt-2 text-lg font-semibold text-foreground">
                  {cause.title}
                </h4>
              </div>
              <span className="rounded-md bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                {typeof cause.confidence === 'number'
                  ? `置信度 ${Math.round(cause.confidence * 100)}%`
                  : '证据评分待补充'}
              </span>
            </div>

            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {cause.summary}
            </p>

            <div className="mt-4 rounded-lg bg-muted p-4">
              <p className="text-xs font-medium tracking-[0.12em] text-primary">
                关键证据
              </p>
              <ul className="mt-3 space-y-2 text-sm text-foreground">
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

      {readModel.renderBlocks.map((block, index) => {
        const part = normalizeExecutionRenderBlock(block, {
          sourceType: 'conclusion-read-model',
          blockIndex: index,
        });
        const renderedBlock = renderAnalysisInteractionPart(part, {
          surface: 'workspace',
        });

        return (
          <AnalysisInteractionRenderedBlock
            className="mt-6 border border-border bg-card"
            key={part.id}
            renderedBlock={renderedBlock}
          />
        );
      })}
    </article>
  );
}
