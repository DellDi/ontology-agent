'use client';

import type { ReactNode } from 'react';

import { cn } from '@/app/_lib/cn';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';

type WorkbenchSheetSide = 'right' | 'bottom';

export type WorkbenchSheetProps = {
  open: boolean;
  onClose: () => void;
  /** 抽屉标题（无障碍：作为可见标题与 aria 标签来源） */
  title: ReactNode;
  description?: ReactNode;
  /** 顶部右侧自定义操作槽（默认渲染"收起"按钮） */
  toolbar?: ReactNode;
  side?: WorkbenchSheetSide;
  /** 测试钩子 */
  testId?: string;
  children: ReactNode;
};

/**
 * 共享工作台抽屉（基于 shadcn Sheet / Radix Dialog）：
 * - 焦点循环、Esc 关闭、遮罩点击、焦点归还由 Radix 托管
 * - 桌面：右侧抽屉；side="bottom" 时底部抽屉
 */
export function WorkbenchSheet({
  open,
  onClose,
  title,
  description,
  toolbar,
  side = 'right',
  testId,
  children,
}: WorkbenchSheetProps) {
  return (
    <Sheet onOpenChange={(next) => { if (!next) onClose(); }} open={open}>
      <SheetContent
        className={cn(
          'flex flex-col gap-0 p-0',
          side === 'right' && 'w-full sm:max-w-[560px]',
          side === 'bottom' && 'max-h-[85vh]',
        )}
        data-testid={testId}
        side={side}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="space-y-1">
            <SheetTitle className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
              {title}
            </SheetTitle>
            {description ? (
              <SheetDescription className="text-sm leading-6 text-muted-foreground">
                {description}
              </SheetDescription>
            ) : null}
          </div>
          <div className="shrink-0 pr-8">
            {toolbar ?? (
              <Button
                onClick={onClose}
                size="sm"
                type="button"
                variant="outline"
              >
                收起
              </Button>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
