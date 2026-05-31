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
};

export type AnalysisConversationViewModel = {
  userMessage: ConversationUserMessage;
  assistantMessage: ConversationAssistantMessage;
};

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
      return input.statusBannerMessage ?? '任务已提交，等待 worker 接单';
    case 'running':
      if (input.currentStepTitle) return `正在执行：${input.currentStepTitle}`;
      return input.statusBannerMessage ?? '正在分析中';
    case 'completed':
      return '分析完成';
    case 'failed':
      return '执行遇到问题';
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
    for (const block of event.renderBlocks) {
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

    return {
      userMessage,
      assistantMessage: {
        status,
        headline: resolveStatusHeadline({ status }),
        toolActivities: extractToolActivities(events),
        result: null,
        diagnostics: {
          eventCount: events.length,
          lastSequence: events.at(-1)?.sequence ?? 0,
          timelineBlocks: [],
          processBoardBlocks: [],
          renderErrors: [],
          otherBlocks: [],
        },
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

  return {
    userMessage,
    assistantMessage: {
      status,
      headline,
      progressLabel,
      toolActivities,
      result: resultSection,
      diagnostics: {
        executionId: projection.executionId,
        eventCount: events.length,
        lastSequence: projection.lastSequence,
        timelineBlocks,
        processBoardBlocks: diagnosticBlocks,
        renderErrors: renderErrorBlocks,
        otherBlocks,
      },
    },
  };
}
