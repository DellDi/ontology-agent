'use client';

import { useEffect, useRef, useState } from 'react';

type AnalysisAutoExecuteGateProps = {
  sessionId: string;
  followUpId?: string;
  enabled: boolean;
  submissionFailed?: boolean;
};

export function buildAnalysisAutoExecuteScopeKey(
  sessionId: string,
  followUpId?: string,
) {
  return `${sessionId}:${followUpId ?? 'root'}`;
}

export function resolveAnalysisAutoExecuteAttempt(input: {
  enabled: boolean;
  lastSubmittedScope: string | null;
  executionScopeKey: string;
}) {
  if (!input.enabled) {
    return 'skip-disabled' as const;
  }

  if (input.lastSubmittedScope === input.executionScopeKey) {
    return 'skip-memory-dedup' as const;
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
  submissionFailed = false,
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
    // enabled 来自服务端“尚未创建执行”；跨页面去重由服务端幂等键负责。
    // 浏览器持久化“已尝试”会在提交失败后把会话永远卡在准备态。
    if (submissionFailed) {
      lastSubmittedScopeRef.current = null;
      return;
    }
    const attemptDecision = resolveAnalysisAutoExecuteAttempt({
      enabled,
      lastSubmittedScope: lastSubmittedScopeRef.current,
      executionScopeKey,
    });

    if (attemptDecision === 'skip-disabled' || attemptDecision === 'skip-memory-dedup') {
      return;
    }

    const formElement = submitFormRef.current;
    if (!formElement) {
      return;
    }

    lastSubmittedScopeRef.current = executionScopeKey;
    submitAnalysisAutoExecuteForm(formElement);
  }, [enabled, executionScopeKey, submissionFailed]);

  // 首轮自动执行：进入页面即提交，不向用户暴露手动执行入口。
  if (!enabled && submissionStatus === null) {
    return null;
  }

  return (
    <form
      action={`/api/analysis/sessions/${sessionId}/execute`}
      data-testid="analysis-auto-execution-gate"
      method="post"
      onSubmit={markSubmitted}
      ref={submitFormRef}
      style={{ display: 'none' }}
    >
      {followUpId ? (
        <input name="followUpId" type="hidden" value={followUpId} />
      ) : null}
    </form>
  );
}
