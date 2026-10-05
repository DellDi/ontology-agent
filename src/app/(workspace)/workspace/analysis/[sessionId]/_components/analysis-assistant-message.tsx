'use client';

import type { AnalysisObjectSelection } from '@/domain/analysis-execution/object-selection';

import { useEffect, useState, type ReactNode } from 'react';

import type {
  AnalysisConversationViewModel,
  ConversationAssistantStatus,
  MetricCard,
  ToolActivitySummary,
  Visualization,
} from '@/application/analysis-message-projection/conversation-view-model';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import {
  describeSemanticQuery,
  type SemanticClarification,
  type SemanticQueryUnderstanding,
} from '@/application/analysis-message-projection/semantic-understanding';
import { getDefaultAnalysisInteractionUiRendererRegistry } from './analysis-interaction-ui-renderer-registry';
import { AnalysisStepTimeline } from './analysis-step-timeline';
import { AnalysisToolActivityStrip } from './analysis-tool-activity-strip';
import { AnalysisResultBlockRenderer } from './analysis-result-block-renderer';
import { CollapsibleSection } from './collapsible-section';
import { getStatusIcon } from './analysis-status-icon';
import { MarkdownContent } from '@/app/_components/markdown-content';
import { MetricCardsGrid, VisualizationBlock, PrimaryAnswerBlock } from './analysis-business-views';
import { Loader } from '@/components/ai-elements/loader';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
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

const COVERAGE_TONE_STYLES = {
  muted: 'text-muted-foreground',
  amber: 'text-amber-700',
  rose: 'text-rose-700',
} as const;

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
  onOpenSidePanel,
  onObjectSelect,
  availableDetails = [],
  suggestions,
  onSuggestionClick,
  understanding,
  onEditUnderstanding,
  clarification,
  onClarificationOption,
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
  /** 打开会话页右侧内联面板（数据明细与依据等支撑材料） */
  onOpenSidePanel?: (panel: {
    title: string;
    content: ReactNode;
    testId?: string;
  }) => void;
  onObjectSelect?: (selection: AnalysisObjectSelection, label: string) => void;
  availableDetails?: Exclude<DetailDrawerType, null>[];
  suggestions?: string[];
  onSuggestionClick?: (question: string) => void;
  /** EasyV 语义查询的「我的理解」：完成态快照中的逐查询解读 */
  understanding?: SemanticQueryUnderstanding[] | null;
  /** 提供编辑器目录且不忙时由上层传入，点击打开结构化调整抽屉 */
  onEditUnderstanding?: () => void;
  /** 失败轮次的结构化澄清：question + 候选选项 */
  clarification?: SemanticClarification | null;
  onClarificationOption?: (option: string) => void;
}) {
  const hasDiagnostics =
    diagnostics.timelineBlocks.length > 0 ||
    diagnostics.processBoardBlocks.length > 0 ||
    diagnostics.renderErrors.length > 0 ||
    diagnostics.otherBlocks.length > 0;

  const registry = getDefaultAnalysisInteractionUiRendererRegistry();

  const visibleBlocks = (result?.blocks ?? []).filter(
    (block) => !isBlockAlreadyVisualized(block, metricCards, visualizations),
  );
  const objectBlocks = visibleBlocks.filter((block) => block.kind === 'object-browser');
  const primaryBlocks = visibleBlocks.filter(
    (block) => block.kind !== 'object-browser' && block.payload?.role !== 'supporting',
  );
  const supportingBlocks = visibleBlocks.filter(
    (block) => block.kind !== 'object-browser' && block.payload?.role === 'supporting',
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
  const waitingForProgress =
    (status === 'queued' || status === 'running') &&
    !primaryAnswer && !streamingAnswer &&
    metricCards.length === 0 && visualizations.length === 0 &&
    toolTimeline.length === 0 && toolActivities.length === 0 &&
    primaryBlocks.length === 0 && detailItemCount === 0 && businessDetails.length === 0;

  // 支撑材料内容：点击"数据明细与依据"时交给会话页右侧内联面板渲染
  const detailsContent = (
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
  );

  return (
    <div className="flex justify-start gap-2.5">
      <AssistantAvatar />
      <div className="min-w-0 w-full max-w-[86%]">
        <div className="flex items-center gap-2.5">
          <p className="text-xs font-semibold text-foreground">智能员工</p>
          {!waitingForProgress ? getStatusIcon(status) : null}
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

        <div
          className={waitingForProgress
            ? 'mt-2 flex items-center gap-2 text-sm leading-6 text-muted-foreground'
            : 'mt-1.5 rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 shadow-sm'}
          role={waitingForProgress ? 'status' : undefined}
          aria-live={waitingForProgress ? 'polite' : undefined}
          aria-busy={waitingForProgress || undefined}
        >
          {waitingForProgress ? (
            <>
              <Loader aria-hidden className="shrink-0 text-primary motion-reduce:animate-none" size={16} />
              <span>
                {status === 'queued'
                  ? '问题已提交，等待分析进度…'
                  : '正在处理，结果会逐步显示…'}
              </span>
            </>
          ) : null}
          {/* 流式回答：生成中随 LLM 输出逐段渲染，完成后由正式结论替换 */}
          {status === 'running' && streamingAnswer ? (
            <div className="streaming-answer">
              <MarkdownContent
                className="text-sm leading-7 text-foreground"
                streaming
              >
                {streamingAnswer}
              </MarkdownContent>
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
          {primaryBlocks.length > 0 ? (
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

          {/* 失败状态：带结构化澄清时替换通用错误，给出可点选的候选项 */}
          {status === 'failed' ? (
            clarification ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-medium text-amber-900">
                  需要先确认：{clarification.question}
                </p>
                {clarification.options.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {clarification.options.map((option) => (
                      <button
                        className="rounded-full border border-amber-300 bg-card px-3 py-1.5 text-xs text-amber-900 transition-colors hover:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        key={option}
                        onClick={() => onClarificationOption?.(option)}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-amber-800/80">
                  也可以直接在下方输入补充说明
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
                <p className="text-sm font-medium text-rose-900">
                  分析过程中遇到问题
                </p>
                <p className="mt-1 text-sm leading-6 text-rose-800">
                  {errorSummary ?? '系统暂时没有返回可展示的失败原因。'}
                </p>
              </div>
            )
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
          {objectBlocks.length > 0 || detailItemCount > 0 || businessDetails.length > 0 || (suggestions?.length && status === 'completed') ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
              {objectBlocks.map((block, index) => (
                <button key={`objects-${index}`} type="button"
                  className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenSidePanel?.({ title: block.title ?? '查看原型', testId: 'analysis-object-drawer',
                    content: <AnalysisResultBlockRenderer block={block} onObjectSelect={onObjectSelect} /> })}>
                  查看原型{objectBlocks.length > 1 ? ` · ${block.title}` : ''}
                </button>
              ))}
              {detailItemCount > 0 ? (
                <button
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() =>
                    onOpenSidePanel?.({
                      title: '数据明细与依据',
                      testId: 'analysis-supporting-drawer',
                      content: detailsContent,
                    })
                  }
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

        {/* 我的理解：完成态语义查询轮的逐查询解读 + 覆盖度 + 结构化调整入口 */}
        {status === 'completed' && understanding && understanding.length > 0 ? (
          <div
            className="mt-2 rounded-xl border border-border bg-muted/30 px-4 py-3"
            data-testid="analysis-understanding"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">
                我的理解
              </p>
              {onEditUnderstanding ? (
                <button
                  className="rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={onEditUnderstanding}
                  type="button"
                >
                  修改
                </button>
              ) : null}
            </div>
            <ul className="mt-2 space-y-3">
              {understanding.map((entry) => {
                const description = describeSemanticQuery(entry);
                return (
                  <li className="space-y-0.5 text-xs leading-5" key={entry.id}>
                    <p className="font-medium text-foreground">
                      {description.subject}
                    </p>
                    <p className="text-muted-foreground">
                      时间：{description.time}
                    </p>
                    {description.compare ? (
                      <p className="text-muted-foreground">
                        {description.compare}
                      </p>
                    ) : null}
                    {description.filters.map((filter, index) => (
                      <p className="text-muted-foreground" key={`${entry.id}-filter-${index}`}>
                        {filter}
                      </p>
                    ))}
                    {description.limit ? (
                      <p className="text-muted-foreground">{description.limit}</p>
                    ) : null}
                    <p className={COVERAGE_TONE_STYLES[description.coverage.tone]}>
                      {description.coverage.text}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* 上下文相关追问建议：作为对话内容的一部分，点击即发送 */}
        {status === 'completed' && suggestions && suggestions.length > 0 && onSuggestionClick ? (
          <Suggestions className="mt-2">
            {suggestions.map((question) => (
              <Suggestion
                key={question}
                onClick={onSuggestionClick}
                suggestion={question}
              />
            ))}
          </Suggestions>
        ) : null}

        {/* 支撑材料由会话页右侧内联面板渲染（onOpenSidePanel） */}
      </div>
    </div>
  );
}
