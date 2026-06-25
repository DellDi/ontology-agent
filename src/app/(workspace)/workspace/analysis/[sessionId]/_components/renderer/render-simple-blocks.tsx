'use client';

import { Badge } from '@/app/_components/workbench/badge';
import { MarkdownContent } from '@/app/_components/markdown-content';

import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';

import {
  getToneClassName,
  getString,
  getItems,
  getToolStatusLabel,
  renderTitle,
} from './rendering-utils';

export function renderStatusBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div
      className={`${className} rounded-md p-4 ${getToneClassName(renderedBlock.payload.tone)}`}
    >
      {renderTitle(renderedBlock)}
      <p className="mt-2 text-sm font-medium text-foreground">
        {getString(renderedBlock.payload.value)}
      </p>
    </div>
  );
}

export function renderKvListBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  if (items.length === 0) {
    return (
      <div
        className={`${className} rounded-md border border-border bg-card p-4 text-sm text-muted-foreground`}
      >
        {renderTitle(renderedBlock)}
        <p className="mt-2">本步骤未输出键值数据。</p>
      </div>
    );
  }
  return (
    <div
      className={`${className} rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]`}
    >
      {renderTitle(renderedBlock)}
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={getString(item.label)}
            className="rounded border border-border/60 bg-background px-3 py-2"
          >
            <dt className="text-xs font-medium text-muted-foreground">
              {getString(item.label)}
            </dt>
            <dd className="mt-1 text-sm break-words text-foreground">
              {getString(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function renderToolListBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  return (
    <div
      className={`${className} rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]`}
    >
      {renderTitle(renderedBlock, '工具调用')}
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">本步骤未调用任何工具。</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm text-foreground">
          {items.map((item) => {
            const status = getString(item.status);
            const tone =
              status === 'completed'
                ? 'success'
                : status === 'failed'
                  ? 'error'
                  : status === 'running'
                    ? 'info'
                    : 'neutral';
            return (
              <li
                key={`${getString(item.toolName)}-${getString(item.objective)}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="font-medium">{getString(item.toolName)}</span>
                <span className="text-muted-foreground">
                  {getString(item.objective)}
                </span>
                <Badge tone={tone}>{getToolStatusLabel(status)}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function renderMarkdownBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div
      className={`${className} rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]`}
    >
      {renderTitle(renderedBlock)}
      <div className="mt-2 text-sm">
        <MarkdownContent>
          {getString(renderedBlock.payload.content)}
        </MarkdownContent>
      </div>
    </div>
  );
}

export function renderReasoningSummaryBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div
      className={`${className} rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]`}
    >
      {renderTitle({ ...renderedBlock, title: '推理摘要' })}
      <p className="mt-2 text-sm leading-7 break-words whitespace-pre-wrap text-muted-foreground">
        {getString(renderedBlock.payload.content)}
      </p>
    </div>
  );
}
