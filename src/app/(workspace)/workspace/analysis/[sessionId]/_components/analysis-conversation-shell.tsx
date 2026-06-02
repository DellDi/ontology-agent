'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type {
  AnalysisConversationViewModel,
  ConversationAssistantStatus,
  MetricCard,
  ToolActivitySummary,
  Visualization,
} from '@/application/analysis-message-projection/conversation-view-model';
import type { ConversationThreadViewModel } from '@/application/analysis-message-projection/conversation-thread-view-model';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import { getDefaultAnalysisInteractionUiRendererRegistry } from './analysis-interaction-ui-renderer-registry';
import { AnalysisStepTimeline } from './analysis-step-timeline';
import { translateToolName } from '@/application/analysis-message-projection/tool-name-translations';

// ---------------------------------------------------------------------------
// 工具活动状态条
// ---------------------------------------------------------------------------

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

function AnalysisToolActivityStrip({
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

// ---------------------------------------------------------------------------
// 结果块渲染
// ---------------------------------------------------------------------------

function AnalysisResultBlockRenderer({
  block,
}: {
  block: AnalysisRenderedBlock;
}) {
  const registry = getDefaultAnalysisInteractionUiRendererRegistry();

  if (block.kind === 'conclusion-summary') {
    return <ConclusionSummaryBlock block={block} />;
  }

  return (
    <div className="mt-4">
      {registry.render({ renderedBlock: block })}
    </div>
  );
}

function formatConfidenceBadge(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // confidence 是 0~1 之间的数值，格式化为百分比
  if (value <= 1) return `${Math.round(value * 100)}%`;
  return `${value}%`;
}

function ConclusionSummaryBlock({
  block,
}: {
  block: AnalysisRenderedBlock;
}) {
  // 严格匹配 RankedConclusionCause shape：
  //   { id, rank, title, summary, confidence: number|null, evidence: {label, summary}[] }
  const causes = Array.isArray(block.payload.causes)
    ? (block.payload.causes as {
        title: string;
        summary: string;
        confidence?: number | null;
        evidence?: { label: string; summary: string }[];
      }[])
    : [];

  return (
    <div className="space-y-4">
      {causes.map((cause, index) => {
        const confidenceLabel = formatConfidenceBadge(cause.confidence);
        const evidenceItems = Array.isArray(cause.evidence) ? cause.evidence : [];

        return (
          <div
            key={`${cause.title}-${index}`}
            className="rounded-xl border border-[color:var(--line-200)] bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-base font-semibold text-[color:var(--ink-900)]">
                {index + 1}. {cause.title}
              </h4>
              {confidenceLabel ? (
                <span className="shrink-0 rounded-full bg-[color:var(--sky-100)] px-2.5 py-0.5 text-xs font-medium text-[color:var(--brand-700)]">
                  置信度 {confidenceLabel}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm leading-7 text-[color:var(--ink-600)]">
              {cause.summary}
            </p>
            {evidenceItems.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {evidenceItems.map((item, evidenceIndex) => (
                  <li
                    key={evidenceIndex}
                    className="text-xs text-[color:var(--ink-600)]"
                  >
                    · <span className="font-medium">{item.label}</span>：{item.summary}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 折叠区域
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-4">
      <button
        className="flex items-center gap-2 text-sm font-medium text-[color:var(--ink-600)] transition-colors hover:text-[color:var(--ink-900)]"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span
          className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}
        >
          ›
        </span>
        {title}
      </button>
      {isOpen ? (
        <div className="mt-3 space-y-3 pl-4 border-l-2 border-[color:var(--line-200)]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 状态图标
// ---------------------------------------------------------------------------

function getStatusIcon(status: ConversationAssistantStatus) {
  switch (status) {
    case 'running':
      return (
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--brand-500)] opacity-40" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[color:var(--brand-500)]" />
        </span>
      );
    case 'completed':
      return (
        <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
      );
    case 'failed':
      return (
        <span className="flex h-2.5 w-2.5 rounded-full bg-rose-400" />
      );
    case 'disconnected':
      return (
        <span className="flex h-2.5 w-2.5 rounded-full bg-amber-400" />
      );
    case 'queued':
    default:
      return (
        <span className="flex h-2.5 w-2.5 rounded-full bg-[color:var(--ink-600)]/30" />
      );
  }
}

// ---------------------------------------------------------------------------
// Story 12-3：业务向视图组件（primaryAnswer / metricCards / visualizations）
// ---------------------------------------------------------------------------

function MetricTrendIcon({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  switch (trend) {
    case 'up':
      return <span aria-hidden className="text-emerald-500">↑</span>;
    case 'down':
      return <span aria-hidden className="text-rose-500">↓</span>;
    case 'stable':
      return <span aria-hidden className="text-[color:var(--ink-600)]">→</span>;
  }
}

function MetricCardsGrid({ cards }: { cards: MetricCard[] }) {
  if (cards.length === 0) return null;

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card, index) => (
        <div
          key={`${card.label}-${index}`}
          className="rounded-xl border border-[color:var(--line-200)] bg-white px-4 py-3 shadow-sm"
        >
          <p className="text-xs text-[color:var(--ink-600)]">{card.label}</p>
          <p className="mt-1 flex items-baseline gap-1.5 text-2xl font-semibold text-[color:var(--ink-900)]">
            <span>{card.value}</span>
            {card.unit ? (
              <span className="text-sm font-normal text-[color:var(--ink-600)]">
                {card.unit}
              </span>
            ) : null}
          </p>
          {card.trend ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-[color:var(--ink-600)]">
              <MetricTrendIcon trend={card.trend} />
              {card.trendLabel ? <span>{card.trendLabel}</span> : null}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function VisualizationBlock({
  visualization,
  registry,
}: {
  visualization: Visualization;
  registry: ReturnType<typeof getDefaultAnalysisInteractionUiRendererRegistry>;
}) {
  // 把 Visualization 转化为可被 registry 渲染的 AnalysisRenderedBlock 形态
  const block: AnalysisRenderedBlock = {
    kind:
      visualization.type === 'chart'
        ? 'chart'
        : visualization.type === 'graph'
          ? 'graph'
          : 'table',
    surface: 'workspace',
    title: visualization.title,
    label: visualization.title,
    variant:
      visualization.type === 'chart'
        ? 'chart'
        : visualization.type === 'graph'
          ? 'graph'
          : 'table',
    source: { sourceType: 'runtime-foundation-part' },
    payload: (visualization.data as Record<string, unknown>) ?? {},
    diagnostics: { originalType: visualization.type },
  };

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-[color:var(--ink-900)]">
          {visualization.title}
        </h4>
      </div>
      {registry.render({ renderedBlock: block })}
      {visualization.summary ? (
        <p className="mt-2 text-xs leading-5 text-[color:var(--ink-600)]">
          {visualization.summary}
        </p>
      ) : null}
    </div>
  );
}

function PrimaryAnswerBlock({ answer }: { answer: string }) {
  if (!answer) return null;

  return (
    <div className="mt-3 rounded-xl bg-white/80 px-4 py-3 shadow-sm ring-1 ring-[color:var(--line-200)]">
      <p className="text-base leading-7 text-[color:var(--ink-900)]">{answer}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 用户消息
// ---------------------------------------------------------------------------

function AnalysisUserMessage({
  questionText,
  badges,
}: {
  questionText: string;
  badges: { label: string; tone: string }[];
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        <div className="rounded-2xl rounded-tr-sm bg-[color:var(--brand-700)] px-5 py-3.5">
          <p className="text-base leading-7 text-white">
            {questionText}
          </p>
        </div>
        {badges.length > 0 ? (
          <div className="mt-2 flex flex-wrap justify-end gap-1.5">
            {badges.map((badge) => (
              <span
                key={badge.label}
                className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] text-[color:var(--ink-600)]"
              >
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 助手消息
// ---------------------------------------------------------------------------

function AnalysisAssistantMessage({
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
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
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
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-900">
              {headline}
            </p>
          </div>
        ) : null}

        {/* 底部信息入口（业务语言，不暴露工程术语） */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-white/60 hover:text-[color:var(--ink-900)]"
            onClick={() => onOpenDetail('plan')}
            type="button"
          >
            分析计划
          </button>
          <button
            className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-white/60 hover:text-[color:var(--ink-900)]"
            onClick={() => onOpenDetail('context')}
            type="button"
          >
            背景信息
          </button>
          <button
            className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-white/60 hover:text-[color:var(--ink-900)]"
            onClick={() => onOpenDetail('history')}
            type="button"
          >
            历史问答
          </button>
          <button
            className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-white/60 hover:text-[color:var(--ink-900)]"
            onClick={() => onOpenDetail('candidates')}
            type="button"
          >
            可能原因
          </button>
          <button
            className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-white/60 hover:text-[color:var(--ink-900)]"
            onClick={() => onOpenDetail('execution-log')}
            type="button"
          >
            详细信息
          </button>
          {hasDiagnostics ? (
            <button
              className="rounded-md px-2.5 py-1 text-xs text-[color:var(--ink-600)] transition-colors hover:bg-white/60 hover:text-[color:var(--ink-900)]"
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

/**
 * 判断某个 result block 是否已经在指标卡 / 可视化中呈现，
 * 避免在主结果区重复展示。
 */
function isBlockAlreadyVisualized(
  block: AnalysisRenderedBlock,
  metricCards: MetricCard[],
  visualizations: Visualization[],
): boolean {
  // kv-list 已提取为 metricCards 时，跳过
  if (block.kind === 'kv-list' && metricCards.length > 0) return true;
  // metric chart 已提取为 metricCards 时，跳过
  if (
    block.kind === 'chart' &&
    block.payload?.chartType === 'metric' &&
    metricCards.length > 0
  ) {
    return true;
  }
  // 非 metric chart / graph / table 已提取为 visualizations 时，跳过
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

// ---------------------------------------------------------------------------
// 详情抽屉
// ---------------------------------------------------------------------------

export type DetailDrawerType =
  | 'execution-log'
  | 'plan'
  | 'context'
  | 'history'
  | 'candidates'
  | 'diagnostics'
  | null;

const DRAWER_LABELS: Record<string, string> = {
  'execution-log': '详细信息',
  plan: '分析计划',
  context: '背景信息',
  history: '历史问答',
  candidates: '可能原因',
  diagnostics: '诊断信息',
};

function AnalysisDetailDrawer({
  drawerType,
  content,
  onClose,
}: {
  drawerType: DetailDrawerType;
  content: ReactNode;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!drawerType) return;

    const drawer = drawerRef.current;
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawer) return;

      const focusable = drawer.querySelectorAll<HTMLElement>(focusableSelector);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Focus first focusable element on open
    if (drawer) {
      const firstFocusable = drawer.querySelector<HTMLElement>(focusableSelector);
      firstFocusable?.focus();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerType, onClose]);

  if (!drawerType) return null;

  return (
    <aside
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label={DRAWER_LABELS[drawerType] ?? '详情'}
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[560px] transform transition-transform duration-300 translate-x-0"
    >
      <div className="h-full p-2 sm:p-4">
        <div className="flex h-full flex-col overflow-hidden rounded-[24px] border border-[color:var(--line-200)] bg-[color:var(--mist-0)]/97 shadow-[0_26px_58px_rgba(25,38,61,0.22)] backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-[color:var(--line-200)] px-6 py-4">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
                {DRAWER_LABELS[drawerType] ?? '详情'}
              </p>
            </div>
            <button
              className="secondary-button"
              onClick={onClose}
              type="button"
            >
              收起
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {content}
          </div>
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// 折叠轮次摘要（非活跃轮次时显示）
// ---------------------------------------------------------------------------

function CollapsedTurnSummary({
  viewModel,
}: {
  viewModel: AnalysisConversationViewModel;
}) {
  return (
    <div className="mt-2 rounded-2xl border border-[color:var(--line-200)] bg-[color:var(--mist-50)]/60 px-5 py-3">
      <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
        {viewModel.userMessage.questionText}
      </p>
      <p className="mt-1 text-sm text-[color:var(--ink-600)]">
        {viewModel.assistantMessage.primaryAnswer || viewModel.assistantMessage.headline}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主组件：AnalysisConversationShell
// ---------------------------------------------------------------------------

export type AnalysisConversationShellProps = {
  viewModel: AnalysisConversationViewModel;
  /** 多轮追问线程（当存在 2+ 轮时由父层构建），提供后替代单条 viewModel 渲染 */
  thread?: ConversationThreadViewModel;
  drawerContents: Record<string, ReactNode>;
  children?: ReactNode;
};

export function AnalysisConversationShell({
  viewModel,
  thread,
  drawerContents,
  children,
}: AnalysisConversationShellProps) {
  const [activeDrawer, setActiveDrawer] = useState<DetailDrawerType>(null);
  const activeTurnRef = useRef<HTMLDivElement>(null);

  // 线程 activeTurnId 变化时自动滚动到当前轮次
  useEffect(() => {
    activeTurnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [thread?.activeTurnId]);

  const handleOpenDetail = useCallback((drawer: DetailDrawerType) => {
    setActiveDrawer(drawer);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setActiveDrawer(null);
  }, []);

  const turns = thread?.turns;

  return (
    <>
      <div className="mx-auto w-full max-w-[860px] space-y-6 px-4">
        {turns ? (
          turns.map((turn) => (
            <div
              key={turn.executionId}
              ref={turn.isExpanded ? activeTurnRef : undefined}
            >
              <AnalysisUserMessage
                questionText={turn.viewModel.userMessage.questionText}
                badges={turn.viewModel.userMessage.badges}
              />
              {turn.isExpanded ? (
                <AnalysisAssistantMessage
                  status={turn.viewModel.assistantMessage.status}
                  headline={turn.viewModel.assistantMessage.headline}
                  progressLabel={turn.viewModel.assistantMessage.progressLabel}
                  toolActivities={turn.viewModel.assistantMessage.toolActivities}
                  result={turn.viewModel.assistantMessage.result}
                  diagnostics={turn.viewModel.assistantMessage.diagnostics}
                  primaryAnswer={turn.viewModel.assistantMessage.primaryAnswer}
                  metricCards={turn.viewModel.assistantMessage.metricCards}
                  visualizations={turn.viewModel.assistantMessage.visualizations}
                  toolTimeline={turn.viewModel.assistantMessage.toolTimeline}
                  onOpenDetail={handleOpenDetail}
                />
              ) : (
                <CollapsedTurnSummary viewModel={turn.viewModel} />
              )}
            </div>
          ))
        ) : (
          <>
            {/* 用户消息 */}
            <AnalysisUserMessage
              questionText={viewModel.userMessage.questionText}
              badges={viewModel.userMessage.badges}
            />

            {/* 助手消息 */}
            <AnalysisAssistantMessage
              status={viewModel.assistantMessage.status}
              headline={viewModel.assistantMessage.headline}
              progressLabel={viewModel.assistantMessage.progressLabel}
              toolActivities={viewModel.assistantMessage.toolActivities}
              result={viewModel.assistantMessage.result}
              diagnostics={viewModel.assistantMessage.diagnostics}
              primaryAnswer={viewModel.assistantMessage.primaryAnswer}
              metricCards={viewModel.assistantMessage.metricCards}
              visualizations={viewModel.assistantMessage.visualizations}
              toolTimeline={viewModel.assistantMessage.toolTimeline}
              onOpenDetail={handleOpenDetail}
            />
          </>
        )}

        {/* 追问入口（由外部 children 注入） */}
        {children}
      </div>

      {/* 详情抽屉 */}
      {activeDrawer ? (
        <AnalysisDetailDrawer
          drawerType={activeDrawer}
          content={drawerContents[activeDrawer] ?? null}
          onClose={handleCloseDrawer}
        />
      ) : null}
    </>
  );
}
