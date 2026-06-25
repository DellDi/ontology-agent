'use client';

import {
  buildProcessBoardPart,
  normalizeExecutionRenderBlock,
  renderAnalysisInteractionPart,
} from '@/application/analysis-interaction';
import { reduceEventsToStepCards } from '@/application/analysis-execution/execution-event-reducer';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';

import { AnalysisInteractionRenderedBlock } from './analysis-interaction-rendered-block';

type AnalysisExecutionStreamPanelProps = {
  events: AnalysisExecutionStreamEvent[];
  variant?: 'embedded' | 'side-sheet';
};

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

  // 取最后一条 execution-status 事件作为终态（事件按 sequence 升序排列）
  const lastExecStatusEvent = [...events]
    .reverse()
    .find((e) => e.kind === 'execution-status');
  const rawExecStatus = lastExecStatusEvent?.status;
  const executionStatus =
    rawExecStatus === 'completed'
      ? 'completed'
      : rawExecStatus === 'failed'
        ? 'failed'
        : undefined;

  return (
    <article
      className={
        variant === 'side-sheet'
          ? 'flex h-full flex-col'
          : 'rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)]'
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

        {reduceEventsToStepCards({ events, executionStatus }).map((card) => (
            <section
              className="rounded-lg border border-border bg-card p-5"
              key={card.stepId}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium tracking-[0.12em] text-primary">
                    {card.stageLabel}
                  </p>
                  <h4 className="mt-2 text-base font-semibold text-foreground">
                    {card.stepLabel}
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(card.startedAt).toLocaleString('zh-CN', {
                      hour12: false,
                    })}
                  </p>
                </div>
                <span
                  className={`rounded-md px-3 py-1 text-xs font-medium ${
                    card.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : card.status === 'failed'
                        ? 'bg-rose-500/10 text-rose-600'
                        : 'bg-primary/10 text-primary'
                  }`}
                >
                  {card.status === 'completed'
                    ? '已完成'
                    : card.status === 'failed'
                      ? '已失败'
                      : '执行中'}
                </span>
              </div>

              {(card.renderBlocks ?? []).map((block, index) => {
                const part = normalizeExecutionRenderBlock(block, {
                  sourceType: 'execution-render-block',
                  sessionId: events[0]?.sessionId ?? 'session-unknown',
                  executionId: events[0]?.executionId ?? 'execution-unknown',
                  eventId: `reduced-${card.stepId}`,
                  sequence: index,
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
