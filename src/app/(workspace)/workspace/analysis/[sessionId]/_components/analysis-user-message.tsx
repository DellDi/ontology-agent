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
      <MessageContent className="group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground group-[.is-user]:shadow-sm">
        <p className="whitespace-pre-wrap break-words text-sm leading-6">
          {questionText}
        </p>
      </MessageContent>
    </Message>
  );
}
