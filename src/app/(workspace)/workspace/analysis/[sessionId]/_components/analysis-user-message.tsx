'use client';

export function AnalysisUserMessage({
  questionText,
  badges,
}: {
  questionText: string;
  badges: { label: string; tone: string }[];
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        <div className="rounded-lg rounded-tr-sm bg-primary px-5 py-3.5">
          <p className="text-base leading-7 text-primary-foreground">
            {questionText}
          </p>
        </div>
        {badges.length > 0 ? (
          <div className="mt-2 flex flex-wrap justify-end gap-1.5">
            {badges.map((badge) => (
              <span
                key={badge.label}
                className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
