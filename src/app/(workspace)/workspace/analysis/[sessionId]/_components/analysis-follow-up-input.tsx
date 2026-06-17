'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// 追问详情抽屉
// ---------------------------------------------------------------------------

function AnalysisFollowUpDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/10"
        onClick={onClose}
      />
      <aside
        className="fixed inset-y-0 right-0 z-40 w-full max-w-[560px]"
        data-testid="analysis-follow-up-drawer"
      >
        <div className="h-full p-2 sm:p-4">
          <div className="flex h-full flex-col overflow-hidden rounded-lg border border-[color:var(--line-200)] bg-[color:var(--mist-0)] shadow-[var(--shadow-soft)] ">
            <div className="flex items-center justify-between border-b border-[color:var(--line-200)] px-6 py-4">
              <p className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
                追问详情
              </p>
              <button
                className="secondary-button"
                onClick={onClose}
                type="button"
              >
                收起
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {children}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// 聊天式追问输入
// ---------------------------------------------------------------------------

type AnalysisFollowUpInputProps = {
  sessionId: string;
  activeFollowUpId?: string;
  drawerContent?: ReactNode;
};

export function AnalysisFollowUpInput({
  sessionId,
  activeFollowUpId,
  drawerContent,
}: AnalysisFollowUpInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [autoResize]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const textarea = textareaRef.current;
    if (textarea && !textarea.value.trim()) {
      event.preventDefault();
      return;
    }
  };

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  return (
    <div data-testid="analysis-follow-up-input">
      <form
        action={`/api/analysis/sessions/${sessionId}/follow-ups`}
        className="flex items-end gap-3 rounded-lg border border-[color:var(--line-200)] bg-white p-3"
        method="post"
        onSubmit={handleSubmit}
      >
        {activeFollowUpId ? (
          <input name="parentFollowUpId" type="hidden" value={activeFollowUpId} />
        ) : null}
        <textarea
          className="flex-1 resize-none border-0 bg-transparent text-sm text-[color:var(--ink-900)] outline-none placeholder:text-[color:var(--ink-600)]/50"
          name="question"
          onChange={autoResize}
          onKeyDown={handleKeyDown}
          placeholder="继续追问，例如：按月份展开看看"
          ref={textareaRef}
          rows={1}
        />
        <button
          className="rounded-lg bg-[color:var(--brand-700)] px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          追问
        </button>
      </form>

      {drawerContent ? (
        <div className="mt-2 flex justify-end">
          <button
            className="text-xs text-[color:var(--ink-600)] transition-colors hover:text-[color:var(--brand-700)]"
            onClick={() => setDrawerOpen(true)}
            type="button"
          >
            追问详情
          </button>
        </div>
      ) : null}

      <AnalysisFollowUpDrawer
        onClose={handleCloseDrawer}
        open={drawerOpen}
      >
        {drawerContent}
      </AnalysisFollowUpDrawer>
    </div>
  );
}
