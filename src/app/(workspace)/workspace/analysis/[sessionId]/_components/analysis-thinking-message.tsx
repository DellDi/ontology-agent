'use client';

import { AssistantAvatar } from './analysis-assistant-message';

/** 非 live 的 pending/running 轮次：仅展示"正在思考"占位气泡。 */
export function AnalysisThinkingMessage() {
  return (
    <div className="flex justify-start gap-2.5">
      <AssistantAvatar />
      <div className="min-w-0 w-full max-w-[86%]">
        <div className="flex items-center gap-2.5">
          <p className="text-xs font-semibold text-foreground">智能员工</p>
        </div>
        <div className="mt-1.5 inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 shadow-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          <span className="text-sm text-muted-foreground">正在思考…</span>
        </div>
      </div>
    </div>
  );
}
