'use client';

import { WrenchIcon } from 'lucide-react';

import type { ToolActivitySummary } from '@/application/analysis-message-projection/conversation-view-model';
import { translateToolName } from '@/application/analysis-message-projection/tool-name-translations';
import {
  toToolPartState,
} from '@/application/analysis-message-projection/ai-elements-mapping';
import { ToolStatusBadge } from '@/components/ai-elements/tool';

/**
 * 当前执行中的工具活动（聚合紧凑视图）。
 * ToolActivitySummary 不含输入输出明细，渲染为非交互状态行；
 * 可展开明细见分析过程时间线中的 Tool 卡片。
 */
export function AnalysisToolActivityStrip({
  activities,
}: {
  activities: ToolActivitySummary[];
}) {
  if (activities.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5">
      {activities.map((activity) => {
        const displayName = translateToolName(activity.toolName);
        return (
          <div
            className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
            key={`${activity.toolName}::${activity.objective}`}
          >
            <WrenchIcon className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{displayName}</span>
            {activity.objective && activity.objective !== displayName ? (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {activity.objective}
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <ToolStatusBadge status={toToolPartState(activity.status)} />
          </div>
        );
      })}
    </div>
  );
}
