'use client';

import {
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@/app/_components/workbench/button';
import { WorkbenchSheet } from '@/app/_components/workbench/workbench-sheet';

import { useAutosizeTextarea } from '../_hooks/use-autosize-textarea';

// ---------------------------------------------------------------------------
// 聊天式追问输入
// ---------------------------------------------------------------------------

type AnalysisFollowUpInputProps = {
  sessionId: string;
  activeFollowUpId?: string;
  drawerContent?: ReactNode;
  /** 由本轮分析结论生成的上下文追问建议；点击即填入并提交。 */
  suggestions?: string[];
};

export function AnalysisFollowUpInput({
  sessionId,
  activeFollowUpId,
  drawerContent,
  suggestions,
}: AnalysisFollowUpInputProps) {
  const { ref: textareaRef, resize } = useAutosizeTextarea({ maxHeight: 120 });
  const formRef = useRef<HTMLFormElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const isEmpty = draft.trim().length === 0;

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.currentTarget.value);
    resize();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isEmpty) {
        event.currentTarget.form?.requestSubmit();
      }
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (isEmpty) {
      event.preventDefault();
      return;
    }
  };

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const handleSuggestionClick = (question: string) => {
    flushSync(() => setDraft(question));
    formRef.current?.requestSubmit();
  };

  const visibleSuggestions = suggestions?.filter(
    (item) => item.trim().length > 0,
  );

  return (
    <div data-testid="analysis-follow-up-input">
      {visibleSuggestions && visibleSuggestions.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground/80">建议追问：</span>
          {visibleSuggestions.map((question) => (
            <button
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              key={question}
              onClick={() => handleSuggestionClick(question)}
              type="button"
            >
              {question}
            </button>
          ))}
        </div>
      ) : null}
      <form
        action={`/api/analysis/sessions/${sessionId}/follow-ups`}
        className="flex items-end gap-3 rounded-lg border border-border bg-card p-3 transition-colors focus-within:border-primary"
        method="post"
        onSubmit={handleSubmit}
        ref={formRef}
      >
        {activeFollowUpId ? (
          <input name="parentFollowUpId" type="hidden" value={activeFollowUpId} />
        ) : null}
        <textarea
          aria-label="继续追问"
          className="flex-1 resize-none border-0 bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"
          name="question"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={`继续追问${visibleSuggestions?.[0] ? `，例如：${visibleSuggestions[0]}` : ''}（Shift+Enter 换行）`}
          ref={textareaRef}
          rows={1}
          value={draft}
        />
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={isEmpty}
          aria-disabled={isEmpty}
          title={isEmpty ? '请先输入追问内容' : '提交追问'}
        >
          追问
        </Button>
      </form>

      {drawerContent ? (
        <div className="mt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDrawerOpen(true)}
            type="button"
            className="text-xs text-muted-foreground"
          >
            追问详情
          </Button>
        </div>
      ) : null}

      <WorkbenchSheet
        open={drawerOpen}
        onClose={handleCloseDrawer}
        title="追问详情"
        testId="analysis-follow-up-drawer"
      >
        {drawerContent}
      </WorkbenchSheet>
    </div>
  );
}
