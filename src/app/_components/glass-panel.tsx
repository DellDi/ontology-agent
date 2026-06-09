import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/app/_lib/cn';

type GlassPanelProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function GlassPanel({ className, children, ...props }: GlassPanelProps) {
  return (
    <div className={cn('glass-panel', className)} {...props}>
      {children}
    </div>
  );
}