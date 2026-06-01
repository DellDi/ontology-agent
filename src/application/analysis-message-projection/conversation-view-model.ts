/**
 * Conversation View Model — 面向业务用户的主聊天窗口视图模型。
 *
 * 职责：把 AiRuntimeProjection（工程向的交互投影）重新分类为
 * "用户消息 + 助手消息（状态 / 工具活动 / 结果 / 诊断）"的对话结构，
 * 使 React 层不需要理解 part kind / slot / evidence-card 等工程概念。
 *
 * 约束：
 *   - 纯函数，不依赖 React / DOM / 副作用。
 *   - 不引入新的事实源；所有数据从 projection + session 元数据派生。
 *   - 不修改 domain block schema 或 application renderer registry。
 */

import type {
  AiRuntimeEvidenceCardPart,
  AiRuntimeMessagePart,
  AiRuntimeProjection,
  AiRuntimeStatusBannerPart,
  AiRuntimeStepTimelinePart,
} from '@/application/ai-runtime';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import {
  normalizeExecutionRenderBlock,
  renderAnalysisInteractionPart,
} from '@/application/analysis-interaction';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import { translateToolName } from './tool-name-translations';

// Re-export so existing imports (e.g. analysis-step-timeline.tsx) keep working.
export { translateToolName } from './tool-name-translations';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type ConversationBadgeTone = 'neutral' | 'info';

export type ConversationBadge = {
  label: string;
  tone: ConversationBadgeTone;
};

export type ConversationUserMessageMetadata = {
  intentLabel?: string;
  ontologyVersion?: string;
  followUpLabel?: string;
};

export type ConversationUserMessage = {
  questionText: string;
  badges: ConversationBadge[];
  metadata: ConversationUserMessageMetadata;
};

export type ConversationAssistantStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'disconnected';

export type ToolActivitySummary = {
  toolName: string;
  objective: string;
  status: 'selected' | 'running' | 'completed' | 'failed';
};

export type ConversationResultSection = {
  /** 结论主标题 */
  headline?: string;
  /** 结论摘要（reasoning-summary 或 conclusion markdown） */
  summary?: string;
  /** 排名原因、指标卡、图表、表格等结果块 */
  blocks: AnalysisRenderedBlock[];
  /** 证据摘要（evidence-card 渲染后） */
  evidenceBlocks: AnalysisRenderedBlock[];
  /** 假设与口径（assumption-card） */
  assumptionBlocks: AnalysisRenderedBlock[];
  /** 分析依据（reasoning-summary 在有结论时降级到此） */
  reasoningBlocks: AnalysisRenderedBlock[];
};

export type ConversationDiagnostics = {
  /** 执行 ID（仅诊断入口显示） */
  executionId?: string;
  /** 事件总数 */
  eventCount: number;
  /** 最近事件序号 */
  lastSequence: number;
  /** 步骤时间线（渲染后） */
  timelineBlocks: AnalysisRenderedBlock[];
  /** 流程看板（渲染后） */
  processBoardBlocks: AnalysisRenderedBlock[];
  /** 渲染异常的 block（fail-loud 诊断） */
  renderErrors: AnalysisRenderedBlock[];
  /** 其余未分类块 */
  otherBlocks: AnalysisRenderedBlock[];
};

// ---------------------------------------------------------------------------
// 业务向视图类型（Story 12-3：Conversation View Model V2）
//
// 这些类型面向业务用户，用于在聊天界面中呈现"一句话答案 / 指标卡 /
// 可视化 / 步骤时间线 / 诊断 / 假设"等直观信息，
// 使业务用户完全不需要理解工程概念（job / worker / execution / tool name）。
// ---------------------------------------------------------------------------

export type MetricCardTrend = 'up' | 'down' | 'stable';

export type MetricCard = {
  label: string;
  value: string;
  unit?: string;
  trend?: MetricCardTrend;
  trendLabel?: string;
};

export type VisualizationType = 'chart' | 'graph' | 'table';

export type Visualization = {
  type: VisualizationType;
  title: string;
  /** 可渲染数据（与 AnalysisRenderedBlock.payload 对齐） */
  data: unknown;
  /** 一行说明，便于业务用户快速理解 */
  summary?: string;
};

export type SubStepEntry = {
  /** 内部工具名（默认隐藏） */
  toolName: string;
  /** 业务向工具标签（例如"数据查询"） */
  toolLabel?: string;
  /** 业务向目标描述 */
  objective: string;
  status: 'running' | 'completed' | 'failed';
  result?: string;
  /** 耗时（人话格式，例如"1.2秒"） */
  duration?: string;
  /** 工具输入参数（展开可见） */
  input?: Record<string, unknown>;
  /** 工具输出结果（展开可见） */
  output?: Record<string, unknown>;
  /** 错误信息 */
  error?: string;
};

export type ToolTimelineEntryStatus = 'running' | 'completed' | 'failed';

export type ToolTimelineEntry = {
  stepId: string;
  /** 业务语言步骤名（例如"查询物业费数据"） */
  stepName: string;
  status: ToolTimelineEntryStatus;
  /** 人话耗时（例如 "2.3秒"） */
  duration?: string;
  /** 可展开详情 */
  details?: string;
  subSteps: SubStepEntry[];
};

export type DiagnosticInfo = {
  kind: string;
  label: string;
  details: string;
};

export type ConversationAssistantMessage = {
  status: ConversationAssistantStatus;
  /** 一句话人话状态 */
  headline: string;
  /** 进度标签，例如 "3/5 步已完成" */
  progressLabel?: string;
  /** 工具调用紧凑状态条 */
  toolActivities: ToolActivitySummary[];
  /** 最终结果（执行完成后可用） */
  result: ConversationResultSection | null;
  /** 诊断信息（默认隐藏） */
  diagnostics: ConversationDiagnostics;

  // -- Story 12-3 新增：面向业务用户的视图字段 --

  /** 一句话业务答案（来自结论或推理摘要） */
  primaryAnswer: string;
  /** 关键指标卡 */
  metricCards: MetricCard[];
  /** 图表 / 图形 / 表格 */
  visualizations: Visualization[];
  /** 可折叠步骤时间线（业务语言） */
  toolTimeline: ToolTimelineEntry[];
  /** 仅在诊断抽屉中展示的信息 */
  hiddenDiagnostics: DiagnosticInfo[];
  /** 简化后的假设摘要 */
  assumptionSummary: string[];
};

export type AnalysisConversationViewModel = {
  userMessage: ConversationUserMessage;
  assistantMessage: ConversationAssistantMessage;
};

// ---------------------------------------------------------------------------
// 翻译层：工程术语 → 业务语言
// ---------------------------------------------------------------------------

/** 把执行事件 kind 翻译为业务语言标签。 */
export function translateStepStatus(status: string): string {
  const translations: Record<string, string> = {
    'execution-status': '执行状态',
    'step-lifecycle': '步骤进度',
    'stage-result': '阶段结果',
    'step-started': '步骤开始',
    'tool-started': '工具调用中',
    'tool-completed': '工具完成',
    'tool-failed': '工具失败',
    'step-completed': '步骤完成',
  };
  return translations[status] ?? status;
}

// ---------------------------------------------------------------------------
// 分类规则
// ---------------------------------------------------------------------------

const RESULT_BLOCK_KINDS = new Set([
  'chart',
  'table',
  'graph',
  'kv-list',
  'markdown',
  'status',
]);

const EVIDENCE_BLOCK_KINDS = new Set(['evidence-card']);
const ASSUMPTION_BLOCK_KINDS = new Set(['assumption-card']);
const REASONING_BLOCK_KINDS = new Set(['reasoning-summary']);
const DIAGNOSTIC_BLOCK_KINDS = new Set(['process-board', 'timeline']);
const OPERATIONAL_BLOCK_TITLES = new Set([
  '执行状态',
  '执行元数据',
  '状态说明',
  '执行进度',
  '当前步骤',
  '阶段状态',
  '阶段结果',
  '平台能力状态',
  'ERP 读取结果',
]);

function classifyRenderedBlock(
  block: AnalysisRenderedBlock,
): 'result' | 'evidence' | 'assumption' | 'reasoning' | 'diagnostic' | 'other' {
  if (block.title && OPERATIONAL_BLOCK_TITLES.has(block.title)) {
    return 'diagnostic';
  }
  if (EVIDENCE_BLOCK_KINDS.has(block.kind)) return 'evidence';
  if (ASSUMPTION_BLOCK_KINDS.has(block.kind)) return 'assumption';
  if (REASONING_BLOCK_KINDS.has(block.kind)) return 'reasoning';
  if (DIAGNOSTIC_BLOCK_KINDS.has(block.kind)) return 'diagnostic';
  if (RESULT_BLOCK_KINDS.has(block.kind)) return 'result';
  return 'other';
}

// ---------------------------------------------------------------------------
// 状态映射
// ---------------------------------------------------------------------------

function resolveStatusFromEvents(
  events: readonly AnalysisExecutionStreamEvent[],
): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind === 'execution-status' && event.status) {
      return event.status;
    }
  }
  return 'processing';
}

function resolveAssistantStatus(input: {
  projectionStatus: string;
  hasEvents: boolean;
  hasConnectionIssue: boolean;
}): ConversationAssistantStatus {
  // 终态（completed/failed）优先于断流：任务已经结束时，SSE 后续 error 不应覆盖结果。
  switch (input.projectionStatus) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
  }

  if (input.hasConnectionIssue) return 'disconnected';
  if (!input.hasEvents) return 'queued';

  switch (input.projectionStatus) {
    case 'processing':
    case 'running':
      return 'running';
    default:
      return 'queued';
  }
}

function resolveStatusHeadline(input: {
  status: ConversationAssistantStatus;
  statusBannerMessage?: string;
  currentStepTitle?: string;
}): string {
  switch (input.status) {
    case 'queued':
      return input.statusBannerMessage ?? '问题已提交，正在准备分析';
    case 'running':
      if (input.currentStepTitle) return `正在${input.currentStepTitle}`;
      return input.statusBannerMessage ?? '正在为您分析';
    case 'completed':
      return '分析完成';
    case 'failed':
      return '分析过程中遇到问题';
    case 'disconnected':
      return '实时连接中断，结果可能仍在后台继续生成';
  }
}

// ---------------------------------------------------------------------------
// 工具活动提取
// ---------------------------------------------------------------------------

function extractToolActivities(
  events: readonly AnalysisExecutionStreamEvent[],
): ToolActivitySummary[] {
  // 使用 Map 按 key 保留最后出现的状态（按事件顺序覆盖），
  // 确保 running → completed/failed 能正确反映到工具活动条。
  const byKey = new Map<string, ToolActivitySummary>();

  for (const event of events) {
    for (const block of event.renderBlocks ?? []) {
      if (block.type !== 'tool-list') continue;

      for (const item of block.items) {
        const key = `${item.toolName}::${item.objective}`;
        byKey.set(key, {
          toolName: item.toolName,
          objective: item.objective,
          status: item.status,
        });
      }
    }
  }

  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// 进度标签
// ---------------------------------------------------------------------------

function resolveProgressLabel(
  events: readonly AnalysisExecutionStreamEvent[],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const metadata = event.metadata as
      | {
          processedStepCount?: unknown;
          totalStepCount?: unknown;
          processBoardProgress?: {
            processed?: unknown;
            total?: unknown;
          };
        }
      | undefined;
    const processed =
      typeof metadata?.processedStepCount === 'number'
        ? metadata.processedStepCount
        : typeof metadata?.processBoardProgress?.processed === 'number'
          ? metadata.processBoardProgress.processed
          : null;
    const total =
      typeof metadata?.totalStepCount === 'number'
        ? metadata.totalStepCount
        : typeof metadata?.processBoardProgress?.total === 'number'
          ? metadata.processBoardProgress.total
          : null;

    if (processed !== null && total !== null && total > 0) {
      return `${processed}/${total} 步已完成`;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Part 提取辅助
// ---------------------------------------------------------------------------

function findPartByKind<T extends AiRuntimeMessagePart>(
  parts: readonly AiRuntimeMessagePart[],
  kind: string,
): T | null {
  for (const part of parts) {
    if (part.kind === kind) return part as T;
  }
  return null;
}

type RenderEvidenceResult = {
  rendered: AnalysisRenderedBlock[];
  errors: AnalysisRenderedBlock[];
};

function renderEvidenceBlocks(
  evidenceParts: readonly AiRuntimeEvidenceCardPart[],
  events: readonly AnalysisExecutionStreamEvent[],
): RenderEvidenceResult {
  const rendered: AnalysisRenderedBlock[] = [];
  const errors: AnalysisRenderedBlock[] = [];

  // 构建 event kind 查找表，用于过滤 execution-status 事件的工程状态块
  const eventKindById = new Map<string, string>();
  for (const event of events) {
    eventKindById.set(event.id, event.kind);
  }

  for (const evidencePart of evidenceParts) {
    // execution-status 事件的 renderBlocks 是工程状态信号（已由 status-banner 承接），
    // 不应作为业务结果块出现在主聊天消息中。
    const sourceEventKind = eventKindById.get(evidencePart.sourceEventId);
    if (sourceEventKind === 'execution-status') continue;

    for (const block of evidencePart.blocks) {
      const source = {
        sourceType: 'execution-render-block' as const,
        sessionId: undefined,
        executionId: undefined,
        eventId: evidencePart.sourceEventId,
        sequence: evidencePart.sequence,
        blockIndex: 0,
      };
      try {
        const normalized = normalizeExecutionRenderBlock(block, source);
        const renderedBlock = renderAnalysisInteractionPart(normalized, {
          surface: 'workspace',
        });
        rendered.push(renderedBlock);
      } catch (error) {
        // 渲染失败的 block 转为可见诊断块，保留错误上下文，
        // 遵守项目 fail-loud / diagnosable 规范。
        errors.push({
          kind: 'render-error',
          surface: 'workspace',
          title: '渲染异常',
          label: '渲染异常',
          variant: 'render-error',
          source,
          payload: {
            originalBlockType:
              block && typeof block === 'object' && 'type' in block
                ? String(block.type)
                : 'unknown',
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
          diagnostics: {
            originalType: 'render-error',
            notes: [
              `block type: ${
                block && typeof block === 'object' && 'type' in block
                  ? String(block.type)
                  : 'unknown'
              }`,
              `sequence: ${evidencePart.sequence}`,
            ],
          },
        });
      }
    }
  }
  return { rendered, errors };
}

function renderStepTimelinePart(
  part: AiRuntimeStepTimelinePart | null,
): AnalysisRenderedBlock[] {
  if (!part) return [];

  // 把 step-timeline 包装为一个 timeline rendered block
  return [
    {
      kind: 'timeline',
      surface: 'workspace',
      title: '执行时间线',
      label: '执行时间线',
      variant: 'timeline',
      source: {
        sourceType: 'runtime-foundation-part',
        eventId: part.id,
      },
      payload: {
        items: part.steps.map((step) => ({
          id: step.id,
          title: step.title,
          status: step.status,
          summary: '',
        })),
      },
      diagnostics: {
        originalType: 'step-timeline',
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Story 12-3：业务向视图提取
// ---------------------------------------------------------------------------

/** 已知非业务指标的 kv-list 标题，defense-in-depth：即使分类层遗漏也不应进入指标卡。 */
const NON_METRIC_KV_LIST_TITLES = new Set([
  'ERP 读取结果',
  '平台能力状态',
  '执行状态',
  '执行元数据',
]);

/** 从 kv-list 与 metric chart 中提取指标卡。 */
function extractMetricCards(
  blocks: readonly AnalysisRenderedBlock[],
): MetricCard[] {
  const cards: MetricCard[] = [];

  for (const block of blocks) {
    if (block.kind === 'kv-list') {
      // defense-in-depth：跳过运营 / 状态类 kv-list，避免污染业务指标卡
      if (block.title && NON_METRIC_KV_LIST_TITLES.has(block.title)) continue;

      const items = Array.isArray(block.payload?.items)
        ? (block.payload.items as { label: string; value: string }[])
        : [];
      for (const item of items) {
        if (!item.label || !item.value) continue;
        cards.push({
          label: item.label,
          value: item.value,
        });
      }
      continue;
    }

    // chartType === 'metric' 的 chart 块 → 单张指标卡
    if (block.kind === 'chart' && block.payload?.chartType === 'metric') {
      const series = Array.isArray(block.payload.series)
        ? (block.payload.series as {
            name: string;
            points: { label: string; value: number }[];
          }[])
        : [];
      for (const serie of series) {
        const point = serie.points?.[0];
        if (!point) continue;
        cards.push({
          label: serie.name || block.title || '指标',
          value: String(point.value),
          unit: typeof block.payload?.unit === 'string' ? block.payload.unit : undefined,
        });
      }
    }
  }

  return cards;
}

/** 从 chart / graph / table 块中提取可视化（metric chart 除外）。 */
function extractVisualizations(
  blocks: readonly AnalysisRenderedBlock[],
): Visualization[] {
  const visualizations: Visualization[] = [];

  for (const block of blocks) {
    if (block.kind === 'chart' && block.payload?.chartType !== 'metric') {
      visualizations.push({
        type: 'chart',
        title: block.title || '图表',
        data: block.payload,
        summary:
          typeof block.payload?.summary === 'string'
            ? block.payload.summary
            : undefined,
      });
      continue;
    }

    if (block.kind === 'graph') {
      visualizations.push({
        type: 'graph',
        title: block.title || '关系图',
        data: block.payload,
        summary:
          typeof block.payload?.summary === 'string'
            ? block.payload.summary
            : undefined,
      });
      continue;
    }

    if (block.kind === 'table') {
      visualizations.push({
        type: 'table',
        title: block.title || '表格',
        data: block.payload,
        summary:
          typeof block.payload?.summary === 'string'
            ? block.payload.summary
            : undefined,
      });
    }
  }

  return visualizations;
}

/** Story 12-5: 把毫秒数格式化为人话耗时。 */
export function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}秒`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}分${seconds}秒`;
}

/** 从 step-timeline part 与事件流（含 Story 12-5 新事件）构建可折叠步骤时间线。 */
function buildToolTimeline(input: {
  stepTimelinePart: AiRuntimeStepTimelinePart | null;
  events: readonly AnalysisExecutionStreamEvent[];
}): ToolTimelineEntry[] {
  const { stepTimelinePart, events } = input;

  // 兜底 bucket key：当没有显式 step id 时，tool-list 项归入此桶
  const FALLBACK_BUCKET = '__unattributed__';

  // 按 id 维护步骤条目（保留首次出现顺序）
  const stepEntries = new Map<string, ToolTimelineEntry>();
  const stepOrder: string[] = [];

  const ensureStepEntry = (
    stepId: string,
    stepName: string,
    status: ToolTimelineEntryStatus,
  ): ToolTimelineEntry => {
    let entry = stepEntries.get(stepId);
    if (!entry) {
      entry = { stepId, stepName, status, subSteps: [] };
      stepEntries.set(stepId, entry);
      stepOrder.push(stepId);
    } else {
      entry.stepName = stepName || entry.stepName;
    }
    return entry;
  };

  // 从 step-timeline part 预填步骤顺序（最权威）
  if (stepTimelinePart && stepTimelinePart.steps.length > 0) {
    for (const step of stepTimelinePart.steps) {
      ensureStepEntry(step.id, step.title, step.status);
    }
  }

  // 按事件顺序维护"当前 step"指针
  let currentStepId: string | null = stepOrder[0] ?? null;

  for (const event of events) {
    const stepId = event.step?.id;
    if (stepId) {
      currentStepId = stepId;
    }

    switch (event.kind) {
      // -- Story 12-5: 细粒度实时事件 --
      case 'step-started': {
        if (!event.step) break;
        const entry = ensureStepEntry(
          event.step.id,
          event.step.title,
          'running',
        );
        entry.status = 'running';
        currentStepId = event.step.id;
        break;
      }

      case 'tool-started': {
        if (!event.tool) break;
        const bucketKey = currentStepId ?? FALLBACK_BUCKET;
        const entry = ensureStepEntry(
          bucketKey,
          event.step?.title ?? '分析步骤',
          'running',
        );
        entry.subSteps.push({
          toolName: event.tool.name,
          toolLabel: event.tool.label,
          objective: event.tool.label,
          status: 'running',
          input: event.tool.input,
        });
        break;
      }

      case 'tool-completed': {
        if (!event.tool) break;
        const bucketKey = currentStepId ?? FALLBACK_BUCKET;
        const entry = stepEntries.get(bucketKey);
        if (!entry) break;
        // 找到最后一个同名且状态为 running 的子步骤
        const subStep = [...entry.subSteps]
          .reverse()
          .find(
            (s) => s.toolName === event.tool!.name && s.status === 'running',
          );
        if (subStep) {
          subStep.status = 'completed';
          subStep.output = event.tool.output;
          if (typeof event.tool.durationMs === 'number') {
            subStep.duration = formatDurationMs(event.tool.durationMs);
          }
        }
        break;
      }

      case 'tool-failed': {
        if (!event.tool) break;
        const bucketKey = currentStepId ?? FALLBACK_BUCKET;
        const entry = stepEntries.get(bucketKey);
        if (!entry) break;
        const subStep = [...entry.subSteps]
          .reverse()
          .find(
            (s) => s.toolName === event.tool!.name && s.status === 'running',
          );
        if (subStep) {
          subStep.status = 'failed';
          subStep.error = event.tool.error;
          if (typeof event.tool.durationMs === 'number') {
            subStep.duration = formatDurationMs(event.tool.durationMs);
          }
        }
        break;
      }

      case 'step-completed': {
        if (!event.step) break;
        const entry = stepEntries.get(event.step.id);
        if (!entry) break;
        entry.status = event.step.status;
        if (typeof event.step.durationMs === 'number') {
          entry.duration = formatDurationMs(event.step.durationMs);
        }
        if (typeof event.step.toolCount === 'number') {
          entry.details = `${event.step.toolCount} 个工具调用`;
        }
        break;
      }

      // -- 既有事件兼容 --
      case 'step-lifecycle':
      case 'stage-result':
      default: {
        if (event.step) {
          ensureStepEntry(event.step.id, event.step.title, event.step.status);
        }

        const renderBlocks = event.renderBlocks ?? [];
        for (const block of renderBlocks) {
          if (block.type !== 'tool-list') continue;
          const bucketKey = currentStepId ?? FALLBACK_BUCKET;
          const entry = ensureStepEntry(
            bucketKey,
            event.step?.title ?? '分析步骤',
            event.step?.status ?? 'running',
          );
          for (const item of block.items) {
            entry.subSteps.push({
              toolName: item.toolName,
              toolLabel: translateToolName(item.toolName),
              objective: item.objective,
              status: item.status === 'selected' ? 'running' : item.status,
            });
          }
        }
        break;
      }
    }
  }

  // 按插入顺序输出
  if (stepOrder.length > 0) {
    return stepOrder
      .map((id) => stepEntries.get(id))
      .filter((entry): entry is ToolTimelineEntry => entry !== undefined);
  }

  // 没有任何 step 信息时，把所有 sub-steps 汇总为"分析步骤"
  const flatSubSteps: SubStepEntry[] = [];
  for (const entry of stepEntries.values()) {
    flatSubSteps.push(...entry.subSteps);
  }
  if (flatSubSteps.length === 0) return [];

  const overallStatus: ToolTimelineEntryStatus = flatSubSteps.some(
    (s) => s.status === 'running',
  )
    ? 'running'
    : flatSubSteps.some((s) => s.status === 'failed')
      ? 'failed'
      : 'completed';

  return [
    {
      stepId: 'summary',
      stepName: '分析步骤',
      status: overallStatus,
      subSteps: flatSubSteps,
    },
  ];
}

/** 从分类后的诊断块构建 DiagnosticInfo 列表（进入诊断抽屉）。 */
function buildHiddenDiagnostics(input: {
  processBoardBlocks: AnalysisRenderedBlock[];
  timelineBlocks: AnalysisRenderedBlock[];
  renderErrors: AnalysisRenderedBlock[];
  otherBlocks: AnalysisRenderedBlock[];
}): DiagnosticInfo[] {
  const diagnostics: DiagnosticInfo[] = [];

  for (const block of input.processBoardBlocks) {
    diagnostics.push({
      kind: block.kind,
      label: block.title || '流程状态',
      details:
        typeof block.payload === 'object' && block.payload !== null
          ? JSON.stringify(block.payload)
          : String(block.payload ?? ''),
    });
  }

  for (const block of input.timelineBlocks) {
    diagnostics.push({
      kind: block.kind,
      label: block.title || '时间线',
      details:
        typeof block.payload === 'object' && block.payload !== null
          ? JSON.stringify(block.payload)
          : String(block.payload ?? ''),
    });
  }

  for (const block of input.renderErrors) {
    diagnostics.push({
      kind: 'render-error',
      label: block.title || '渲染异常',
      details:
        typeof block.payload?.errorMessage === 'string'
          ? block.payload.errorMessage
          : '渲染过程中发生异常',
    });
  }

  for (const block of input.otherBlocks) {
    diagnostics.push({
      kind: block.kind,
      label: block.title || '其他信息',
      details:
        typeof block.payload === 'object' && block.payload !== null
          ? JSON.stringify(block.payload)
          : String(block.payload ?? ''),
    });
  }

  return diagnostics;
}

/** 从结论或推理块中抽取一句话业务答案。 */
function resolvePrimaryAnswer(input: {
  resultSection: ConversationResultSection | null;
  conclusionHeadline?: string;
  conclusionSummary?: string;
}): string {
  if (input.conclusionSummary) {
    return input.conclusionSummary;
  }
  if (input.conclusionHeadline) {
    return input.conclusionHeadline;
  }
  if (input.resultSection?.summary) {
    return input.resultSection.summary;
  }
  // 尝试从 reasoning block 提取第一行内容
  const reasoningBlocks = input.resultSection?.reasoningBlocks ?? [];
  for (const block of reasoningBlocks) {
    if (typeof block.payload?.content === 'string' && block.payload.content) {
      return block.payload.content;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export type BuildConversationViewModelInput = {
  questionText: string;
  intentLabel?: string;
  ontologyVersion?: string;
  followUpLabel?: string;
  projection: AiRuntimeProjection | null;
  events: readonly AnalysisExecutionStreamEvent[];
  hasConnectionIssue: boolean;
  /** 执行计划声明的假设列表（审计信息，进入"假设与口径"折叠区） */
  planAssumptions?: readonly string[];
};

/**
 * 把 AiRuntimeProjection + session 元数据映射为 AnalysisConversationViewModel。
 *
 * 分类规则：
 *   - status-banner → assistant headline + status
 *   - step-timeline → diagnostics（默认隐藏）
 *   - evidence-card → 按内部 block kind 分类
 *     - tool-list → toolActivities
 *     - chart / table / graph / kv-list / markdown / status → result blocks
 *     - evidence-card → evidence blocks
 *     - reasoning-summary → reasoning blocks（有结论时）或 result summary
 *     - assumption-card → assumption blocks
 *   - conclusion-card → result headline + 结论 blocks
 *   - resume-anchor → 不渲染，只用于续流
 */
export function buildConversationViewModel(
  input: BuildConversationViewModelInput,
): AnalysisConversationViewModel {
  const { questionText, projection, events, hasConnectionIssue } = input;

  // -- User message --
  const badges: ConversationBadge[] = [];
  if (input.intentLabel) {
    badges.push({ label: input.intentLabel, tone: 'info' });
  }
  if (input.followUpLabel) {
    badges.push({ label: input.followUpLabel, tone: 'neutral' });
  }
  if (input.ontologyVersion) {
    badges.push({ label: input.ontologyVersion, tone: 'neutral' });
  }

  const userMessage: ConversationUserMessage = {
    questionText,
    badges,
    metadata: {
      intentLabel: input.intentLabel,
      ontologyVersion: input.ontologyVersion,
      followUpLabel: input.followUpLabel,
    },
  };

  // -- 无 projection 时的降级 --
  if (!projection) {
    // 终态优先：从事件推断 status，再判断是否断流
    const latestStatus = resolveStatusFromEvents(events);
    let status: ConversationAssistantStatus;
    if (latestStatus === 'completed' || latestStatus === 'failed') {
      status = latestStatus === 'completed' ? 'completed' : 'failed';
    } else if (hasConnectionIssue) {
      status = 'disconnected';
    } else if (events.length === 0) {
      status = 'queued';
    } else {
      status = 'running';
    }

    const fallbackDiagnostics: ConversationDiagnostics = {
      eventCount: events.length,
      lastSequence: events.at(-1)?.sequence ?? 0,
      timelineBlocks: [],
      processBoardBlocks: [],
      renderErrors: [],
      otherBlocks: [],
    };

    return {
      userMessage,
      assistantMessage: {
        status,
        headline: resolveStatusHeadline({ status }),
        toolActivities: extractToolActivities(events),
        result: null,
        diagnostics: fallbackDiagnostics,
        primaryAnswer: '',
        metricCards: [],
        visualizations: [],
        toolTimeline: buildToolTimeline({ stepTimelinePart: null, events }),
        hiddenDiagnostics: buildHiddenDiagnostics({
          processBoardBlocks: fallbackDiagnostics.processBoardBlocks,
          timelineBlocks: fallbackDiagnostics.timelineBlocks,
          renderErrors: fallbackDiagnostics.renderErrors,
          otherBlocks: fallbackDiagnostics.otherBlocks,
        }),
        assumptionSummary: input.planAssumptions
          ? [...input.planAssumptions]
          : [],
      },
    };
  }

  // -- 从 projection 提取 parts --
  const allParts = projection.messages.flatMap((msg) => msg.parts);
  const statusBanner = findPartByKind<AiRuntimeStatusBannerPart>(
    allParts,
    'status-banner',
  );
  const stepTimeline = findPartByKind<AiRuntimeStepTimelinePart>(
    allParts,
    'step-timeline',
  );
  const evidenceParts = allParts.filter(
    (p): p is AiRuntimeEvidenceCardPart => p.kind === 'evidence-card',
  );
  const conclusionPart = allParts.find((p) => p.kind === 'conclusion-card');

  // -- 状态解析 --
  const status = resolveAssistantStatus({
    projectionStatus: projection.status,
    hasEvents: events.length > 0,
    hasConnectionIssue,
  });

  // -- 从 evidence blocks 中分类渲染块 --
  const { rendered: renderedEvidenceBlocks, errors: renderErrorBlocks } =
    renderEvidenceBlocks(evidenceParts, events);
  const toolActivities = extractToolActivities(events);

  const resultBlocks: AnalysisRenderedBlock[] = [];
  const evidenceBlocks: AnalysisRenderedBlock[] = [];
  const assumptionBlocks: AnalysisRenderedBlock[] = [];
  const reasoningBlocks: AnalysisRenderedBlock[] = [];
  const diagnosticBlocks: AnalysisRenderedBlock[] = [];
  const otherBlocks: AnalysisRenderedBlock[] = [];

  for (const block of renderedEvidenceBlocks) {
    // tool-list 已经被提取为 toolActivities，不再作为 block 渲染
    if (block.kind === 'tool-list') continue;

    const category = classifyRenderedBlock(block);
    switch (category) {
      case 'result':
        resultBlocks.push(block);
        break;
      case 'evidence':
        evidenceBlocks.push(block);
        break;
      case 'assumption':
        assumptionBlocks.push(block);
        break;
      case 'reasoning':
        reasoningBlocks.push(block);
        break;
      case 'diagnostic':
        diagnosticBlocks.push(block);
        break;
      default:
        otherBlocks.push(block);
        break;
    }
  }

  // -- planAssumptions 审计信息：构建假设卡片进入"假设与口径"折叠区 --
  if (input.planAssumptions && input.planAssumptions.length > 0) {
    const planAssumptionBlock: AnalysisRenderedBlock = {
      kind: 'assumption-card',
      surface: 'workspace',
      title: '执行计划假设',
      label: '执行计划假设',
      variant: 'assumption-card',
      source: {
        sourceType: 'runtime-foundation-part',
        eventId: 'plan-assumptions',
      },
      payload: {
        assumptions: [...input.planAssumptions],
        note: '本轮执行计划所声明的前提假设。',
      },
      diagnostics: {
        originalType: 'assumption-card',
      },
    };
    assumptionBlocks.push(planAssumptionBlock);
  }

  // -- conclusion 解析 --
  let resultSection: ConversationResultSection | null = null;
  const hasConclusion = conclusionPart?.kind === 'conclusion-card';

  if (hasConclusion) {
    const conclusionReadModel =
      conclusionPart.kind === 'conclusion-card'
        ? conclusionPart.readModel
        : null;

    const conclusionHeadline =
      conclusionReadModel?.causes?.[0]?.title ?? '分析结论';
    const conclusionSummary =
      conclusionReadModel?.causes
        ?.map((cause) => `${cause.title}：${cause.summary}`)
        .join('\n') ?? '';

    // 如果有 conclusion，把 conclusion 信息作为结果主块
    const conclusionRenderedBlock: AnalysisRenderedBlock = {
      kind: 'conclusion-summary',
      surface: 'workspace',
      title: '分析结论',
      label: '分析结论',
      variant: 'conclusion-summary',
      source: {
        sourceType: 'conclusion-read-model',
      },
      payload: {
        headline: conclusionHeadline,
        summary: conclusionSummary,
        causes: conclusionReadModel?.causes ?? [],
      },
      diagnostics: {
        originalType: 'conclusion-card',
      },
    };

    resultSection = {
      headline: conclusionHeadline,
      summary: conclusionSummary,
      blocks: [conclusionRenderedBlock, ...resultBlocks],
      evidenceBlocks,
      assumptionBlocks,
      reasoningBlocks,
    };
  } else if (
    resultBlocks.length > 0 ||
    evidenceBlocks.length > 0 ||
    reasoningBlocks.length > 0 ||
    assumptionBlocks.length > 0
  ) {
    resultSection = {
      headline: undefined,
      summary: undefined,
      blocks: resultBlocks,
      evidenceBlocks,
      assumptionBlocks,
      reasoningBlocks,
    };
  }

  // -- 步骤时间线 --
  const timelineBlocks = renderStepTimelinePart(stepTimeline);

  // -- 当前步骤标题（用于 headline 推导） --
  const currentStepTitle = stepTimeline?.steps?.find(
    (step) => step.status === 'running',
  )?.title;

  const headline = resolveStatusHeadline({
    status,
    statusBannerMessage: statusBanner?.message ?? statusBanner?.label,
    currentStepTitle,
  });

  const progressLabel = resolveProgressLabel(events);

  const diagnostics: ConversationDiagnostics = {
    executionId: projection.executionId,
    eventCount: events.length,
    lastSequence: projection.lastSequence,
    timelineBlocks,
    processBoardBlocks: diagnosticBlocks,
    renderErrors: renderErrorBlocks,
    otherBlocks,
  };

  // -- Story 12-3：业务向视图字段 --
  const primaryAnswer = resolvePrimaryAnswer({
    resultSection: resultSection,
    conclusionHeadline: resultSection?.headline,
    conclusionSummary: resultSection?.summary,
  });

  // 从结果块中收集可用于指标卡与可视化的原始块
  const allResultBlocks: AnalysisRenderedBlock[] = [
    ...(resultSection?.blocks ?? []),
    ...(resultSection?.evidenceBlocks ?? []),
  ];
  const metricCards = extractMetricCards(allResultBlocks);
  const visualizations = extractVisualizations(allResultBlocks);

  const toolTimeline = buildToolTimeline({
    stepTimelinePart: stepTimeline,
    events,
  });

  const hiddenDiagnostics = buildHiddenDiagnostics({
    processBoardBlocks: diagnostics.processBoardBlocks,
    timelineBlocks: diagnostics.timelineBlocks,
    renderErrors: diagnostics.renderErrors,
    otherBlocks: diagnostics.otherBlocks,
  });

  const assumptionSummary = input.planAssumptions
    ? [...input.planAssumptions]
    : [];

  return {
    userMessage,
    assistantMessage: {
      status,
      headline,
      progressLabel,
      toolActivities,
      result: resultSection,
      diagnostics,
      primaryAnswer,
      metricCards,
      visualizations,
      toolTimeline,
      hiddenDiagnostics,
      assumptionSummary,
    },
  };
}
