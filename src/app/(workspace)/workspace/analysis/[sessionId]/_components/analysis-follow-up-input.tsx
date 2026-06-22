'use client';

import {
  useCallback,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

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
};

export function AnalysisFollowUpInput({
  sessionId,
  activeFollowUpId,
  drawerContent,
}: AnalysisFollowUpInputProps) {
  const { ref: textareaRef, resize } = useAutosizeTextarea({ maxHeight: 120 });
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

  return (
    <div data-testid="analysis-follow-up-input">
      <form
        action={`/api/analysis/sessions/${sessionId}/follow-ups`}
        className="flex items-end gap-3 rounded-lg border border-border bg-card p-3 transition-colors focus-within:border-primary"
        method="post"
        onSubmit={handleSubmit}
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
          placeholder="继续追问，例如：按月份展开看看（Shift+Enter 换行）"
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
