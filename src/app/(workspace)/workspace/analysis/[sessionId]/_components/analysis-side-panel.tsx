'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';

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
 * 滚动条落在视口最右侧。桌面 xl+ 占位内联，移动端退化为覆盖式面板。
 */
export function AnalysisSidePanel({
  title,
  description,
  onClose,
  wide = false,
  testId,
  children,
}: AnalysisSidePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  function resize(requestedWidth: number) {
    const available = panelRef.current?.offsetParent?.getBoundingClientRect().width ?? window.innerWidth;
    setExpanded(false);
    setWidth(Math.round(Math.min(available * 0.65, Math.max(400, requestedWidth))));
  }

  useEffect(() => {
    const panel = panelRef.current;
    if (window.matchMedia('(max-width: 1279px)').matches && panel?.getClientRects().length) {
      closeRef.current?.focus({ preventScroll: true });
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !panel?.getClientRects().length) return;
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !window.matchMedia('(max-width: 1279px)').matches) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex="0"]'))
        .filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (first && last && (!panel.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last))) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside
      ref={panelRef}
      aria-label={typeof title === 'string' ? title : undefined}
      className="absolute inset-y-0 right-0 z-20 flex w-full min-w-0 flex-col border-l border-border bg-sky-50 xl:relative xl:w-[var(--analysis-panel-width)] xl:max-w-[65%] xl:shrink-0"
      style={{ '--analysis-panel-width': expanded ? '65%' : width === null
        ? (wide ? 'clamp(500px, 36vw, 700px)' : 'clamp(440px, 32vw, 620px)') : `${width}px` } as CSSProperties}
      data-testid={testId}
      role="complementary"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        tabIndex={0}
        className="absolute inset-y-0 -left-1 z-10 hidden w-2 touch-none cursor-col-resize hover:bg-primary/25 focus-visible:bg-primary/40 xl:block"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const panel = panelRef.current;
          if (panel && event.currentTarget.hasPointerCapture(event.pointerId)) {
            resize(panel.getBoundingClientRect().right - event.clientX);
          }
        }}
        onKeyDown={(event) => {
          const panel = panelRef.current;
          if (!panel || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
          event.preventDefault();
          resize(panel.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 40 : -40));
        }}
      />
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 space-y-0.5">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label={expanded ? '还原侧栏宽度' : '展开侧栏宽度'}
            className="hidden xl:inline-flex"
            onClick={() => setExpanded(!expanded)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {expanded ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
          </Button>
          <Button
            ref={closeRef}
            aria-label={`收起${title}`}
            onClick={onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  );
}
