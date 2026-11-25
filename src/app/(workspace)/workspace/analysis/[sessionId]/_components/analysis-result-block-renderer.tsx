'use client';

import type { AnalysisObjectSelection } from '@/domain/analysis-execution/object-selection';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import type { AnalysisInteractionUiRenderInput } from './analysis-interaction-ui-renderer-registry';
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
    <div className="space-y-3">
      {causes.map((cause, index) => {
        const confidenceLabel = formatConfidenceBadge(cause.confidence);
        const evidenceItems = Array.isArray(cause.evidence) ? cause.evidence : [];

        return (
          <div
            key={`${cause.title}-${index}`}
            className="rounded-xl border border-border bg-sky-50/65 px-4 py-3.5 shadow-[var(--shadow-panel)]"
          >
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-[15px] font-semibold text-foreground">
                <span className="mr-1.5 text-primary tabular-nums">{index + 1}.</span>
                {cause.title}
              </h4>
              {confidenceLabel ? (
                <span className="shrink-0 rounded-full border border-[var(--brand-300)]/40 bg-[var(--brand-soft)] px-2.5 py-0.5 text-xs font-medium tabular-nums text-[var(--brand-900)]">
                  置信度 {confidenceLabel}
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-[14.5px] leading-relaxed text-foreground/85">
              <MarkdownContent>{cause.summary}</MarkdownContent>
            </div>
            {evidenceItems.length > 0 ? (
              <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-2.5">
                {evidenceItems.map((item, evidenceIndex) => (
                  <li
                    key={evidenceIndex}
                    className="text-xs leading-5 text-muted-foreground"
                  >
                    · <span className="font-medium text-foreground/85">{item.label}</span>：{item.summary}
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
  embedded = false,
  onObjectSelect,
  focusedObject,
  onOpenSidePanel,
}: {
  block: AnalysisRenderedBlock;
  /** 嵌套在对话气泡内：子块去卡片边框与阴影，避免大框套小框。 */
  embedded?: boolean;
  focusedObject?: AnalysisObjectSelection;
  onObjectSelect?: (selection: AnalysisObjectSelection, label: string, question?: string) => boolean | void;
  onOpenSidePanel?: AnalysisInteractionUiRenderInput['onOpenSidePanel'];
}) {
  const registry = getDefaultAnalysisInteractionUiRendererRegistry();

  if (block.kind === 'conclusion-summary') {
    return <ConclusionSummaryBlock block={block} />;
  }

  return (
    <div className="mt-4">
      {registry.render({ renderedBlock: block, embedded, focusedObject, onObjectSelect, onOpenSidePanel })}
    </div>
  );
}
