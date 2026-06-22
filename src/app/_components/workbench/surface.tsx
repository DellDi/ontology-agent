import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/app/_lib/cn';

type SurfaceVariant = 'panel' | 'subtle' | 'hero';

type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  variant?: SurfaceVariant;
  children: ReactNode;
};

const variantStyles: Record<SurfaceVariant, string> = {
  panel:
    'rounded-md border border-border bg-card shadow-[var(--shadow-panel)]',
  subtle: 'rounded-md border border-border/60 bg-card',
  hero: 'relative rounded-md border border-border bg-card shadow-[var(--shadow-panel)]',
};

/**
 * 通用表面容器（替代 .glass-panel / .hero-panel / .surface-card）。
 */
export function Surface({
  variant = 'panel',
  className,
  children,
  ...props
}: SurfaceProps) {
  return (
    <div className={cn(variantStyles[variant], className)} {...props}>
      {children}
    </div>
  );
}

type SurfaceHeaderProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function SurfaceHeader({
  eyebrow,
  title,
  description,
  action,
  className,
  children,
  ...props
}: SurfaceHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-6 pt-5 pb-4',
        className,
      )}
      {...props}
    >
      <div className="space-y-1.5">
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
            {eyebrow}
          </p>
        ) : null}
        {title ? (
          <h2 className="font-display text-xl leading-tight font-semibold text-foreground sm:text-2xl">
            {title}
          </h2>
        ) : null}
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type SurfaceBodyProps = HTMLAttributes<HTMLDivElement>;

export function SurfaceBody({ className, ...props }: SurfaceBodyProps) {
  return <div className={cn('px-6 pb-5', className)} {...props} />;
}

type SurfaceFooterProps = HTMLAttributes<HTMLDivElement>;

export function SurfaceFooter({ className, ...props }: SurfaceFooterProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-3 border-t border-border/70 px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}
