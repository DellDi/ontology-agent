import type { ReactNode } from 'react';
import { cn } from '@/app/_lib/cn';

type StatusTone = 'info' | 'success' | 'error';

type StatusBannerProps = {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
};

export function StatusBanner({ tone, children, className }: StatusBannerProps) {
  return (
    <div className={cn('status-banner', className)} data-tone={tone}>
      {children}
    </div>
  );
}