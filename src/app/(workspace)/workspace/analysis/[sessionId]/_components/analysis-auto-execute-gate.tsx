'use client';

import { useEffect, useRef, useState } from 'react';

type AnalysisAutoExecuteGateProps = {
  sessionId: string;
  followUpId?: string;
  enabled: boolean;
};

export function buildAnalysisAutoExecuteScopeKey(
  sessionId: string,
  followUpId?: string,
) {
  return `${sessionId}:${followUpId ?? 'root'}`;
}

export function buildAnalysisAutoExecuteAttemptStorageKey(
  executionScopeKey: string,
) {
  return `analysis-auto-execute-attempted:${executionScopeKey}`;
}

export function resolveAnalysisAutoExecuteAttempt(input: {
  enabled: boolean;
  lastSubmittedScope: string | null;
  executionScopeKey: string;
  sessionAttemptedValue: string | null;
}) {
  if (!input.enabled) {
    return 'skip-disabled' as const;
  }

  if (input.lastSubmittedScope === input.executionScopeKey) {
    return 'skip-memory-dedup' as const;
  }

  if (input.sessionAttemptedValue === '1') {
    return 'skip-session-dedup' as const;
  }

  return 'submit' as const;
}

export function submitAnalysisAutoExecuteForm(formElement: {
  requestSubmit?: () => void;
  submit: () => void;
}) {
  if (typeof formElement.requestSubmit === 'function') {
    formElement.requestSubmit();
    return;
  }

  formElement.submit();
}

export function AnalysisAutoExecuteGate({
  sessionId,
  followUpId,
  enabled,
}: AnalysisAutoExecuteGateProps) {
  const submitFormRef = useRef<HTMLFormElement | null>(null);
  const lastSubmittedScopeRef = useRef<string | null>(null);
  // 仅在事件处理器和 effect 回调中访问 ref，不在渲染期间读取。
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // submissionStatus 仅在表单提交（事件处理器）时设置为 'submitted'，
  // 3 秒后由 setTimeout 回调重置为 null。preparing 状态由 enabled 派生。
  const [submissionStatus, setSubmissionStatus] = useState<'submitted' | null>(
    null,
  );
  const executionScopeKey = buildAnalysisAutoExecuteScopeKey(
    sessionId,
    followUpId,
  );
  const autoAttemptStorageKey =
    buildAnalysisAutoExecuteAttemptStorageKey(executionScopeKey);

  const markSubmitted = () => {
    if (submitTimerRef.current !== null) {
      clearTimeout(submitTimerRef.current);
    }
    setSubmissionStatus('submitted');
    submitTimerRef.current = setTimeout(() => {
      submitTimerRef.current = null;
      setSubmissionStatus(null);
    }, 3000);
  };

  // 组件卸载时清理定时器。
  useEffect(() => () => {
    if (submitTimerRef.current !== null) {
      clearTimeout(submitTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let sessionAttemptedValue: string | null = null;
    try {
      sessionAttemptedValue = window.sessionStorage.getItem(autoAttemptStorageKey);
    } catch {
      // sessionStorage 不可用时退化为仅内存去重。
    }

    const attemptDecision = resolveAnalysisAutoExecuteAttempt({
      enabled,
      lastSubmittedScope: lastSubmittedScopeRef.current,
      executionScopeKey,
      sessionAttemptedValue,
    });

    if (attemptDecision === 'skip-disabled' || attemptDecision === 'skip-memory-dedup') {
      return;
    }

    if (attemptDecision === 'skip-session-dedup') {
      lastSubmittedScopeRef.current = executionScopeKey;
      return;
    }

    lastSubmittedScopeRef.current = executionScopeKey;
    try {
      window.sessionStorage.setItem(autoAttemptStorageKey, '1');
    } catch {
      // 存储失败忽略，不影响正常提交。
    }

    const formElement = submitFormRef.current;
    if (!formElement) {
      return;
    }

    submitAnalysisAutoExecuteForm(formElement);
  }, [autoAttemptStorageKey, enabled, executionScopeKey]);

  // 显示逻辑：
  // - enabled=true → 显示"正在准备分析…"（preparing 由 enabled 派生）
  // - submissionStatus='submitted' → 显示"已开始分析"（3 秒后自动隐藏）
  // - enabled=false 且未处于 submitted 过渡期 → 不渲染
  if (!enabled && submissionStatus === null) {
    return null;
  }

  const isPreparing = enabled && submissionStatus !== 'submitted';
  const statusText = isPreparing ? '正在准备分析…' : '已开始分析';

  return (
    <>
      <form
        action={`/api/analysis/sessions/${sessionId}/execute`}
        method="post"
        ref={submitFormRef}
        onSubmit={markSubmitted}
        style={{ display: 'none' }}
      >
        {followUpId ? (
          <input name="followUpId" type="hidden" value={followUpId} />
        ) : null}
      </form>

      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        data-testid="analysis-auto-execution-gate"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        <span>{statusText}</span>
        {isPreparing ? (
          <button
            className="text-primary underline"
            onClick={() => submitFormRef.current?.requestSubmit()}
            type="button"
          >
            手动执行
          </button>
        ) : null}
      </div>
    </>
  );
}
