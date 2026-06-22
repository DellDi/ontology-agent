import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/app/_lib/cn';

export type MetricDeltaDirection = 'up' | 'down' | 'flat';

type MetricCardProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaDirection?: MetricDeltaDirection;
  /** delta 数值的"好坏"语义，决定颜色。默认 neutral。 */
  deltaIntent?: 'positive' | 'negative' | 'neutral';
  helper?: ReactNode;
  icon?: ReactNode;
};

const deltaArrow: Record<MetricDeltaDirection, string> = {
  up: '↑',
  down: '↓',
  flat: '·',
};

const intentStyles: Record<NonNullable<MetricCardProps['deltaIntent']>, string> = {
  positive: 'text-[color:var(--success-500)]',
  negative: 'text-[color:var(--danger-500)]',
  neutral: 'text-muted-foreground',
};

export function MetricCard({
  label,
  value,
  delta,
  deltaDirection,
  deltaIntent = 'neutral',
  helper,
  icon,
  className,
  ...props
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]',
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
        {icon ? (
          <div className="text-muted-foreground/70 [&_svg]:size-4">{icon}</div>
        ) : null}
      </div>
      <p className="mt-2 font-display text-2xl leading-tight font-semibold text-foreground">
        {value}
      </p>
      {delta || helper ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {delta ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 font-semibold',
                intentStyles[deltaIntent],
              )}
            >
              {deltaDirection ? deltaArrow[deltaDirection] : null}
              {delta}
            </span>
          ) : null}
          {helper ? (
            <span className="text-muted-foreground">{helper}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
