'use client';

/**
 * 共享 recharts 配置：颜色变量、容器、tooltip、empty/anomaly 视觉。
 *
 * 设计原则：
 *   - 颜色全部走 var(--brand-...) / var(--ink-...)，自动响应 dark 主题。
 *   - 不在此层做业务字段映射；上层每个 chart 块自己负责 payload 解析。
 *   - 提供统一的 ChartShell（标题 + EmptyState + 异常态）以降低各 chart 模板重复。
 */
import type { ReactNode } from 'react';

import { cn } from '@/app/_lib/cn';
import { EmptyState } from '@/app/_components/workbench/empty-state';

export const CHART_PALETTE = [
  'var(--primary)',
  'var(--success-500)',
  'var(--warning-500)',
  'var(--destructive)',
  'var(--ring)',
  'var(--muted-foreground)',
];

export const CHART_AXIS_TICK = {
  fill: 'var(--muted-foreground)',
  fontSize: 12,
};

export const CHART_GRID = {
  stroke: 'var(--border)',
  strokeDasharray: '4 4',
};

type ChartShellProps = {
  title?: ReactNode;
  description?: ReactNode;
  isEmpty?: boolean;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function ChartShell({
  title,
  description,
  isEmpty,
  emptyTitle = '暂无可视化数据',
  emptyDescription = '当前模型尚未输出有效数据点。',
  className,
  children,
}: ChartShellProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]',
        className,
      )}
    >
      {title || description ? (
        <header className="mb-3 space-y-1">
          {title ? (
            <p className="text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              {title}
            </p>
          ) : null}
          {description ? (
            <p className="text-sm leading-6 text-foreground/90">{description}</p>
          ) : null}
        </header>
      ) : null}
      {isEmpty ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="relative h-[260px] w-full">{children}</div>
      )}
    </div>
  );
}

/** 把任意值安全地转成 number，无法解析时返回 fallback。 */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** 收窄 unknown 数组，过滤非 object 元素。 */
export function asItemArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null,
  );
}

/** 截断长 label，避免破坏布局。 */
export function truncateLabel(label: string, maxLength = 14): string {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength - 1)}…`;
}
