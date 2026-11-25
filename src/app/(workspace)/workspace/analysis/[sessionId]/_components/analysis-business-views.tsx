'use client';

import type {
  MetricCard,
  Visualization,
} from '@/application/analysis-message-projection/conversation-view-model';
import type { AnalysisInteractionUiRenderInput } from './analysis-interaction-ui-renderer-registry';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import { getDefaultAnalysisInteractionUiRendererRegistry } from './analysis-interaction-ui-renderer-registry';
import { MarkdownContent } from '@/app/_components/markdown-content';

function MetricTrendPill({
  trend,
  label,
}: {
  trend: 'up' | 'down' | 'stable';
  label?: string;
}) {
  const styles =
    trend === 'up'
      ? 'bg-[var(--success-soft)] text-[var(--success-ink)]'
      : trend === 'down'
        ? 'bg-[var(--danger-soft)] text-[var(--danger-ink)]'
        : 'bg-sky-100 text-muted-foreground';
  const symbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  return (
    <span
      className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${styles}`}
    >
      <span aria-hidden>{symbol}</span>
      {label ? <span>{label}</span> : null}
    </span>
  );
}

export function MetricCardsGrid({ cards }: { cards: MetricCard[] }) {
  if (cards.length === 0) return null;

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card, index) => (
        <div
          key={`${card.label}-${index}`}
          className="analysis-block-enter rounded-xl border border-border bg-sky-50/75 px-4 py-3.5 shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--line-300)]"
          style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}
        >
          <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
          <p className="mt-1.5 flex items-baseline gap-1.5 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
            <span>{card.value}</span>
            {card.unit ? (
              <span className="text-sm font-normal text-muted-foreground">
                {card.unit}
              </span>
            ) : null}
          </p>
          {card.trend ? (
            <MetricTrendPill label={card.trendLabel} trend={card.trend} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function VisualizationBlock({
  visualization,
  registry,
  onOpenSidePanel,
}: {
  visualization: Visualization;
  onOpenSidePanel?: AnalysisInteractionUiRenderInput['onOpenSidePanel'];
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
    <div className="analysis-block-enter mt-4">
      {registry.render({ renderedBlock: block, embedded: true, onOpenSidePanel })}
      {visualization.summary ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {visualization.summary}
        </p>
      ) : null}
    </div>
  );
}

export function PrimaryAnswerBlock({ answer }: { answer: string }) {
  if (!answer) return null;

  return (
    <div className="analysis-block-enter mt-1">
      <MarkdownContent className="text-[15px] leading-[1.78] text-foreground">
        {answer}
      </MarkdownContent>
    </div>
  );
}
