import type { HTMLAttributes } from 'react';

import { cn } from '@/app/_lib/cn';

type SpinnerProps = HTMLAttributes<HTMLSpanElement> & {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
};

const sizeMap: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'size-4 border-2',
  md: 'size-5 border-2',
  lg: 'size-6 border-[3px]',
};

export function Spinner({ size = 'md', label, className, ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label ?? '加载中'}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-r-transparent text-[color:var(--brand-500)]',
        sizeMap[size],
        className,
      )}
      {...props}
    />
  );
}

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-md bg-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)]',
        className,
      )}
      {...props}
    />
  );
}

type LoadingDotsProps = HTMLAttributes<HTMLSpanElement> & {
  label?: string;
};

export function LoadingDots({ label, className, ...props }: LoadingDotsProps) {
  return (
    <span
      role="status"
      aria-label={label ?? '加载中'}
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    >
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}
