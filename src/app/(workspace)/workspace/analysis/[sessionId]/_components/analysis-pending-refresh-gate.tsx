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

  return null;
}
