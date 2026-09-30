import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/app/_lib/cn';

type InlineErrorProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  /** 错误标题（短句） */
  title?: ReactNode;
  /** 错误详情；可以是 string 或 ReactNode */
  children: ReactNode;
  /** 调试用：错误来源、错误码等，将以小字附加显示 */
  source?: ReactNode;
};

export function InlineError({
  title,
  children,
  source,
  className,
  ...props
}: InlineErrorProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'rounded-md border border-[color:var(--danger-500)]/30 bg-[color:color-mix(in_srgb,var(--danger-500)_8%,transparent)] px-3 py-2 text-sm leading-6 text-foreground',
        className,
      )}
      {...props}
    >
      {title ? (
        <p className="font-semibold text-[color:var(--danger-500)]">{title}</p>
      ) : null}
      <div className="break-words">{children}</div>
      {source ? (
        <p className="mt-1 text-xs text-muted-foreground">来源：{source}</p>
      ) : null}
    </div>
  );
}
