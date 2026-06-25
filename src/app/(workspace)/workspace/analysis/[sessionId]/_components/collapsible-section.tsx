'use client';

import { useState, type ReactNode } from 'react';

export function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-4">
      <button
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span
          className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}
        >
          ›
        </span>
        {title}
      </button>
      {isOpen ? (
        <div className="mt-3 space-y-3 pl-4 border-l-2 border-border">
          {children}
        </div>
      ) : null}
    </div>
  );
}