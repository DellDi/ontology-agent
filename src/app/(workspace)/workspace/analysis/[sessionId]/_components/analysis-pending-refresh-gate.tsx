'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

type AnalysisPendingRefreshGateProps = {
  enabled: boolean;
  intervalMs?: number;
  maxAttempts?: number;
};

export function AnalysisPendingRefreshGate({
  enabled,
  intervalMs = 2000,
  maxAttempts = 15,
}: AnalysisPendingRefreshGateProps) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let attempts = 0;
    const intervalId = window.setInterval(() => {
      attempts += 1;
      router.refresh();

      if (attempts >= maxAttempts) {
        window.clearInterval(intervalId);
      }
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, intervalMs, maxAttempts, router]);

  if (!enabled) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto mt-4 max-w-[860px] px-4"
    >
      <div className="flex items-center gap-2 rounded-xl border border-[color:var(--line-200)] bg-[color:var(--mist-50)] p-3 text-sm text-[color:var(--ink-600)]">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--brand-500)] border-t-transparent" />
        <span>正在加载分析结果…</span>
      </div>
    </div>
  );
}
