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
import { MarkdownContent } from '@/app/_components/markdown-content';
import { MetricCardsGrid, VisualizationBlock, PrimaryAnswerBlock } from './analysis-business-views';
import { WorkbenchSheet } from '@/app/_components/workbench/workbench-sheet';
import type { DetailDrawerType } from './analysis-detail-drawer';

const ASSISTANT_DRAWER_LABELS: Record<string, string> = {
  attribution: '归因分析',
  actions: '动作建议',
  diagnostics: '诊断信息',
};

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

export function AssistantAvatar() {
  return (
    <div
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
    >
      智
    </div>
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
  streamingAnswer,
  metricCards,
  visualizations,
  toolTimeline,
  onOpenDetail,
  availableDetails = [],
  suggestions,
  onSuggestionClick,
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
  streamingAnswer?: string;
  metricCards: MetricCard[];
  visualizations: Visualization[];
  toolTimeline: AnalysisConversationViewModel['assistantMessage']['toolTimeline'];
  onOpenDetail: (drawer: DetailDrawerType) => void;
  availableDetails?: Exclude<DetailDrawerType, null>[];
  suggestions?: string[];
  onSuggestionClick?: (question: string) => void;
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

  const businessDetails = availableDetails.filter(
    (detail) => detail === 'attribution' || detail === 'actions'
      || (detail === 'diagnostics' && hasDiagnostics && status === 'failed'),
  );

  return (
    <div className="flex justify-start gap-2.5">
      <AssistantAvatar />
      <div className="min-w-0 w-full max-w-[86%]">
        <div className="flex items-center gap-2.5">
          <p className="text-xs font-semibold text-foreground">智能员工</p>
          {getStatusIcon(status)}
          <p className="text-xs text-muted-foreground">
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

        <div className="mt-1.5 rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 shadow-sm">
          {/* 流式回答：生成中随 LLM 输出逐段渲染，完成后由正式结论替换 */}
          {status === 'running' && streamingAnswer ? (
            <div className="streaming-answer">
              <MarkdownContent className="text-base leading-7 text-foreground">
                {streamingAnswer}
              </MarkdownContent>
              <span
                aria-hidden
                className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-text-bottom"
              />
            </div>
          ) : null}

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
            <div className="mt-3">
              {/* 主结果块：只展示 primary（回答与相关图表）；supporting 明细收进侧滑抽屉 */}
              {primaryBlocks.map((block, index) => (
                <div
                  className="analysis-block-enter"
                  key={`result-${block.kind}-${index}`}
                  style={{ animationDelay: `${Math.min(index, 5) * 80}ms` }}
                >
                  <AnalysisResultBlockRenderer block={block} embedded />
                </div>
              ))}
            </div>
          ) : null}

          {/* 失败状态 */}
          {status === 'failed' ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-sm font-medium text-rose-900">
                分析过程中遇到问题
              </p>
              <p className="mt-1 text-sm leading-6 text-rose-800">
                {errorSummary ?? '系统暂时没有返回可展示的失败原因。'}
              </p>
            </div>
          ) : null}

          {/* 断流状态 */}
          {status === 'disconnected' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm text-amber-900">
                {headline}
              </p>
            </div>
          ) : null}

          {/* 底部业务入口 */}
          {detailItemCount > 0 || businessDetails.length > 0 || (suggestions?.length && status === 'completed') ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
              {detailItemCount > 0 ? (
                <button
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setDetailsOpen(true)}
                  type="button"
                >
                  数据明细与依据（{detailItemCount}）
                </button>
              ) : null}
              {businessDetails.map((detail) => (
                <button
                  key={detail}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenDetail(detail)}
                  type="button"
                >
                  {ASSISTANT_DRAWER_LABELS[detail]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* 上下文相关追问建议：作为对话内容的一部分，点击即发送 */}
        {status === 'completed' && suggestions && suggestions.length > 0 && onSuggestionClick ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((question) => (
              <button
                key={question}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onSuggestionClick(question)}
                type="button"
              >
                {question}
              </button>
            ))}
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
      </div>
    </div>
  );
}
