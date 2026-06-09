'use client';

import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';

import { getString, renderTitle } from './rendering-utils';

export function renderFallbackBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl border border-amber-100 bg-amber-50/80 p-4`}>
      {renderTitle(renderedBlock, 'Fallback')}
      <p className="mt-2 text-sm leading-7 text-amber-900">
        未支持的分析块：{getString(renderedBlock.payload.originalKind, renderedBlock.kind)}
      </p>
      <p className="mt-1 text-xs text-amber-700">
        {getString(renderedBlock.payload.reason, 'renderer fallback')}
      </p>
    </div>
  );
}

export function renderRenderErrorBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div
      className={`${className} rounded-2xl border border-rose-200 bg-rose-50/80 p-4`}
      data-testid="analysis-render-error"
    >
      {renderTitle(renderedBlock, '渲染异常')}
      <p className="mt-2 text-sm leading-7 text-rose-900">
        Block 类型：{getString(renderedBlock.payload.originalBlockType, 'unknown')}
      </p>
      <p className="mt-1 text-xs text-rose-700">
        {getString(renderedBlock.payload.errorMessage, '未知错误')}
      </p>
    </div>
  );
}

export function renderConclusionSummaryBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock, '分析结论')}
      <p className="mt-2 text-sm leading-7 text-[color:var(--ink-600)]">
        {getString(renderedBlock.payload.summary)}
      </p>
    </div>
  );
}