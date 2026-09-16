'use client';

import { useMemo, useState } from 'react';

import {
  normalizeExecutionRenderBlock,
  renderAnalysisInteractionPart,
  type AnalysisRenderedBlock,
} from '@/application/analysis-interaction';
import type { DetailDrawerType } from './analysis-detail-drawer';
import { AnalysisResultBlockRenderer } from './analysis-result-block-renderer';
import { AssistantAvatar } from './analysis-assistant-message';
import { PrimaryAnswerBlock } from './analysis-business-views';
import { WorkbenchSheet } from '@/app/_components/workbench/workbench-sheet';

import type { RoundConclusionState } from './analysis-conversation-shell';

const BUSINESS_DRAWER_LABELS: Record<string, string> = {
  attribution: '归因分析',
  actions: '动作建议',
};

export function AnalysisStaticAssistantMessage({
  status,
  conclusionState,
  onOpenDetail,
  availableDetails = [],
}: {
  status: 'completed' | 'failed' | 'running' | 'pending';
  conclusionState: RoundConclusionState | null;
  onOpenDetail: (drawer: DetailDrawerType) => void;
  availableDetails?: Exclude<DetailDrawerType, null>[];
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const blocks = useMemo<AnalysisRenderedBlock[]>(() => {
    const wireBlocks = conclusionState?.renderBlocks ?? [];
    const rendered: AnalysisRenderedBlock[] = [];
    for (const [index, block] of wireBlocks.entries()) {
      try {
        const part = normalizeExecutionRenderBlock(block, {
          sourceType: 'conclusion-read-model',
          blockIndex: index,
        });
        rendered.push(
          renderAnalysisInteractionPart(part, { surface: 'workspace' }),
        );
      } catch {
        // 单块失败不拖垮整条历史消息——块级渲染失败静默跳过，
        // 归因/明细仍可从结构化结论恢复。
      }
    }
    return rendered;
  }, [conclusionState]);

  const primaryBlocks = blocks.filter(
    (block) => block.payload?.role !== 'supporting',
  );
  const supportingBlocks = blocks.filter(
    (block) => block.payload?.role === 'supporting',
  );
  const primaryAnswer =
    conclusionState?.causes[0]?.summary ?? '';

  const businessDetails = availableDetails.filter(
    (detail) => detail === 'attribution' || detail === 'actions',
  );

  return (
    <div className="flex justify-start gap-2.5">
      <AssistantAvatar />
      <div className="min-w-0 w-full max-w-[86%]">
        <div className="flex items-center gap-2.5">
          <p className="text-xs font-semibold text-foreground">智能员工</p>
        </div>

        <div className="mt-1.5 rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 shadow-sm">
          {status === 'pending' || status === 'running' ? (
            <div className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              <span className="text-sm text-muted-foreground">
                正在思考…
              </span>
            </div>
          ) : status === 'failed' ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-sm font-medium text-rose-900">
                分析过程中遇到问题
              </p>
              <p className="mt-1 text-sm leading-6 text-rose-800">
                本轮分析未能完成，可以换个问法再试一次。
              </p>
            </div>
          ) : (
            <>
              {primaryAnswer ? (
                <PrimaryAnswerBlock answer={primaryAnswer} />
              ) : null}
              {primaryBlocks.map((block, index) => (
                <div
                  className="analysis-block-enter"
                  key={`static-${block.kind}-${index}`}
                  style={{ animationDelay: `${Math.min(index, 5) * 60}ms` }}
                >
                  <AnalysisResultBlockRenderer block={block} />
                </div>
              ))}
            </>
          )}

          {supportingBlocks.length > 0 || businessDetails.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
              {supportingBlocks.length > 0 ? (
                <button
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setDetailsOpen(true)}
                  type="button"
                >
                  数据明细与依据（{supportingBlocks.length}）
                </button>
              ) : null}
              {businessDetails.map((detail) => (
                <button
                  key={detail}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenDetail(detail)}
                  type="button"
                >
                  {BUSINESS_DRAWER_LABELS[detail]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {detailsOpen ? (
          <WorkbenchSheet
            open
            onClose={() => setDetailsOpen(false)}
            title="数据明细与依据"
            testId="analysis-supporting-drawer"
          >
            <div className="space-y-4">
              {supportingBlocks.map((block, index) => (
                <AnalysisResultBlockRenderer
                  key={`supporting-${block.kind}-${index}`}
                  block={block}
                />
              ))}
            </div>
          </WorkbenchSheet>
        ) : null}
      </div>
    </div>
  );
}
