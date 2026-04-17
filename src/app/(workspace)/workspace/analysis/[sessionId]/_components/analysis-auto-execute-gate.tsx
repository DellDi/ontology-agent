'use client';

import { useEffect, useRef } from 'react';

type AnalysisAutoExecuteGateProps = {
  sessionId: string;
  followUpId?: string;
  enabled: boolean;
};

export function AnalysisAutoExecuteGate({
  sessionId,
  followUpId,
  enabled,
}: AnalysisAutoExecuteGateProps) {
  const autoSubmitFormRef = useRef<HTMLFormElement | null>(null);
  const lastSubmittedScopeRef = useRef<string | null>(null);
  const executionScopeKey = `${sessionId}:${followUpId ?? 'root'}`;

  useEffect(() => {
    if (!enabled || lastSubmittedScopeRef.current === executionScopeKey) {
      return;
    }

    lastSubmittedScopeRef.current = executionScopeKey;
    autoSubmitFormRef.current?.requestSubmit();
  }, [enabled, executionScopeKey]);

  if (!enabled) {
    return null;
  }

  return (
    <article className="status-banner" data-testid="analysis-auto-execution-gate" data-tone="info">
      <p className="font-medium text-[color:var(--ink-900)]">
        系统正在自动发起执行，默认以不中断方式推进主链。
      </p>
      <p className="mt-2 text-sm text-[color:var(--ink-600)]">
        如果你希望立即手动触发，也可以点击下方按钮。
      </p>

      <form
        action={`/api/analysis/sessions/${sessionId}/execute`}
        className="sr-only"
        method="post"
        ref={autoSubmitFormRef}
      >
        {followUpId ? (
          <input name="followUpId" type="hidden" value={followUpId} />
        ) : null}
        <button type="submit">自动执行</button>
      </form>

      <form
        action={`/api/analysis/sessions/${sessionId}/execute`}
        className="mt-3"
        method="post"
      >
        {followUpId ? (
          <input name="followUpId" type="hidden" value={followUpId} />
        ) : null}
        <button className="secondary-button" type="submit">
          立即手动执行
        </button>
      </form>
    </article>
  );
}
