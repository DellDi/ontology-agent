'use client';

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function CollapsibleSection({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-4">
      <button
        className="group inline-flex items-center gap-2 rounded-lg border border-border/80 bg-sky-50/75 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-sky-100/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        type="button"
      >
        <ChevronRight
          aria-hidden
          className={`size-3.5 text-muted-foreground transition-transform duration-150 ${isOpen ? 'rotate-90 text-foreground' : ''}`}
        />
        <span>{title}</span>
        {badge ? (
          <span className="rounded-full bg-card px-1.5 py-0.25 text-[11px] font-medium tabular-nums text-muted-foreground ring-1 ring-border/70">
            {badge}
          </span>
        ) : null}
      </button>
      {isOpen ? (
        <div className="mt-2.5 rounded-xl border border-border/75 bg-sky-50/50 px-4 py-3 space-y-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
