'use client';

import type { AnalysisConversationViewModel } from '@/application/analysis-message-projection/conversation-view-model';

export function CollapsedTurnSummary({
  viewModel,
}: {
  viewModel: AnalysisConversationViewModel;
}) {
  return (
    <div className="mt-2 rounded-lg border border-[color:var(--line-200)] bg-[color:var(--mist-0)] px-5 py-3">
      <p className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
        {viewModel.userMessage.questionText}
      </p>
      <p className="mt-1 text-sm text-[color:var(--ink-600)]">
        {viewModel.assistantMessage.primaryAnswer || viewModel.assistantMessage.headline}
      </p>
    </div>
  );
}