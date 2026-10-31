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
      <MessageContent className="group-[.is-user]:rounded-lg group-[.is-user]:bg-sky-100 group-[.is-user]:text-foreground">
        <p className="whitespace-pre-wrap break-words text-sm leading-6">
          {questionText}
        </p>
      </MessageContent>
    </Message>
  );
}
