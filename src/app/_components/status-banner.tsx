import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/app/_lib/cn';

export type StatusBannerTone = 'info' | 'success' | 'warning' | 'error';

type StatusBannerProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  tone: StatusBannerTone;
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
};

const toneStyles: Record<StatusBannerTone, string> = {
  info: 'border-[color:var(--brand-300)]/40 bg-[color:color-mix(in_srgb,var(--brand-500)_10%,transparent)] text-foreground',
  success:
    'border-[color:var(--success-500)]/40 bg-[color:color-mix(in_srgb,var(--success-500)_12%,transparent)] text-foreground',
  warning:
    'border-[color:var(--warning-500)]/40 bg-[color:color-mix(in_srgb,var(--warning-500)_14%,transparent)] text-foreground',
  error:
    'border-[color:var(--danger-500)]/40 bg-[color:color-mix(in_srgb,var(--danger-500)_10%,transparent)] text-foreground',
};

const toneRole: Record<StatusBannerTone, 'status' | 'alert'> = {
  info: 'status',
  success: 'status',
  warning: 'alert',
  error: 'alert',
};

export function StatusBanner({
  tone,
  title,
  action,
  children,
  className,
  ...props
}: StatusBannerProps) {
  return (
    <div
      role={toneRole[tone]}
      aria-live={tone === 'error' || tone === 'warning' ? 'assertive' : 'polite'}
      data-tone={tone}
      className={cn(
        'flex items-start gap-3 rounded-md border px-4 py-3 text-sm leading-6',
        toneStyles[tone],
        className,
      )}
      {...props}
    >
      <div className="flex-1 space-y-1">
        {title ? (
          <p className="font-semibold text-foreground">{title}</p>
        ) : null}
        <div>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
