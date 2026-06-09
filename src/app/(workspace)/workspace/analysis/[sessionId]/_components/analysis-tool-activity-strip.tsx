'use client';

import type { ToolActivitySummary } from '@/application/analysis-message-projection/conversation-view-model';
import { translateToolName } from '@/application/analysis-message-projection/tool-name-translations';

function getToolActivityStatusDotClass(status: ToolActivitySummary['status']) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-400';
    case 'failed':
      return 'bg-rose-400';
    case 'running':
      return 'bg-[color:var(--brand-500)] animate-pulse';
    default:
      return 'bg-[color:var(--ink-600)]/40';
  }
}

function getToolActivityStatusLabel(status: ToolActivitySummary['status']) {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '已失败';
    case 'running':
      return '执行中';
    default:
      return '已选择';
  }
}

export function AnalysisToolActivityStrip({
  activities,
}: {
  activities: ToolActivitySummary[];
}) {
  if (activities.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {activities.map((activity) => (
        <span
          key={`${activity.toolName}::${activity.objective}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs text-[color:var(--ink-600)]"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${getToolActivityStatusDotClass(activity.status)}`}
          />
          <span className="font-medium text-[color:var(--ink-900)]">
            {translateToolName(activity.toolName)}
          </span>
          <span className="text-[color:var(--ink-600)]/70">·</span>
          <span>{getToolActivityStatusLabel(activity.status)}</span>
        </span>
      ))}
    </div>
  );
}