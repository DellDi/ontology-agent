'use client';

import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';

type AnalysisExecutionStreamPanelProps = {
  events: AnalysisExecutionStreamEvent[];
  variant?: 'embedded' | 'side-sheet';
};

type StepProgressItem = {
  id: string;
  order: number;
  title: string;
  status: 'running' | 'completed' | 'failed';
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

function getBlockToneClassName(tone: 'neutral' | 'info' | 'success' | 'error') {
  switch (tone) {
    case 'success':
      return 'bg-emerald-50';
    case 'error':
      return 'bg-rose-50';
    case 'info':
      return 'bg-sky-50';
    default:
      return 'bg-[color:var(--sky-50)]/80';
  }
}

function parseProgressText(value: string) {
  const matched = value.match(/^(\d+)\s*\/\s*(\d+)$/);

  if (!matched) {
    return null;
  }

  const processed = Number(matched[1]);
  const total = Number(matched[2]);

  if (
    Number.isNaN(processed) ||
    Number.isNaN(total) ||
    processed < 0 ||
    total <= 0
  ) {
    return null;
  }

  return {
    processed,
    total,
  };
}

function readLatestProgress(events: AnalysisExecutionStreamEvent[]) {
  const reversedEvents = [...events].reverse();

  for (const event of reversedEvents) {
    for (const block of event.renderBlocks) {
      if (block.type !== 'kv-list') {
        continue;
      }

      const progressItem = block.items.find((item) => item.label === '进度');
      if (!progressItem) {
        continue;
      }

      const parsedProgress = parseProgressText(progressItem.value);
      if (parsedProgress) {
        return parsedProgress;
      }
    }
  }

  return null;
}

function buildStepProgress(events: AnalysisExecutionStreamEvent[]) {
  const stepById = new Map<string, StepProgressItem>();

  events.forEach((event) => {
    if (!event.step) {
      return;
    }

    const previous = stepById.get(event.step.id);
    const nextItem: StepProgressItem = {
      id: event.step.id,
      order: event.step.order,
      title: event.step.title,
      status: event.step.status,
    };

    if (!previous) {
      stepById.set(event.step.id, nextItem);
      return;
    }

    const previousPriority =
      previous.status === 'failed' ? 3 : previous.status === 'completed' ? 2 : 1;
    const nextPriority =
      nextItem.status === 'failed' ? 3 : nextItem.status === 'completed' ? 2 : 1;

    if (nextPriority >= previousPriority) {
      stepById.set(event.step.id, nextItem);
    }
  });

  return [...stepById.values()].sort((left, right) => left.order - right.order);
}

export function AnalysisExecutionStreamPanel({
  events,
  variant = 'embedded',
}: AnalysisExecutionStreamPanelProps) {
  const latestProgress = readLatestProgress(events);
  const stepProgress = buildStepProgress(events);
  const totalSteps = latestProgress?.total ?? stepProgress.length;
  const completedSteps = latestProgress?.processed
    ?? stepProgress.filter((item) => item.status === 'completed').length;
  const progressPercent =
    totalSteps > 0
      ? Math.min(100, Math.round((completedSteps / totalSteps) * 100))
      : 0;

  return (
    <article
      className={
        variant === 'side-sheet'
          ? 'flex h-full flex-col'
          : 'glass-panel p-6'
      }
      data-testid="analysis-execution-stream-panel"
    >
      <div className={variant === 'side-sheet' ? 'px-6 pt-6' : ''}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
              执行流程看板
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
              实时状态与过程摘要
            </h3>
          </div>
          <span className="rounded-full bg-[color:var(--sky-100)] px-4 py-2 text-sm font-medium text-[color:var(--brand-700)]">
            {events.length} 条事件
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <p
          className={
            variant === 'side-sheet'
              ? 'mt-4 px-6 pb-6 text-sm leading-7 text-[color:var(--ink-600)]'
              : 'mt-4 text-sm leading-7 text-[color:var(--ink-600)]'
          }
        >
          正在等待执行事件，请保持当前页面打开。
        </p>
      ) : (
        <div
          className={
            variant === 'side-sheet'
              ? 'mt-4 flex-1 space-y-4 overflow-y-auto px-6 pb-6'
              : 'mt-5 space-y-4'
          }
        >
          <section className="rounded-3xl border border-[color:var(--line-200)] bg-white/80 p-5">
            <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
              流程进度
            </p>
            <div className="mt-3">
              <div className="h-2 w-full rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-[color:var(--brand-500)] transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-[color:var(--ink-600)]">
                {totalSteps > 0
                  ? `已完成 ${completedSteps}/${totalSteps} 步`
                  : '正在初始化执行流程'}
              </p>
            </div>
            {stepProgress.length > 0 ? (
              <div className="mt-4 space-y-2">
                {stepProgress.map((item) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-2xl bg-[color:var(--sky-50)]/80 px-3 py-2"
                    key={item.id}
                  >
                    <p className="text-sm text-[color:var(--ink-900)]">
                      {item.order}. {item.title}
                    </p>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${item.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-700'
                        : item.status === 'failed'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-sky-100 text-[color:var(--brand-700)]'}`}
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
            ) : null}
          </section>

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
                if (block.type === 'status') {
                  return (
                    <div
                      className={`mt-4 rounded-2xl p-4 ${getBlockToneClassName(block.tone)}`}
                      key={`${event.id}-status-${index}`}
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
                      className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4"
                      key={`${event.id}-kv-${index}`}
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
                      className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4"
                      key={`${event.id}-tools-${index}`}
                    >
                      <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                        工具调用
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
                      className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4"
                      key={`${event.id}-table-${index}`}
                    >
                      <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                        {block.title}
                      </p>
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-sm text-[color:var(--ink-900)]">
                          <thead>
                            <tr className="border-b border-[color:var(--line-200)] text-[color:var(--ink-600)]">
                              {block.columns.map((column) => (
                                <th className="px-3 py-2 font-medium" key={column}>
                                  {column}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {block.rows.map((row, rowIndex) => (
                              <tr
                                className="border-b border-[color:var(--line-200)] last:border-b-0"
                                key={`${event.id}-row-${rowIndex}`}
                              >
                                {row.map((cell, cellIndex) => (
                                  <td
                                    className="px-3 py-2"
                                    key={`${event.id}-cell-${rowIndex}-${cellIndex}`}
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
                    className="mt-4 rounded-2xl bg-[color:var(--sky-50)]/80 p-4"
                    key={`${event.id}-markdown-${index}`}
                  >
                    <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
                      {block.title === '阶段说明' ? '推理摘要' : block.title}
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
