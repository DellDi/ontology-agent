'use client';

import { Loader } from '@/components/ai-elements/loader';
import { AssistantAvatar } from './analysis-assistant-message';

/** 非 live 的 pending/running 轮次：仅展示"正在思考"占位气泡。 */
export function AnalysisThinkingMessage() {
  return (
    <div className="flex justify-start gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <div className="flex h-7 items-center gap-2">
          <p className="text-xs font-semibold text-foreground">智能员工</p>
        </div>
        <div className="mt-2 inline-flex items-center gap-2.5 rounded-xl border border-border/80 bg-sky-50/75 px-3.5 py-2.5 shadow-[var(--shadow-panel)]">
          <Loader aria-label="分析执行中" className="text-primary" size={15} />
          <span className="text-sm text-muted-foreground">正在思考…</span>
        </div>
      </div>
    </div>
  );
}
