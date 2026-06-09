'use client';

import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';

import { getString, getItems, renderTitle } from './rendering-utils';

export function renderEvidenceCardBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const evidence = getItems(renderedBlock.payload.evidence);
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <p className="mt-2 text-sm leading-7 text-[color:var(--ink-700)]">
        {getString(renderedBlock.payload.summary)}
      </p>
      <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
        {evidence.map((item) => (
          <li key={getString(item.label)}>
            {getString(item.label)}：{getString(item.summary)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function renderTimelineBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <ol className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
        {items.map((item) => (
          <li key={getString(item.id)}>
            {getString(item.title)} · {getString(item.status)}
            {item.summary ? ` · ${String(item.summary)}` : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function renderApprovalStateBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <p className="mt-2 text-sm font-medium text-[color:var(--ink-900)]">
        {getString(renderedBlock.payload.state)}
        {renderedBlock.payload.owner ? ` · ${String(renderedBlock.payload.owner)}` : ''}
      </p>
      {renderedBlock.payload.reason ? (
        <p className="mt-2 text-sm text-[color:var(--ink-600)]">
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
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
        {items.map((item) => (
          <li key={getString(item.skillName)}>
            {getString(item.skillName)} · {getString(item.status)}
            {item.summary ? ` · ${String(item.summary)}` : ''}
          </li>
        ))}
      </ul>
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
      className={`${className} rounded-3xl border border-amber-100 bg-amber-50/80 p-4`}
      data-testid={testId || undefined}
    >
      {renderTitle(renderedBlock, '自动执行假设')}
      <ul className="mt-2 space-y-1 text-sm leading-7 text-amber-900">
        {assumptions.map((assumption) => (
          <li key={assumption}>- {assumption}</li>
        ))}
      </ul>
      {note ? (
        <p className="mt-2 text-xs leading-6 text-amber-700">
          {note}
        </p>
      ) : null}
    </section>
  );
}