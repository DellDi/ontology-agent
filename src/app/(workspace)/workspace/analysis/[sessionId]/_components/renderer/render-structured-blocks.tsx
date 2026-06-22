'use client';

import { EvidenceCard, type EvidenceItem } from '@/app/_components/workbench/evidence-card';
import { Timeline, type TimelineStatus } from '@/app/_components/workbench/timeline';
import { Badge } from '@/app/_components/workbench/badge';

import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';

import { getString, getItems, renderTitle } from './rendering-utils';

function normalizeTimelineStatus(status: unknown): TimelineStatus {
  const text = getString(status).toLowerCase();
  if (text.includes('fail')) return 'failed';
  if (text.includes('run') || text.includes('progress')) return 'running';
  if (text.includes('complete') || text.includes('done') || text.includes('succ'))
    return 'completed';
  return 'pending';
}

export function renderEvidenceCardBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const rawEvidence = getItems(renderedBlock.payload.evidence);
  const items: EvidenceItem[] = rawEvidence.map((item) => ({
    label: getString(item.label),
    summary: getString(item.summary),
    source: item.source ? getString(item.source) : undefined,
  }));
  const titleNode = renderedBlock.title;
  return (
    <EvidenceCard
      className={className}
      title={titleNode}
      summary={getString(renderedBlock.payload.summary)}
      items={items}
    />
  );
}

export function renderTimelineBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const rawItems = getItems(renderedBlock.payload.items);
  if (rawItems.length === 0) {
    return (
      <div
        className={`${className} rounded-md border border-border bg-card p-4 text-sm text-muted-foreground`}
      >
        {renderTitle(renderedBlock)}
        <p className="mt-2">本步骤未输出可视化的时间线节点。</p>
      </div>
    );
  }
  return (
    <div
      className={`${className} rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]`}
    >
      {renderTitle(renderedBlock)}
      <Timeline
        className="mt-3"
        items={rawItems.map((item, index) => ({
          id: getString(item.id, `timeline-${index}`),
          title: getString(item.title),
          status: normalizeTimelineStatus(item.status),
          summary: item.summary ? getString(item.summary) : undefined,
        }))}
      />
    </div>
  );
}

export function renderApprovalStateBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div
      className={`${className} rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]`}
    >
      {renderTitle(renderedBlock)}
      <p className="mt-2 text-sm font-medium text-foreground">
        {getString(renderedBlock.payload.state)}
        {renderedBlock.payload.owner
          ? ` · ${String(renderedBlock.payload.owner)}`
          : ''}
      </p>
      {renderedBlock.payload.reason ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {String(renderedBlock.payload.reason)}
        </p>
      ) : null}
    </div>
  );
}

export function renderSkillsStateBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  return (
    <div
      className={`${className} rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]`}
    >
      {renderTitle(renderedBlock)}
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">本步骤未输出技能状态。</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm text-foreground">
          {items.map((item) => {
            const status = normalizeTimelineStatus(item.status);
            const tone =
              status === 'failed'
                ? 'error'
                : status === 'completed'
                  ? 'success'
                  : status === 'running'
                    ? 'info'
                    : 'neutral';
            return (
              <li
                key={getString(item.skillName)}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="font-medium">{getString(item.skillName)}</span>
                <Badge tone={tone}>{getString(item.status)}</Badge>
                {item.summary ? (
                  <span className="text-sm text-muted-foreground">
                    · {String(item.summary)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function renderAssumptionCardBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const assumptions = Array.isArray(renderedBlock.payload.assumptions)
    ? renderedBlock.payload.assumptions.map((item) => String(item))
    : [];
  const note = getString(renderedBlock.payload.note);
  const testId = getString(renderedBlock.payload.testId);

  return (
    <section
      className={`${className} rounded-md border border-[color:var(--warning-500)]/30 bg-[color:color-mix(in_srgb,var(--warning-500)_10%,transparent)] p-4`}
      data-testid={testId || undefined}
    >
      {renderTitle(renderedBlock, '自动执行假设')}
      {assumptions.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">本步骤未生成假设条目。</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm leading-7 text-foreground">
          {assumptions.map((assumption) => (
            <li key={assumption}>· {assumption}</li>
          ))}
        </ul>
      )}
      {note ? (
        <p className="mt-2 text-xs leading-6 text-muted-foreground">{note}</p>
      ) : null}
    </section>
  );
}
