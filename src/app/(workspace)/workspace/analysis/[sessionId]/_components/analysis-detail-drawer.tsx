'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export type DetailDrawerType =
  | 'execution-log'
  | 'plan'
  | 'context'
  | 'history'
  | 'candidates'
  | 'diagnostics'
  | null;

const DRAWER_LABELS: Record<string, string> = {
  'execution-log': '详细信息',
  plan: '分析计划',
  context: '背景信息',
  history: '历史问答',
  candidates: '可能原因',
  diagnostics: '诊断信息',
};

export function AnalysisDetailDrawer({
  drawerType,
  content,
  onClose,
}: {
  drawerType: DetailDrawerType;
  content: ReactNode;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!drawerType) return;

    const drawer = drawerRef.current;
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawer) return;

      const focusable = drawer.querySelectorAll<HTMLElement>(focusableSelector);
      if (!focusable.length) return;

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

    if (drawer) {
      const firstFocusable = drawer.querySelector<HTMLElement>(focusableSelector);
      firstFocusable?.focus();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerType, onClose]);

  if (!drawerType) return null;

  return (
    <aside
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label={DRAWER_LABELS[drawerType] ?? '详情'}
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[560px] transform transition-transform duration-300 translate-x-0"
    >
      <div className="h-full p-2 sm:p-4">
        <div className="flex h-full flex-col overflow-hidden rounded-[24px] border border-[color:var(--line-200)] bg-[color:var(--mist-0)]/97 shadow-[0_26px_58px_rgba(25,38,61,0.22)] backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-[color:var(--line-200)] px-6 py-4">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
                {DRAWER_LABELS[drawerType] ?? '详情'}
              </p>
            </div>
            <button
              className="secondary-button"
              onClick={onClose}
              type="button"
            >
              收起
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {content}
          </div>
        </div>
      </div>
    </aside>
  );
}