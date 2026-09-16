'use client';

export function AnalysisUserMessage({
  questionText,
  pending = false,
}: {
  questionText: string;
  pending?: boolean;
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] min-w-0">
        <div
          className={`rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground shadow-sm ${
            pending ? 'opacity-70' : ''
          }`}
        >
          <p className="whitespace-pre-wrap break-words text-sm leading-6">
            {questionText}
          </p>
        </div>
      </div>
    </div>
  );
}
