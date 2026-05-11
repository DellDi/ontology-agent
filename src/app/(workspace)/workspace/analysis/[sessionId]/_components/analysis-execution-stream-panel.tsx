'use client';

import {
  buildProcessBoardPart,
  normalizeExecutionRenderBlock,
  renderAnalysisInteractionPart,
} from '@/application/analysis-interaction';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';

import { AnalysisInteractionRenderedBlock } from './analysis-interaction-rendered-block';

type AnalysisExecutionStreamPanelProps = {
  events: AnalysisExecutionStreamEvent[];
  variant?: 'embedded' | 'side-sheet';
};

function getEventStatusLabel(event: AnalysisExecutionStreamEvent) {
  if (event.status === 'completed' || event.step?.status === 'completed') {
    return '已完成';
  }

  if (event.status === 'failed' || event.step?.status === 'failed') {
    return '已失败';
  }

  return '执行中';
}

function getEventStatusClassName(event: AnalysisExecutionStreamEvent) {
  if (event.status === 'completed' || event.step?.status === 'completed') {
    return 'bg-emerald-100 text-emerald-700';
  }

  if (event.status === 'failed' || event.step?.status === 'failed') {
    return 'bg-rose-100 text-rose-700';
  }

  return 'bg-sky-100 text-[color:var(--brand-700)]';
}


export function AnalysisExecutionStreamPanel({
  events,
  variant = 'embedded',
}: AnalysisExecutionStreamPanelProps) {
  const processBoardPart = buildProcessBoardPart({
    sessionId: events[0]?.sessionId ?? 'session-unknown',
    executionId: events[0]?.executionId ?? 'execution-unknown',
    events,
  });
  const processBoardRenderedBlock = renderAnalysisInteractionPart(
    processBoardPart,
    {
      surface: 'workspace',
    },
  );

  return (
    <article
      className={
        variant === 'side-sheet'
          ? 'flex h-full flex-col'
          : 'glass-panel p-6'
      }
      data-testid="analysis-execution-stream-panel"
    >
      <div
        className={
          variant === 'side-sheet'
            ? 'flex-1 space-y-4 overflow-y-auto px-6 pt-6 pb-6'
            : 'space-y-4'
        }
      >
        <AnalysisInteractionRenderedBlock
          key={processBoardPart.id}
          renderedBlock={processBoardRenderedBlock}
        />

        {events.map((event) => (
            <section
              className="rounded-3xl border border-[color:var(--line-200)] bg-white/80 p-5"
              key={event.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                    {event.stage?.label ?? (event.kind === 'stage-result' ? '阶段结果' : '执行事件')}
                  </p>
                  <h4 className="mt-2 text-base font-semibold text-[color:var(--ink-900)]">
                    {event.step?.title ?? event.message ?? '执行状态更新'}
                  </h4>
                  <p className="mt-1 text-xs text-[color:var(--ink-600)]">
                    {new Date(event.timestamp).toLocaleString('zh-CN', {
                      hour12: false,
                    })}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${getEventStatusClassName(event)}`}
                >
                  {getEventStatusLabel(event)}
                </span>
              </div>

              {event.renderBlocks.map((block, index) => {
                const part = normalizeExecutionRenderBlock(block, {
                  sourceType: 'execution-render-block',
                  sessionId: event.sessionId,
                  executionId: event.executionId,
                  eventId: event.id,
                  sequence: event.sequence,
                  blockIndex: index,
                });
                const renderedBlock = renderAnalysisInteractionPart(part, {
                  surface: 'workspace',
                });

                return (
                  <AnalysisInteractionRenderedBlock
                    className="mt-4"
                    key={part.id}
                    renderedBlock={renderedBlock}
                  />
                );
              })}
            </section>
        ))}
      </div>
    </article>
  );
}
