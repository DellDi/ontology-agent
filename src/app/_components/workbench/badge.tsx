import type { HTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/app/_lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold',
  {
    variants: {
      tone: {
        neutral:
          'border-border bg-card text-muted-foreground',
        info: 'border-[color:var(--brand-300)]/40 bg-[color:color-mix(in_srgb,var(--brand-500)_10%,transparent)] text-[color:var(--brand-700)]',
        success:
          'border-[color:var(--success-500)]/40 bg-[color:color-mix(in_srgb,var(--success-500)_12%,transparent)] text-[color:color-mix(in_srgb,var(--success-500)_70%,var(--ink-900))]',
        warning:
          'border-[color:var(--warning-500)]/40 bg-[color:color-mix(in_srgb,var(--warning-500)_14%,transparent)] text-[color:color-mix(in_srgb,var(--warning-500)_70%,var(--ink-900))]',
        error:
          'border-[color:var(--danger-500)]/40 bg-[color:color-mix(in_srgb,var(--danger-500)_10%,transparent)] text-[color:color-mix(in_srgb,var(--danger-500)_70%,var(--ink-900))]',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & {
    children: ReactNode;
  };

export function Badge({ tone, className, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {children}
    </span>
  );
}

export { badgeVariants };
