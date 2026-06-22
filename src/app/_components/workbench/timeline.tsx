import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/app/_lib/cn';

export type TimelineStatus = 'pending' | 'running' | 'completed' | 'failed';

export type TimelineItem = {
  id: string;
  title: ReactNode;
  status: TimelineStatus;
  summary?: ReactNode;
  timestamp?: ReactNode;
};

type TimelineProps = HTMLAttributes<HTMLOListElement> & {
  items: TimelineItem[];
};

const statusDotStyles: Record<TimelineStatus, string> = {
  pending: 'border-border bg-card',
  running:
    'border-[color:var(--brand-500)] bg-card shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-500)_25%,transparent)]',
  completed:
    'border-[color:var(--brand-500)] bg-[color:var(--brand-500)]',
  failed:
    'border-[color:var(--danger-500)] bg-[color:var(--danger-500)]',
};

const statusLabel: Record<TimelineStatus, string> = {
  pending: '待开始',
  running: '进行中',
  completed: '已完成',
  failed: '已失败',
};

export function Timeline({ items, className, ...props }: TimelineProps) {
  return (
    <ol className={cn('relative space-y-4', className)} {...props}>
      <span
        aria-hidden
        className="absolute top-1.5 bottom-1.5 left-[7px] w-px bg-border"
      />
      {items.map((item) => (
        <li key={item.id} className="relative pl-7">
          <span
            className={cn(
              'absolute top-1 left-0 inline-flex size-3.5 items-center justify-center rounded-full border-2',
              statusDotStyles[item.status],
            )}
            aria-label={statusLabel[item.status]}
          />
          <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-semibold text-foreground">
                {item.title}
              </p>
              {item.timestamp ? (
                <p className="text-xs text-muted-foreground">{item.timestamp}</p>
              ) : null}
            </div>
            {item.summary ? (
              <p className="text-sm leading-6 break-words text-muted-foreground">
                {item.summary}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
