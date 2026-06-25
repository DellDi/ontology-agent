'use client';

import type { AnalysisConversationViewModel } from '@/application/analysis-message-projection/conversation-view-model';

export function CollapsedTurnSummary({
  viewModel,
}: {
  viewModel: AnalysisConversationViewModel;
}) {
  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/50 px-5 py-3">
      <p className="text-xs font-medium tracking-[0.12em] text-primary">
        {viewModel.userMessage.questionText}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {viewModel.assistantMessage.primaryAnswer || viewModel.assistantMessage.headline}
      </p>
    </div>
  );
}