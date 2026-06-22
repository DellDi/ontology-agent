'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';

import { cn } from '@/app/_lib/cn';

import { Button } from './button';

type WorkbenchSheetSide = 'right' | 'bottom';

export type WorkbenchSheetProps = {
  open: boolean;
  onClose: () => void;
  /** 抽屉标题（无障碍：作为 aria-label 与可见标题） */
  title: ReactNode;
  description?: ReactNode;
  /** 顶部右侧自定义操作槽（默认渲染"收起"按钮） */
  toolbar?: ReactNode;
  side?: WorkbenchSheetSide;
  /** 关闭后将焦点送回的元素，可选 */
  returnFocusTo?: HTMLElement | null;
  /** 测试钩子 */
  testId?: string;
  children: ReactNode;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 共享工作台抽屉：
 * - role="dialog" + aria-modal="true" + aria-labelledby
 * - Esc 关闭
 * - Tab/Shift+Tab 焦点循环（focus trap）
 * - 背景遮罩点击关闭
 * - 桌面：右侧抽屉；移动端：满屏（side="right" 时通过 max-w + inset 调整）
 * - 关闭时将焦点送回 returnFocusTo 或打开前的 activeElement
 */
export function WorkbenchSheet({
  open,
  onClose,
  title,
  description,
  toolbar,
  side = 'right',
  returnFocusTo,
  testId,
  children,
}: WorkbenchSheetProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const labelId = useId();
  const descId = useId();

  // 记录打开前的焦点元素，关闭时送回
  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = (document.activeElement as HTMLElement) ?? null;
    return () => {
      const target = returnFocusTo ?? previousActiveRef.current;
      // 微任务后再 focus，避免和 Sheet 卸载时的 reflow 冲突
      if (target && typeof target.focus === 'function') {
        queueMicrotask(() => target.focus());
      }
    };
  }, [open, returnFocusTo]);

  // 键盘交互：Esc 关闭 + Tab 焦点循环
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    // 进入抽屉时聚焦首个可聚焦元素
    const focusables = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      drawer.setAttribute('tabindex', '-1');
      drawer.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // 锁定 body 滚动
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const handleOverlayClick = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  const isSide = side === 'right';

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px]"
        onClick={handleOverlayClick}
        aria-hidden
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        data-testid={testId}
        className={cn(
          'fixed z-40 flex flex-col bg-card text-foreground shadow-[var(--shadow-soft)]',
          isSide
            ? 'inset-y-0 right-0 w-full max-w-full sm:max-w-[560px] sm:p-2'
            : 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg p-2',
        )}
      >
        <div
          className={cn(
            'flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background',
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
            <div className="space-y-1">
              <p
                id={labelId}
                className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]"
              >
                {title}
              </p>
              {description ? (
                <p
                  id={descId}
                  className="text-sm leading-6 text-muted-foreground"
                >
                  {description}
                </p>
              ) : null}
            </div>
            <div className="shrink-0">
              {toolbar ?? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                  type="button"
                >
                  收起
                </Button>
              )}
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-6">{children}</div>
        </div>
      </aside>
    </>
  );
}
