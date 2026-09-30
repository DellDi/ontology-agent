'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { cn } from '@/app/_lib/cn';
import { Button } from '@/components/ui/button';

export type AnalysisSidePanelProps = {
  /** 面板标题（作为 aria-label 与可见标题） */
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** 更宽的表单型面板（结构化理解编辑器等） */
  wide?: boolean;
  testId?: string;
  children: ReactNode;
};

/**
 * 会话页内联右侧栏（非模态）：与消息流同排挤压收缩，
 * 滚动条落在视口最右侧。桌面 md+ 占位内联，移动端退化为覆盖式面板。
 */
export function AnalysisSidePanel({
  title,
  description,
  onClose,
  wide = false,
  testId,
  children,
}: AnalysisSidePanelProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn(
        'absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-border bg-background',
        'md:static md:shrink-0',
        wide ? 'md:w-[460px] lg:w-[520px]' : 'md:w-[360px] lg:w-[400px]',
      )}
      data-testid={testId}
      role="complementary"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="min-w-0 space-y-0.5">
          <h2 className="truncate text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
            {title}
          </h2>
          {description ? (
            <p className="text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <Button
          aria-label={`关闭${title}`}
          className="shrink-0"
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X aria-hidden className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  );
}
