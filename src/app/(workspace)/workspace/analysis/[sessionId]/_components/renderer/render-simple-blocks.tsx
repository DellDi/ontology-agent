'use client';

import { Badge } from '@/components/ui/badge';
import { MarkdownContent } from '@/app/_components/markdown-content';

import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';
import { resultDrilldownActions } from './result-drilldown';

import {
  getToneClassName,
  getString,
  getItems,
  getToolStatusLabel,
  renderTitle,
  panelChrome,
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

export function renderKvListBlock(input: AnalysisInteractionUiRenderInput) {
  const {
  renderedBlock,
  className = '',
  embedded = false,
  } = input;
  const drilldown = resultDrilldownActions(input);
  const items = getItems(renderedBlock.payload.items);
  if (items.length === 0) {
    return (
      <div
        className={`${className} ${panelChrome(embedded)} text-sm text-muted-foreground`}
      >
        {renderTitle(renderedBlock)}
        <p className="mt-2">本步骤未输出键值数据。</p>
      </div>
    );
  }
  return (
    <div
      className={`${className} ${panelChrome(embedded)}`}
    >
      {renderTitle(renderedBlock)}
      <dl className={`mt-3 grid gap-3 sm:grid-cols-2 ${renderedBlock.payload.drilldowns ? 'lg:grid-cols-3' : ''}`}>
        {items.map((item, index) => (
          <div
            key={getString(item.label)}
            className={renderedBlock.payload.drilldowns ? 'rounded-lg bg-muted/50 px-4 py-3' : 'rounded border border-border/60 bg-background px-3 py-2'}
          >
            <dt className="text-xs font-medium text-muted-foreground">
              {getString(item.label)}
            </dt>
            <dd className={`mt-1 break-words text-foreground ${renderedBlock.payload.drilldowns ? 'text-2xl font-semibold tabular-nums' : 'text-sm'}`}>
              {drilldown.has(0, index) ? <button type="button" onClick={() => drilldown.open(0, index)}
                aria-label={`查看${getString(item.label)}的支撑对象`}
                className="cursor-pointer text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {getString(item.value)}<span className="ml-2 text-xs font-normal">查看对象 ↗</span>
              </button> : getString(item.value)}
            </dd>
          </div>
        ))}
      </dl>
      {drilldown.reason ? <p className="mt-2 text-xs text-muted-foreground">{drilldown.reason}</p> : null}
    </div>
  );
}

export function renderToolListBlock({
  renderedBlock,
  className = '',
  embedded = false,
}: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  return (
    <div
      className={`${className} ${panelChrome(embedded)}`}
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
                <Badge variant={tone}>{getToolStatusLabel(status)}</Badge>
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
  embedded = false,
}: AnalysisInteractionUiRenderInput) {
  return (
    <div
      className={`${className} ${panelChrome(embedded)}`}
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
  embedded = false,
}: AnalysisInteractionUiRenderInput) {
  return (
    <div
      className={`${className} ${panelChrome(embedded)}`}
    >
      {renderTitle({ ...renderedBlock, title: '推理摘要' })}
      <p className="mt-2 text-sm leading-7 break-words whitespace-pre-wrap text-muted-foreground">
        {getString(renderedBlock.payload.content)}
      </p>
    </div>
  );
}
