'use client';

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import {
  toChatStatus,
} from '@/application/analysis-message-projection/ai-elements-mapping';
import type { ConversationAssistantStatus } from '@/application/analysis-message-projection/conversation-view-model';

export function AnalysisChatComposer({
  disabled = false,
  sending = false,
  status,
  onSend,
  compact = false,
}: {
  compact?: boolean;
  disabled?: boolean;
  sending?: boolean;
  /** 当前执行态：映射到提交按钮的状态图标 */
  status?: ConversationAssistantStatus;
  onSend: (question: string) => void;
}) {
  const busy = disabled || sending;

  return (
    <div data-testid="analysis-chat-composer">
      <PromptInput
        className={`${compact ? '[&_[data-slot=input-group]]:flex-row [&_[data-slot=input-group]]:items-end ' : ''}[&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:ring-0`}
        onSubmit={(message) => {
          const text = message.text.trim();
          if (!text || busy) return;
          onSend(text);
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="输入消息"
            className={compact ? 'max-h-32 min-h-10 py-2 text-sm leading-6' : 'max-h-40 min-h-[52px] text-sm leading-6'}
            disabled={busy}
            placeholder="输入消息，继续对话…"
          />
        </PromptInputBody>
        <PromptInputFooter className={compact ? 'w-auto shrink-0 justify-end p-1' : 'justify-end'}>
          <PromptInputSubmit
            aria-label="发送消息"
            disabled={busy}
            status={toChatStatus({ status, sending })}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
