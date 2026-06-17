'use client';

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

export function AnalysisAssistantMessage({
  status,
  headline,
  progressLabel,
  toolActivities,
  result,
  diagnostics,
  primaryAnswer,
  metricCards,
  visualizations,
  toolTimeline,
  onOpenDetail,
}: {
  status: ConversationAssistantStatus;
  headline: string;
  progressLabel?: string;
  toolActivities: ToolActivitySummary[];
  result: AnalysisConversationViewModel['assistantMessage']['result'];
  diagnostics: AnalysisConversationViewModel['assistantMessage']['diagnostics'];
  primaryAnswer: string;
  metricCards: MetricCard[];
  visualizations: Visualization[];
  toolTimeline: AnalysisConversationViewModel['assistantMessage']['toolTimeline'];
  onOpenDetail: (drawer: DetailDrawerType) => void;
}) {
  const hasDiagnostics =
    diagnostics.timelineBlocks.length > 0 ||
    diagnostics.processBoardBlocks.length > 0 ||
    diagnostics.renderErrors.length > 0 ||
    diagnostics.otherBlocks.length > 0;

  const registry = getDefaultAnalysisInteractionUiRendererRegistry();

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full">
        {/* 状态行 */}
        <div className="flex items-center gap-2.5">
          {getStatusIcon(status)}
          <p className="text-sm font-medium text-[color:var(--ink-900)]">
            {headline}
          </p>
          {progressLabel ? (
            <span className="text-xs text-[color:var(--ink-600)]">
              {progressLabel}
            </span>
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
            {/* 主结果块（跳过已在指标卡 / 可视化中呈现的块） */}
            {result.blocks
              .filter((block) => !isBlockAlreadyVisualized(block, metricCards, visualizations))
              .map((block, index) => (
                <AnalysisResultBlockRenderer
                  key={`result-${block.kind}-${index}`}
                  block={block}
                />
              ))}

            {/* 证据摘要 */}
            {result.evidenceBlocks.length > 0 ? (
              <CollapsibleSection title="证据摘要">
                {result.evidenceBlocks.map((block, index) => (
                  <div key={`evidence-${index}`}>
                    {registry.render({ renderedBlock: block })}
                  </div>
                ))}
              </CollapsibleSection>
            ) : null}

            {/* 分析依据 */}
            {result.reasoningBlocks.length > 0 ? (
              <CollapsibleSection title="分析依据">
                {result.reasoningBlocks.map((block, index) => (
                  <div key={`reasoning-${index}`}>
                    {registry.render({ renderedBlock: block })}
                  </div>
                ))}
              </CollapsibleSection>
            ) : null}

            {/* 假设与口径 */}
            {result.assumptionBlocks.length > 0 ? (
              <CollapsibleSection title="假设与口径">
                {result.assumptionBlocks.map((block, index) => (
                  <div key={`assumption-${index}`}>
                    {registry.render({ renderedBlock: block })}
                  </div>
                ))}
              </CollapsibleSection>
            ) : null}
          </div>
        ) : null}

        {/* 失败状态 */}
        {status === 'failed' ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="text-sm text-rose-900">
              分析过程中遇到问题，请查看详细信息了解原因。
            </p>
            <button
              className="mt-2 text-xs font-medium text-rose-700 underline underline-offset-2 hover:text-rose-900"
              onClick={() => onOpenDetail('execution-log')}
              type="button"
            >
              查看详细信息
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
          <button
            className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-[color:var(--surface-50)] hover:text-[color:var(--ink-900)]"
            onClick={() => onOpenDetail('plan')}
            type="button"
          >
            分析计划
          </button>
          <button
            className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-[color:var(--surface-50)] hover:text-[color:var(--ink-900)]"
            onClick={() => onOpenDetail('context')}
            type="button"
          >
            背景信息
          </button>
          <button
            className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-[color:var(--surface-50)] hover:text-[color:var(--ink-900)]"
            onClick={() => onOpenDetail('history')}
            type="button"
          >
            历史问答
          </button>
          <button
            className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-[color:var(--surface-50)] hover:text-[color:var(--ink-900)]"
            onClick={() => onOpenDetail('candidates')}
            type="button"
          >
            可能原因
          </button>
          <button
            className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-[color:var(--surface-50)] hover:text-[color:var(--ink-900)]"
            onClick={() => onOpenDetail('execution-log')}
            type="button"
          >
            详细信息
          </button>
          {hasDiagnostics ? (
            <button
              className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-[color:var(--surface-50)] hover:text-[color:var(--ink-900)]"
              onClick={() => onOpenDetail('diagnostics')}
              type="button"
            >
              诊断信息
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}