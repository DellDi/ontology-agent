'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type AnalysisPendingRefreshGateProps = {
  enabled: boolean;
  intervalMs?: number;
  maxAttempts?: number;
};

export function AnalysisPendingRefreshGate({
  enabled,
  intervalMs = 2000,
  maxAttempts = 90,
}: AnalysisPendingRefreshGateProps) {
  const router = useRouter();
  const [exhausted, setExhausted] = useState(false);

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
        setExhausted(true);
      }
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, intervalMs, maxAttempts, router]);

  if (!enabled) {
    return null;
  }

  if (exhausted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-auto mt-4 max-w-[860px] px-4"
      >
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
          <span>分析仍在后台处理中</span>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-muted/80"
          >
            手动刷新
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto mt-4 max-w-[860px] px-4"
    >
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span>正在加载分析结果…</span>
      </div>
    </div>
  );
}
