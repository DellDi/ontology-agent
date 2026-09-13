'use client';

export function AnalysisUserMessage({
  questionText,
  badges,
}: {
  questionText: string;
  badges: { label: string; tone: string }[];
}) {
  return (
    <div className="border-b border-border pb-6">
      <div className="min-w-0">
        <div>
          <h2 className="break-words text-xl font-semibold leading-8 tracking-tight text-foreground">
            {questionText}
          </h2>
        </div>
        {badges.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <span
                key={badge.label}
                className="py-0.5 text-xs text-muted-foreground"
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
