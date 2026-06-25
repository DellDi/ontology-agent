'use client';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import { MarkdownContent } from '@/app/_components/markdown-content';
import { getDefaultAnalysisInteractionUiRendererRegistry } from './analysis-interaction-ui-renderer-registry';

function formatConfidenceBadge(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 1) return `${Math.round(value * 100)}%`;
  return `${value}%`;
}

function ConclusionSummaryBlock({
  block,
}: {
  block: AnalysisRenderedBlock;
}) {
  const causes = Array.isArray(block.payload.causes)
    ? (block.payload.causes as {
        title: string;
        summary: string;
        confidence?: number | null;
        evidence?: { label: string; summary: string }[];
      }[])
    : [];

  return (
    <div className="space-y-4">
      {causes.map((cause, index) => {
        const confidenceLabel = formatConfidenceBadge(cause.confidence);
        const evidenceItems = Array.isArray(cause.evidence) ? cause.evidence : [];

        return (
          <div
            key={`${cause.title}-${index}`}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-base font-semibold text-foreground">
                {index + 1}. {cause.title}
              </h4>
              {confidenceLabel ? (
                <span className="shrink-0 rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  置信度 {confidenceLabel}
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-sm leading-7 text-muted-foreground">
              <MarkdownContent>{cause.summary}</MarkdownContent>
            </div>
            {evidenceItems.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {evidenceItems.map((item, evidenceIndex) => (
                  <li
                    key={evidenceIndex}
                    className="text-xs text-muted-foreground"
                  >
                    · <span className="font-medium">{item.label}</span>：{item.summary}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function AnalysisResultBlockRenderer({
  block,
}: {
  block: AnalysisRenderedBlock;
}) {
  const registry = getDefaultAnalysisInteractionUiRendererRegistry();

  if (block.kind === 'conclusion-summary') {
    return <ConclusionSummaryBlock block={block} />;
  }

  return (
    <div className="mt-4">
      {registry.render({ renderedBlock: block })}
    </div>
  );
}
