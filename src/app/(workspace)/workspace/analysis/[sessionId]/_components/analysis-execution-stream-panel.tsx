'use client';

import { useEffect, useState } from 'react';

import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';

type AnalysisExecutionStreamPanelProps = {
  sessionId: string;
  executionId: string;
  initialReadModel: AnalysisExecutionStreamReadModel;
};

function mergeEvents(
  previousEvents: AnalysisExecutionStreamEvent[],
  nextEvent: AnalysisExecutionStreamEvent,
) {
  if (previousEvents.some((event) => event.id === nextEvent.id)) {
    return previousEvents;
  }

  return [...previousEvents, nextEvent].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

export function AnalysisExecutionStreamPanel({
  sessionId,
  executionId,
  initialReadModel,
}: AnalysisExecutionStreamPanelProps) {
  const [events, setEvents] = useState(initialReadModel.events);

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/analysis/sessions/${sessionId}/stream?executionId=${executionId}`,
    );

    eventSource.onmessage = (message) => {
      const nextEvent = JSON.parse(message.data) as AnalysisExecutionStreamEvent;
      setEvents((previousEvents) => mergeEvents(previousEvents, nextEvent));

      if (
        nextEvent.kind === 'execution-status' &&
        (nextEvent.status === 'completed' || nextEvent.status === 'failed')
      ) {
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [executionId, sessionId]);

  return (
    <article
      className="glass-panel p-6"
      data-testid="analysis-execution-stream-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
            执行进度
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
            流式分析画布
          </h3>
        </div>
        <span className="rounded-full bg-[color:var(--sky-100)] px-4 py-2 text-sm font-medium text-[color:var(--brand-700)]">
          {events.length} 条事件
        </span>
      </div>

      {events.length === 0 ? (
        <p className="mt-4 text-sm leading-7 text-[color:var(--ink-600)]">
          正在等待执行事件，请保持当前页面打开。
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {events.map((event) => (
            <section
              key={event.id}
              className="rounded-3xl border border-[color:var(--line-200)] bg-white/76 p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                    {event.kind === 'stage-result' ? '阶段结果' : '执行事件'}
                  </p>
                  <h4 className="mt-2 text-lg font-semibold text-[color:var(--ink-900)]">
                    {event.step?.title ?? event.message ?? '执行状态更新'}
                  </h4>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  {event.status === 'completed'
                    ? '已完成'
                    : event.status === 'failed'
                      ? '已失败'
                      : event.status === 'processing'
                        ? '执行中'
                        : event.step?.status === 'completed'
                          ? '已完成'
                          : event.step?.status === 'failed'
                            ? '已失败'
                            : '执行中'}
                </span>
              </div>

              {event.renderBlocks.map((block, index) => {
                if (block.type === 'status') {
                  return (
                    <div
                      key={`${event.id}-status-${index}`}
                      className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4"
                    >
                      <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                        {block.title}
                      </p>
                      <p className="mt-2 text-sm font-medium text-[color:var(--ink-900)]">
                        {block.value}
                      </p>
                    </div>
                  );
                }

                if (block.type === 'kv-list') {
                  return (
                    <div
                      key={`${event.id}-kv-${index}`}
                      className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4"
                    >
                      <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                        {block.title}
                      </p>
                      <dl className="mt-3 grid gap-2 md:grid-cols-2">
                        {block.items.map((item) => (
                          <div key={`${event.id}-${item.label}`}>
                            <dt className="text-xs text-[color:var(--ink-600)]">
                              {item.label}
                            </dt>
                            <dd className="mt-1 text-sm text-[color:var(--ink-900)]">
                              {item.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  );
                }

                if (block.type === 'tool-list') {
                  return (
                    <div
                      key={`${event.id}-tools-${index}`}
                      className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4"
                    >
                      <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                        {block.title}
                      </p>
                      <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
                        {block.items.map((item) => (
                          <li key={`${event.id}-${item.toolName}-${item.objective}`}>
                            {item.toolName} · {item.objective} ·{' '}
                            {item.status === 'completed'
                              ? '已完成'
                              : item.status === 'failed'
                                ? '已失败'
                                : item.status === 'running'
                                  ? '执行中'
                                  : '已选择'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                }

                if (block.type === 'table') {
                  return (
                    <div
                      key={`${event.id}-table-${index}`}
                      className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4"
                    >
                      <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                        {block.title}
                      </p>
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-sm text-[color:var(--ink-900)]">
                          <thead>
                            <tr className="border-b border-[color:var(--line-200)] text-[color:var(--ink-600)]">
                              {block.columns.map((column) => (
                                <th key={column} className="px-3 py-2 font-medium">
                                  {column}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {block.rows.map((row, rowIndex) => (
                              <tr
                                key={`${event.id}-row-${rowIndex}`}
                                className="border-b border-[color:var(--line-200)] last:border-b-0"
                              >
                                {row.map((cell, cellIndex) => (
                                  <td
                                    key={`${event.id}-cell-${rowIndex}-${cellIndex}`}
                                    className="px-3 py-2"
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={`${event.id}-markdown-${index}`}
                    className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4"
                  >
                    <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                      {block.title}
                    </p>
                    <p className="mt-2 text-sm leading-7 text-[color:var(--ink-600)]">
                      {block.content}
                    </p>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
