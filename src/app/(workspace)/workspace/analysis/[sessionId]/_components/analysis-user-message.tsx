'use client';

import { Message, MessageContent } from '@/components/ai-elements/message';

export function AnalysisUserMessage({
  questionText,
  pending = false,
}: {
  questionText: string;
  pending?: boolean;
}) {
  return (
    <Message className={pending ? 'opacity-70' : undefined} from="user">
      <MessageContent className="max-w-[85%] group-[.is-user]:rounded-2xl group-[.is-user]:rounded-tr-sm group-[.is-user]:border group-[.is-user]:border-border/70 group-[.is-user]:bg-sky-100/90 group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-foreground">
        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
          {questionText}
        </p>
      </MessageContent>
    </Message>
  );
}
