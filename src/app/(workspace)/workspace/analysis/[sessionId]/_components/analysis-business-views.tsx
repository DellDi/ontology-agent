'use client';

import type {
  MetricCard,
  Visualization,
} from '@/application/analysis-message-projection/conversation-view-model';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import { getDefaultAnalysisInteractionUiRendererRegistry } from './analysis-interaction-ui-renderer-registry';

function MetricTrendIcon({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  switch (trend) {
    case 'up':
      return <span aria-hidden className="text-emerald-500">↑</span>;
    case 'down':
      return <span aria-hidden className="text-rose-500">↓</span>;
    case 'stable':
      return <span aria-hidden className="text-[color:var(--ink-600)]">→</span>;
  }
}

export function MetricCardsGrid({ cards }: { cards: MetricCard[] }) {
  if (cards.length === 0) return null;

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card, index) => (
        <div
          key={`${card.label}-${index}`}
          className="rounded-xl border border-[color:var(--line-200)] bg-white px-4 py-3 shadow-sm"
        >
          <p className="text-xs text-[color:var(--ink-600)]">{card.label}</p>
          <p className="mt-1 flex items-baseline gap-1.5 text-2xl font-semibold text-[color:var(--ink-900)]">
            <span>{card.value}</span>
            {card.unit ? (
              <span className="text-sm font-normal text-[color:var(--ink-600)]">
                {card.unit}
              </span>
            ) : null}
          </p>
          {card.trend ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-[color:var(--ink-600)]">
              <MetricTrendIcon trend={card.trend} />
              {card.trendLabel ? <span>{card.trendLabel}</span> : null}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function VisualizationBlock({
  visualization,
  registry,
}: {
  visualization: Visualization;
  registry: ReturnType<typeof getDefaultAnalysisInteractionUiRendererRegistry>;
}) {
  const block: AnalysisRenderedBlock = {
    kind:
      visualization.type === 'chart'
        ? 'chart'
        : visualization.type === 'graph'
          ? 'graph'
          : 'table',
    surface: 'workspace',
    title: visualization.title,
    label: visualization.title,
    variant:
      visualization.type === 'chart'
        ? 'chart'
        : visualization.type === 'graph'
          ? 'graph'
          : 'table',
    source: { sourceType: 'runtime-foundation-part' },
    payload: (visualization.data as Record<string, unknown>) ?? {},
    diagnostics: { originalType: visualization.type },
  };

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-[color:var(--ink-900)]">
          {visualization.title}
        </h4>
      </div>
      {registry.render({ renderedBlock: block })}
      {visualization.summary ? (
        <p className="mt-2 text-xs leading-5 text-[color:var(--ink-600)]">
          {visualization.summary}
        </p>
      ) : null}
    </div>
  );
}

export function PrimaryAnswerBlock({ answer }: { answer: string }) {
  if (!answer) return null;

  return (
    <div className="mt-3 rounded-xl bg-white/80 px-4 py-3 shadow-sm ring-1 ring-[color:var(--line-200)]">
      <p className="text-base leading-7 text-[color:var(--ink-900)]">{answer}</p>
    </div>
  );
}