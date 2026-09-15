'use client';

import { useEffect, useState } from 'react';

import type {
  AnalysisConversationViewModel,
  ConversationAssistantStatus,
  MetricCard,
  ToolActivitySummary,
  Visualization,
} from '@/application/analysis-message-projection/conversation-view-model';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import { getDefaultAnalysisInteractionUiRendererRegistry } from './analysis-interaction-ui-renderer-registry';
import { AnalysisStepTimeline } from './analysis-step-timeline';
import { AnalysisToolActivityStrip } from './analysis-tool-activity-strip';
import { AnalysisResultBlockRenderer } from './analysis-result-block-renderer';
import { CollapsibleSection } from './collapsible-section';
import { getStatusIcon } from './analysis-status-icon';
import { MetricCardsGrid, VisualizationBlock, PrimaryAnswerBlock } from './analysis-business-views';
import { WorkbenchSheet } from '@/app/_components/workbench/workbench-sheet';
import type { DetailDrawerType } from './analysis-detail-drawer';

function isBlockAlreadyVisualized(
  block: AnalysisRenderedBlock,
  metricCards: MetricCard[],
  visualizations: Visualization[],
): boolean {
  if (block.kind === 'kv-list' && metricCards.length > 0) return true;
  if (
    block.kind === 'chart' &&
    block.payload?.chartType === 'metric' &&
    metricCards.length > 0
  ) {
    return true;
  }
  if (
    (block.kind === 'chart' ||
      block.kind === 'graph' ||
      block.kind === 'table') &&
    visualizations.length > 0
  ) {
    const titleMatch = visualizations.some(
      (viz) => viz.title === block.title,
    );
    if (titleMatch) return true;
  }
  return false;
}

function ElapsedTicker({ sinceIso }: { sinceIso: string }) {
  const startedAt = Date.parse(sinceIso);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!Number.isFinite(startedAt)) return null;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const text =
    seconds >= 60
      ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
      : `${seconds} 秒`;
  return (
    <span className="text-xs tabular-nums text-muted-foreground/70">
      已用 {text}
    </span>
  );
}

export function AnalysisAssistantMessage({
  status,
  headline,
  errorSummary,
  progressLabel,
  runningSinceIso,
  toolActivities,
  result,
  diagnostics,
  primaryAnswer,
  metricCards,
  visualizations,
  toolTimeline,
  onOpenDetail,
  availableDetails = [],
}: {
  status: ConversationAssistantStatus;
  headline: string;
  errorSummary?: string;
  progressLabel?: string;
  runningSinceIso?: string;
  toolActivities: ToolActivitySummary[];
  result: AnalysisConversationViewModel['assistantMessage']['result'];
  diagnostics: AnalysisConversationViewModel['assistantMessage']['diagnostics'];
  primaryAnswer: string;
  metricCards: MetricCard[];
  visualizations: Visualization[];
  toolTimeline: AnalysisConversationViewModel['assistantMessage']['toolTimeline'];
  onOpenDetail: (drawer: DetailDrawerType) => void;
  availableDetails?: Exclude<DetailDrawerType, null>[];
}) {
  const hasDiagnostics =
    diagnostics.timelineBlocks.length > 0 ||
    diagnostics.processBoardBlocks.length > 0 ||
    diagnostics.renderErrors.length > 0 ||
    diagnostics.otherBlocks.length > 0;

  const [detailsOpen, setDetailsOpen] = useState(false);

  const registry = getDefaultAnalysisInteractionUiRendererRegistry();

  const visibleBlocks = (result?.blocks ?? []).filter(
    (block) => !isBlockAlreadyVisualized(block, metricCards, visualizations),
  );
  const primaryBlocks = visibleBlocks.filter(
    (block) => block.payload?.role !== 'supporting',
  );
  const supportingBlocks = visibleBlocks.filter(
    (block) => block.payload?.role === 'supporting',
  );
  const detailItemCount =
    supportingBlocks.length +
    (result?.evidenceBlocks.length ?? 0) +
    (result?.reasoningBlocks.length ?? 0) +
    (result?.assumptionBlocks.length ?? 0);

  return (
    <div className="flex justify-start">
      <div className="min-w-0 w-full">
        {/* 状态行 */}
        <div className="flex items-center gap-2.5">
          {getStatusIcon(status)}
          <p className="text-sm font-medium text-foreground">
            {headline}
          </p>
          {progressLabel ? (
            <span className="text-xs text-muted-foreground">
              {progressLabel}
            </span>
          ) : null}
          {status === 'running' && runningSinceIso ? (
            <ElapsedTicker sinceIso={runningSinceIso} />
          ) : null}
        </div>

        {/* 一句话业务答案 */}
        {status === 'completed' || primaryAnswer ? (
          <PrimaryAnswerBlock answer={primaryAnswer} />
        ) : null}

        {/* 指标卡网格 */}
        <MetricCardsGrid cards={metricCards} />

        {/* 可视化（图表 / 关系图 / 表格） */}
        {visualizations.map((viz, index) => (
          <VisualizationBlock
            key={`${viz.type}-${viz.title}-${index}`}
            visualization={viz}
            registry={registry}
          />
        ))}

        {/* 可折叠步骤时间线（替代线性工具活动条） */}
        {status === 'running' || toolTimeline.length > 0 ? (
          <AnalysisStepTimeline entries={toolTimeline} />
        ) : null}

        {/* 工具活动状态条（保留为降级展示） */}
        {status === 'running' && toolTimeline.length === 0 ? (
          <AnalysisToolActivityStrip activities={toolActivities} />
        ) : null}

        {/* 结果区域（结论详情 / 证据 / 推理 / 假设） */}
        {result ? (
          <div className="mt-5">
            {/* 主结果块：只展示 primary（回答与相关图表）；supporting 明细收进侧滑抽屉 */}
            {primaryBlocks.map((block, index) => (
              <div
                className="analysis-block-enter"
                key={`result-${block.kind}-${index}`}
                style={{ animationDelay: `${Math.min(index, 5) * 80}ms` }}
              >
                <AnalysisResultBlockRenderer block={block} />
              </div>
            ))}

            {detailItemCount > 0 ? (
              <button
                className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-md border border-input bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setDetailsOpen(true)}
                type="button"
              >
                查看数据明细与依据（{detailItemCount} 项）
              </button>
            ) : null}
          </div>
        ) : null}

        {/* 侧滑抽屉：数据明细 + 证据 + 依据 + 口径 */}
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
              {result?.evidenceBlocks.length ? (
                <CollapsibleSection title="证据摘要">
                  {result.evidenceBlocks.map((block, index) => (
                    <div key={`evidence-${index}`}>
                      {registry.render({ renderedBlock: block })}
                    </div>
                  ))}
                </CollapsibleSection>
              ) : null}
              {result?.reasoningBlocks.length ? (
                <CollapsibleSection title="分析依据">
                  {result.reasoningBlocks.map((block, index) => (
                    <div key={`reasoning-${index}`}>
                      {registry.render({ renderedBlock: block })}
                    </div>
                  ))}
                </CollapsibleSection>
              ) : null}
              {result?.assumptionBlocks.length ? (
                <CollapsibleSection title="假设与口径">
                  {result.assumptionBlocks.map((block, index) => (
                    <div key={`assumption-${index}`}>
                      {registry.render({ renderedBlock: block })}
                    </div>
                  ))}
                </CollapsibleSection>
              ) : null}
            </div>
          </WorkbenchSheet>
        ) : null}

        {/* 失败状态 */}
        {status === 'failed' ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="text-sm font-medium text-rose-900">
              分析过程中遇到问题
            </p>
            <p className="mt-1 text-sm leading-6 text-rose-800">
              {errorSummary ?? '系统暂时没有返回可展示的失败原因，请打开诊断信息查看事件明细。'}
            </p>
            <button
              className="mt-2 text-xs font-medium text-rose-700 underline underline-offset-2 hover:text-rose-900"
              onClick={() => onOpenDetail(hasDiagnostics ? 'diagnostics' : 'execution-log')}
              type="button"
            >
              查看诊断信息
            </button>
          </div>
        ) : null}

        {/* 断流状态 */}
        {status === 'disconnected' ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-900">
              {headline}
            </p>
          </div>
        ) : null}

        {/* 底部信息入口（业务语言，不暴露工程术语） */}
        <div className="mt-4 flex flex-wrap gap-2">
          {availableDetails.filter(detail => detail !== 'diagnostics' || hasDiagnostics).map(detail => (
            <button key={detail}
              className="rounded-md px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenDetail(detail)} type="button">
              {{ plan: '分析计划', context: '背景信息', history: '历史问答', candidates: '可能原因', 'execution-log': '执行记录', diagnostics: '诊断信息' }[detail]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
