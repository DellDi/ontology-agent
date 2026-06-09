'use client';

import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';

import { getToneClassName, getString, getItems, getToolStatusLabel, renderTitle } from './rendering-utils';

export function renderStatusBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl p-4 ${getToneClassName(renderedBlock.payload.tone)}`}>
      {renderTitle(renderedBlock)}
      <p className="mt-2 text-sm font-medium text-[color:var(--ink-900)]">
        {getString(renderedBlock.payload.value)}
      </p>
    </div>
  );
}

export function renderKvListBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <dl className="mt-3 grid gap-2 md:grid-cols-2">
        {items.map((item) => (
          <div key={getString(item.label)}>
            <dt className="text-xs text-[color:var(--ink-600)]">
              {getString(item.label)}
            </dt>
            <dd className="mt-1 text-sm text-[color:var(--ink-900)]">
              {getString(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function renderToolListBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock, '工具调用')}
      <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
        {items.map((item) => (
          <li key={`${getString(item.toolName)}-${getString(item.objective)}`}>
            {getString(item.toolName)} · {getString(item.objective)} ·{' '}
            {getToolStatusLabel(item.status)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function renderMarkdownBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <p className="mt-2 text-sm leading-7 text-[color:var(--ink-600)]">
        {getString(renderedBlock.payload.content)}
      </p>
    </div>
  );
}

export function renderReasoningSummaryBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle({ ...renderedBlock, title: '推理摘要' })}
      <p className="mt-2 text-sm leading-7 text-[color:var(--ink-600)]">
        {getString(renderedBlock.payload.content)}
      </p>
    </div>
  );
}