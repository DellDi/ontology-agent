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
  // P7 fix: 合并原先的双 form 结构为单 form，消除 double-submit 歧义与可访问性隐患。
  // 自动触发通过 ref.requestSubmit() 完成；手动触发仍由按钮的原生 submit 完成。
  const submitFormRef = useRef<HTMLFormElement | null>(null);
  const lastSubmittedScopeRef = useRef<string | null>(null);
  const executionScopeKey = `${sessionId}:${followUpId ?? 'root'}`;
  // P6 fix: 使用 sessionStorage 做 F5 级别的去重，防止刷新/返回时反复自动提交。
  // 服务端 shouldAutoExecute 已基于 executionError 做第一道拦截；本处是客户端双保险。
  // 用户可通过"立即手动执行"按钮显式重试，或关闭浏览器标签（session 级 key 会失效）。
  const autoAttemptStorageKey = `analysis-auto-execute-attempted:${executionScopeKey}`;

  useEffect(() => {
    if (!enabled || lastSubmittedScopeRef.current === executionScopeKey) {
      return;
    }

    // P6: 已在本浏览器 session 内提交过该 scope，跳过自动触发；用户仍可手动点击。
    try {
      if (window.sessionStorage.getItem(autoAttemptStorageKey) === '1') {
        lastSubmittedScopeRef.current = executionScopeKey;
        return;
      }
    } catch {
      // sessionStorage 不可用时退化为仅内存去重。
    }

    lastSubmittedScopeRef.current = executionScopeKey;
    try {
      window.sessionStorage.setItem(autoAttemptStorageKey, '1');
    } catch {
      // 存储失败忽略，不影响正常提交。
    }

    // P11 partial: 对缺失 requestSubmit 的旧浏览器（Safari < 16、老 iOS）降级到 form.submit()。
    const formElement = submitFormRef.current;
    if (!formElement) {
      return;
    }

    if (typeof formElement.requestSubmit === 'function') {
      formElement.requestSubmit();
    } else {
      formElement.submit();
    }
  }, [autoAttemptStorageKey, enabled, executionScopeKey]);

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
        className="mt-3"
        method="post"
        ref={submitFormRef}
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
