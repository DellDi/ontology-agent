'use client';

import type { AnalysisObjectSelection } from '@/domain/analysis-execution/object-selection';

import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  CornerDownRight,
  Database,
  GitBranch,
  ListChecks,
  SlidersHorizontal,
} from 'lucide-react';

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
import { MetricCardsGrid, VisualizationBlock, PrimaryAnswerBlock } from './analysis-business-views';
import { Loader } from '@/components/ai-elements/loader';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { useAnalysisWorkspace } from './analysis-workspace-context';
import type { DetailDrawerType } from './analysis-detail-drawer';

const ASSISTANT_DRAWER_LABELS: Record<string, string> = {
  attribution: '归因分析',
  actions: '动作建议',
  diagnostics: '诊断信息',
};

function drawerIcon(detail: Exclude<DetailDrawerType, null>) {
  switch (detail) {
    case 'attribution':
      return <GitBranch aria-hidden className="size-3.5" />;
    case 'actions':
      return <ListChecks aria-hidden className="size-3.5" />;
    default:
      return <AlertCircle aria-hidden className="size-3.5" />;
  }
}

function isBlockAlreadyVisualized(
  block: AnalysisRenderedBlock,
  metricCards: MetricCard[],
  visualizations: Visualization[],
): boolean {
  if (Array.isArray(block.payload?.drilldowns) && block.payload.drilldowns.length) return false;
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
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!Number.isFinite(startedAt) || now === null) return null;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const text =
    seconds >= 60
      ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
      : `${seconds} 秒`;
  return (
    <span className="text-xs tabular-nums text-muted-foreground/75">
      已用 {text}
    </span>
  );
}

export function AssistantAvatar() {
  return (
    <div
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[var(--brand-300)]/40 bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand-800)]"
    >
      智
    </div>
  );
}

const COVERAGE_TONE_STYLES = {
  muted: 'text-muted-foreground',
  amber: 'text-[var(--warning-ink)]',
  rose: 'text-[var(--danger-ink)]',
} as const;

const COVERAGE_PILL_STYLES = {
  muted: 'border-border/70 bg-card text-muted-foreground',
  amber: 'border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-ink)]',
  rose: 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-ink)]',
} as const;

function UnderstandingSummaryCard({
  understanding,
  onEditUnderstanding,
}: {
  understanding: SemanticQueryUnderstanding[];
  onEditUnderstanding?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const descriptions = understanding.map((entry) => ({
    entry,
    description: describeSemanticQuery(entry),
  }));

  const worstTone: 'muted' | 'amber' | 'rose' = descriptions.some(
    ({ description }) => description.coverage.tone === 'rose',
  )
    ? 'rose'
    : descriptions.some(({ description }) => description.coverage.tone === 'amber')
      ? 'amber'
      : 'muted';

  const summaryBadgeLabel =
    worstTone === 'rose'
      ? '部分无数据'
      : worstTone === 'amber'
        ? '口径覆盖受限'
        : `${understanding.length} 项查询口径`;

  const objectPreview = descriptions
    .map(({ entry }) => entry.object.label)
    .filter((label, index, list) => Boolean(label) && list.indexOf(label) === index)
    .slice(0, 3)
    .join(' · ');

  return (
    <div
      className="mt-4 overflow-hidden rounded-xl border border-border/80 bg-sky-50/70"
      data-testid="analysis-understanding"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
          onClick={() => setExpanded((prev) => !prev)}
          type="button"
        >
          <ChevronDown
            aria-hidden
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-180 text-foreground' : '-rotate-90'}`}
          />
          <span className="shrink-0 font-semibold text-foreground">我的理解</span>
          {objectPreview ? (
            <span className="min-w-0 truncate text-muted-foreground">
              {objectPreview}
            </span>
          ) : null}
          <span
            className={`shrink-0 rounded-full border px-2 py-0.25 text-[11px] font-medium ${COVERAGE_PILL_STYLES[worstTone]}`}
          >
            {summaryBadgeLabel}
          </span>
        </button>
        {onEditUnderstanding ? (
          <button
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs font-medium text-foreground/85 transition-colors hover:border-border hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onEditUnderstanding}
            type="button"
          >
            <SlidersHorizontal aria-hidden className="size-3" />
            修改
          </button>
        ) : null}
      </div>

      {expanded ? (
        <ul className="divide-y divide-border/60 border-t border-border/70 bg-card/70 px-4 py-1">
          {descriptions.map(({ entry, description }) => (
            <li className="space-y-1 py-2.5 text-xs leading-5" key={entry.id}>
              <p className="font-medium text-foreground">
                {description.subject}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                <span>时间：{description.time}</span>
                {description.compare ? <span>{description.compare}</span> : null}
                {description.limit ? <span>{description.limit}</span> : null}
              </div>
              {description.filters.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {description.filters.map((filter, index) => (
                    <span
                      className="rounded-md bg-sky-100/80 px-2 py-0.5 text-[11px] text-muted-foreground"
                      key={`${entry.id}-filter-${index}`}
                    >
                      {filter}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className={COVERAGE_TONE_STYLES[description.coverage.tone]}>
                {description.coverage.text}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AnalysisAssistantMessage({
  workspaceMode = false,
  canvasInWorkspace = false,
  status,
  headline,
  errorSummary,
  errorCode,
  historicalError,
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
  errorCode?: string;
  historicalError?: string;
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
  } | null) => void;
  workspaceMode?: boolean;
  canvasInWorkspace?: boolean;
  onObjectSelect?: (selection: AnalysisObjectSelection, label: string, question?: string) => void;
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
  const unsupported = errorCode === 'EASYV_QUESTION_UNSUPPORTED';

  const workspace = useAnalysisWorkspace();
  const externalCanvas = workspaceMode || canvasInWorkspace;
  const [activeCanvasIndex, setActiveCanvasIndex] = useState(0);
  const [copiedAnswer, setCopiedAnswer] = useState(false);
  const registry = getDefaultAnalysisInteractionUiRendererRegistry();

  const visibleBlocks = (result?.blocks ?? []).filter(
    (block) => !isBlockAlreadyVisualized(block, metricCards, visualizations),
  );
  const objectBlocks = visibleBlocks.filter((block) => block.kind === 'object-browser');
  const canvasBlocks = objectBlocks.filter((block) => typeof block.payload.objectKey === 'string' && block.payload.objectKey.startsWith('easyv-prototype-'));
  const detailObjectBlocks = objectBlocks.filter((block) => !canvasBlocks.includes(block));
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

  const canCopyAnswer = status === 'completed' && primaryAnswer.trim().length > 0;
  const showActionBar =
    canCopyAnswer || detailItemCount > 0 || businessDetails.length > 0;

  const handleCopyAnswer = () => {
    if (!primaryAnswer || typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(primaryAnswer).then(() => {
      setCopiedAnswer(true);
      window.setTimeout(() => setCopiedAnswer(false), 1600);
    });
  };

  // 支撑材料内容：点击"数据明细与依据"时交给会话页右侧内联面板渲染
  const detailsContent = (
    <div className="space-y-4">
      {supportingBlocks.map((block, index) => (
        <AnalysisResultBlockRenderer
          key={`supporting-${block.kind}-${index}`}
          block={block}
          onOpenSidePanel={onOpenSidePanel}
          onObjectSelect={onObjectSelect}
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
    <div className="flex justify-start gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <div className="flex h-7 items-center gap-2">
          <p className="text-xs font-semibold text-foreground">智能员工</p>
          {!waitingForProgress && !unsupported ? getStatusIcon(status) : null}
          <p className="text-xs text-muted-foreground">
            {unsupported ? '当前能力范围' : headline}
          </p>
          {progressLabel && progressLabel !== headline ? (
            <span className="text-xs text-muted-foreground">
              · {progressLabel}
            </span>
          ) : null}
          {status === 'running' && runningSinceIso ? (
            <ElapsedTicker sinceIso={runningSinceIso} />
          ) : null}
        </div>

        <div
          className={waitingForProgress
            ? 'mt-2 flex items-center gap-2 text-sm leading-6 text-muted-foreground'
            : 'mt-2.5'}
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
          {/* 引用核对完成前只显示进度，避免把未验证的生成内容当作结论。 */}
          {status === 'running' && streamingAnswer ? (
            <div className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-sky-50/75 px-3.5 py-2 text-sm leading-6 text-muted-foreground" role="status">
              <Loader aria-hidden className="shrink-0 text-primary motion-reduce:animate-none" size={14} />
              <span>正在整理回答并核对来源，核对完成后显示结论…</span>
            </div>
          ) : null}

          {workspaceMode && status === 'completed' ? (
            <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-muted-foreground">
              历史分析 · 以下保留当时判断，当前应用状态见右侧修改建议。
            </p>
          ) : null}
          {externalCanvas && canvasBlocks.length ? (
            <nav aria-label="查看本轮大屏" className="mb-3 flex flex-wrap gap-2">
              {canvasBlocks.map((block, index) => (
                <button
                  type="button"
                  key={index}
                  onClick={() => workspace?.showObject(block)}
                  className="rounded-lg border border-border/80 bg-sky-50 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-[var(--brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {block.title ?? '在工作区查看'}
                </button>
              ))}
            </nav>
          ) : null}
          {!externalCanvas && canvasBlocks.length ? (
            <section aria-label="大屏结构工作区" className="mb-6 space-y-3">
              {canvasBlocks.length > 1 ? (
                <nav aria-label="选择当前画布" className="flex flex-wrap gap-1">
                  {canvasBlocks.map((block, index) => (
                    <button
                      key={index}
                      type="button"
                      aria-pressed={activeCanvasIndex === index}
                      className={activeCanvasIndex === index
                        ? 'rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground'
                        : 'rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'}
                      onClick={() => { setActiveCanvasIndex(index); onOpenSidePanel?.(null); }}
                    >
                      {block.title ?? '大屏结构'}
                    </button>
                  ))}
                </nav>
              ) : null}
              {canvasBlocks[activeCanvasIndex] ? (
                <AnalysisResultBlockRenderer
                  key={activeCanvasIndex}
                  block={canvasBlocks[activeCanvasIndex]}
                  embedded
                  onOpenSidePanel={onOpenSidePanel}
                  onObjectSelect={onObjectSelect}
                />
              ) : null}
            </section>
          ) : null}

          {/* 一句话业务答案 */}
          {status === 'completed' || primaryAnswer ? (
            <PrimaryAnswerBlock answer={primaryAnswer} />
          ) : null}

          {detailObjectBlocks.length > 0 ? (
            <nav aria-label="查看相关内容" className="mt-3 flex flex-wrap gap-2">
              {detailObjectBlocks.map((block, index) => (
                <button
                  key={`objects-${index}`}
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-[var(--brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() =>
                    onOpenSidePanel?.({
                      title: block.title ?? '记录详情',
                      testId: 'analysis-object-drawer',
                      content: (
                        <AnalysisResultBlockRenderer
                          block={block}
                          onObjectSelect={onObjectSelect}
                        />
                      ),
                    })
                  }
                >
                  {block.title ?? '查看记录'}
                </button>
              ))}
            </nav>
          ) : null}

          {/* 指标卡网格 */}
          <MetricCardsGrid cards={metricCards} />

          {/* 可视化（图表 / 关系图 / 表格） */}
          {visualizations.map((viz, index) => (
            <VisualizationBlock
              key={`${viz.type}-${viz.title}-${index}`}
              onOpenSidePanel={onOpenSidePanel}
              visualization={viz}
              registry={registry}
            />
          ))}

          <AnalysisStepTimeline entries={toolTimeline} />

          {/* 工具活动状态条（保留为降级展示） */}
          {status === 'running' && toolTimeline.length === 0 ? (
            <AnalysisToolActivityStrip activities={toolActivities} />
          ) : null}

          {/* 结果区域（结论详情 / 表格 / 指标条 / 图表） */}
          {primaryBlocks.length > 0 ? (
            <div className="mt-5 space-y-4">
              {/* 主结果块：只展示 primary（回答与相关图表）；supporting 明细收进侧滑抽屉 */}
              {primaryBlocks.map((block, index) => (
                <div
                  className="analysis-block-enter"
                  key={`result-${block.kind}-${index}`}
                  style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}
                >
                  <AnalysisResultBlockRenderer
                    block={block}
                    embedded
                    onOpenSidePanel={onOpenSidePanel}
                    onObjectSelect={onObjectSelect}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {/* 失败状态：带结构化澄清时替换通用错误，给出可点选的候选项 */}
          {status === 'failed' ? (
            clarification ? (
              <div className="mt-3 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] px-4 py-3.5">
                <p className="text-sm font-semibold text-[var(--warning-ink)]">
                  需要先确认：{clarification.question}
                </p>
                {clarification.options.length > 0 ? (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {clarification.options.map((option) => (
                      <button
                        className="rounded-lg border border-[var(--warning-border)] bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/60 hover:bg-[var(--brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        key={option}
                        onClick={() => onClarificationOption?.(option)}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
                <p className="mt-2.5 text-xs text-[var(--warning-ink)]/80">
                  也可以直接在下方输入补充说明
                </p>
              </div>
            ) : (
              <div
                className={
                  unsupported
                    ? 'mt-3 rounded-xl border border-border bg-sky-50/75 px-4 py-3.5'
                    : 'mt-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3.5'
                }
                role={unsupported ? 'status' : 'alert'}
              >
                <p
                  className={
                    unsupported
                      ? 'text-sm font-semibold text-foreground'
                      : 'text-sm font-semibold text-[var(--danger-ink)]'
                  }
                >
                  {unsupported ? '当前入口暂不支持这个操作' : '分析过程中遇到问题'}
                </p>
                <p
                  className={
                    unsupported
                      ? 'mt-1 text-sm leading-6 text-muted-foreground'
                      : 'mt-1 text-sm leading-6 text-[var(--danger-ink)]/90'
                  }
                >
                  {errorSummary ?? '系统暂时没有返回可展示的失败原因。'}
                </p>
                {historicalError ? (
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">查看当时的原始记录</summary>
                    <p className="mt-2 whitespace-pre-wrap break-words">{historicalError}</p>
                  </details>
                ) : null}
              </div>
            )
          ) : null}

          {/* 断流状态 */}
          {status === 'disconnected' ? (
            <div className="mt-3 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] px-4 py-3">
              <p className="text-sm text-[var(--warning-ink)]">{headline}</p>
            </div>
          ) : null}

          {/* 底部统一业务操作栏 */}
          {showActionBar ? (
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              {canCopyAnswer ? (
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/75 bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-sky-50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={handleCopyAnswer}
                  type="button"
                >
                  {copiedAnswer ? (
                    <>
                      <Check aria-hidden className="size-3.5 text-[var(--success-500)]" />
                      <span className="text-[var(--success-ink)]">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy aria-hidden className="size-3.5" />
                      <span>复制结论</span>
                    </>
                  )}
                </button>
              ) : null}
              {detailItemCount > 0 ? (
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/75 bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-sky-50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() =>
                    onOpenSidePanel?.({
                      title: '数据明细与依据',
                      testId: 'analysis-supporting-drawer',
                      content: detailsContent,
                    })
                  }
                  type="button"
                >
                  <Database aria-hidden className="size-3.5 text-primary/80" />
                  <span>数据明细与依据（{detailItemCount}）</span>
                </button>
              ) : null}
              {businessDetails.map((detail) => (
                <button
                  key={detail}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/75 bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-sky-50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenDetail(detail)}
                  type="button"
                >
                  {drawerIcon(detail)}
                  <span>{ASSISTANT_DRAWER_LABELS[detail]}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* 我的理解：紧凑可折叠查询口径条，释放正文与输入框之间的空间 */}
        {status === 'completed' && understanding && understanding.length > 0 ? (
          <UnderstandingSummaryCard
            onEditUnderstanding={onEditUnderstanding}
            understanding={understanding}
          />
        ) : null}

        {/* 上下文相关追问建议：作为对话内容的一部分，点击即发送 */}
        {status === 'completed' && suggestions && suggestions.length > 0 && onSuggestionClick ? (
          <Suggestions className="mt-4 w-full flex-col items-stretch gap-1.5">
            {suggestions.map((question) => (
              <Suggestion
                className="group h-auto w-full justify-between whitespace-normal rounded-xl border border-border/70 bg-sky-50/50 px-3.5 py-2.5 text-left text-[13px] font-normal text-foreground/85 transition-colors hover:border-border hover:bg-sky-100/70 hover:text-foreground"
                variant="ghost"
                key={question}
                onClick={onSuggestionClick}
                suggestion={question}
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="min-w-0 flex-1">{question}</span>
                  <CornerDownRight
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary"
                  />
                </span>
              </Suggestion>
            ))}
          </Suggestions>
        ) : null}

        {/* 支撑材料由会话页右侧内联面板渲染（onOpenSidePanel） */}
      </div>
    </div>
  );
}
