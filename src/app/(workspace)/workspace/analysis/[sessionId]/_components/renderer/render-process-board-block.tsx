'use client';

import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';

import { getItems, getString, renderTitle } from './rendering-utils';

export function renderProcessBoardBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const progress =
    renderedBlock.payload.progress &&
    typeof renderedBlock.payload.progress === 'object' &&
    !Array.isArray(renderedBlock.payload.progress)
      ? (renderedBlock.payload.progress as Record<string, unknown>)
      : null;
  const steps = getItems(renderedBlock.payload.steps);
  const total = typeof progress?.total === 'number' ? progress.total : 0;
  const percent = typeof progress?.percent === 'number' ? progress.percent : 0;
  const eventCount =
    typeof renderedBlock.payload.eventCount === 'number'
      ? renderedBlock.payload.eventCount
      : 0;
  const emptyMessage = getString(
    renderedBlock.payload.emptyMessage,
    '正在等待执行事件，请保持当前页面打开。',
  );

  return (
    <section
      className={`${className} rounded-lg border border-border bg-card p-5`}
      data-testid="analysis-process-board"
    >
      {renderTitle(renderedBlock, '执行流程看板')}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          实时状态与过程摘要
        </p>
        <span className="rounded-md bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          {eventCount} 条事件
        </span>
      </div>

      <div className="mt-4">
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className="h-2 rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {getString(progress?.label, '正在初始化执行流程')}
        </p>
      </div>

      {steps.length === 0 || total <= 0 ? (
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {steps.map((item) => (
            <div
              className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2"
              key={getString(item.id)}
            >
              <p className="text-sm text-foreground">
                {String(item.order)}. {getString(item.title)}
              </p>
              <span
                className={`rounded-md px-3 py-1 text-xs font-medium ${item.status === 'completed'
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : item.status === 'failed'
                    ? 'bg-rose-500/10 text-rose-600'
                    : 'bg-primary/10 text-primary'}`}
              >
                {item.status === 'completed'
                  ? '完成'
                  : item.status === 'failed'
                    ? '失败'
                    : '进行中'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
