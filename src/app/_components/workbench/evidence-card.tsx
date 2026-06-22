import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/app/_lib/cn';

export type EvidenceItem = {
  label: ReactNode;
  summary: ReactNode;
  source?: ReactNode;
};

type EvidenceCardProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title?: ReactNode;
  summary?: ReactNode;
  items: EvidenceItem[];
  status?: ReactNode;
};

export function EvidenceCard({
  title,
  summary,
  items,
  status,
  className,
  ...props
}: EvidenceCardProps) {
  return (
    <section
      className={cn(
        'rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]',
        className,
      )}
      {...props}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          {title ? (
            <p className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground">
              {title}
            </p>
          ) : null}
          {summary ? (
            <p className="text-sm leading-7 text-foreground/90">{summary}</p>
          ) : null}
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </header>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-foreground">
          {items.map((item, index) => (
            <li
              key={`${typeof item.label === 'string' ? item.label : index}`}
              className="flex flex-col gap-0.5 rounded border border-border/60 bg-background px-3 py-2"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {item.label}
              </span>
              <span className="break-words text-sm text-foreground">
                {item.summary}
              </span>
              {item.source ? (
                <span className="text-xs text-muted-foreground/80">
                  来源：{item.source}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
