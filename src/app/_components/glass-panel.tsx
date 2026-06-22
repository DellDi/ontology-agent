/**
 * @deprecated 请改用 `import { Surface } from '@/app/_components/workbench'`
 * 该文件仅在迁移过渡期保留，等所有调用点切换到 workbench 后将删除。
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/app/_lib/cn';

type GlassPanelProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function GlassPanel({ className, children, ...props }: GlassPanelProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-border bg-card shadow-[var(--shadow-panel)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
