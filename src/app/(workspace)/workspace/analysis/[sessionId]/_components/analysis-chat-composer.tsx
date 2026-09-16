'use client';

import { useRef, useState } from 'react';

export function AnalysisChatComposer({
  disabled = false,
  sending = false,
  onSend,
}: {
  disabled?: boolean;
  sending?: boolean;
  onSend: (question: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = disabled || sending;

  const trySend = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    trySend();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      trySend();
    }
  };

  return (
    <div data-testid="analysis-chat-composer">
      <form onSubmit={handleSubmit}>
        <div className="flex items-end gap-2 rounded-2xl border border-input bg-card px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <textarea
            ref={textareaRef}
            aria-label="输入消息"
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-1 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
            disabled={busy}
            onChange={(event) => {
              setDraft(event.target.value);
              const el = textareaRef.current;
              if (el) {
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，继续对话…"
            rows={1}
            value={draft}
          />
          <button
            aria-label="发送消息"
            className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || !draft.trim()}
            type="submit"
          >
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
      </form>
    </div>
  );
}
