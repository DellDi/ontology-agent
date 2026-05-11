import type {
  AnalysisExecutionStreamEvent,
  ExecutionRenderBlock,
  ExecutionRenderBlockType,
} from '@/domain/analysis-execution/stream-models';
import { EXECUTION_RENDER_BLOCK_TYPES } from '@/domain/analysis-execution/stream-models';

export const ANALYSIS_INTERACTION_PART_SCHEMA_VERSION = 1 as const;

export const ANALYSIS_INTERACTION_SURFACES = ['workspace', 'mobile'] as const;
export type AnalysisInteractionSurface =
  (typeof ANALYSIS_INTERACTION_SURFACES)[number];

export const ANALYSIS_INTERACTION_PART_KINDS = [
  'process-board',
  'status',
  'kv-list',
  'tool-list',
  'markdown',
  'reasoning-summary',
  'table',
  'chart',
  'graph',
  'evidence-card',
  'timeline',
  'assumption-card',
  'approval-state',
  'skills-state',
] as const;
export type AnalysisInteractionPartKind =
  (typeof ANALYSIS_INTERACTION_PART_KINDS)[number];

export type AnalysisInteractionPartSource = {
  sourceType:
    | 'execution-render-block'
    | 'runtime-foundation-part'
    | 'conclusion-read-model';
  sessionId?: string;
  executionId?: string;
  eventId?: string;
  sequence?: number;
  blockIndex?: number;
};

export type AnalysisInteractionSurfaceHints = {
  supportedSurfaces: AnalysisInteractionSurface[];
};

export type AnalysisInteractionPartProjection = {
  surface: AnalysisInteractionSurface;
  density: 'full' | 'compact';
};

export type AnalysisInteractionPartDiagnostics = {
  originalType: string;
  originalSource?: AnalysisInteractionPartSource;
  notes?: string[];
};

export type AnalysisInteractionPart = {
  id: string;
  kind: AnalysisInteractionPartKind | string;
  version: number;
  source: AnalysisInteractionPartSource;
  surfaceHints: AnalysisInteractionSurfaceHints;
  projection: AnalysisInteractionPartProjection;
  title?: string;
  label?: string;
  payload: Record<string, unknown>;
  diagnostics: AnalysisInteractionPartDiagnostics;
};

export class InvalidAnalysisInteractionPartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAnalysisInteractionPartError';
  }
}

function assertObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidAnalysisInteractionPartError(`${fieldName} 必须是对象。`);
  }

  return value as Record<string, unknown>;
}

function assertString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidAnalysisInteractionPartError(`${fieldName} 必须是非空字符串。`);
  }

  return value.trim();
}

function isKnownExecutionRenderBlockType(
  kind: string,
): kind is ExecutionRenderBlockType {
  return EXECUTION_RENDER_BLOCK_TYPES.includes(kind as ExecutionRenderBlockType);
}

function isKnownPartKind(kind: string): kind is AnalysisInteractionPartKind {
  return ANALYSIS_INTERACTION_PART_KINDS.includes(
    kind as AnalysisInteractionPartKind,
  );
}

function buildPartId(
  kind: string,
  source: AnalysisInteractionPartSource,
) {
  const segments = [
    'analysis-part',
    source.sourceType,
    source.sessionId ?? 'session-unknown',
    source.executionId ?? 'execution-unknown',
    source.eventId ?? 'event-unknown',
    `seq-${source.sequence ?? 0}`,
    `block-${source.blockIndex ?? 0}`,
    kind,
  ];

  return segments.join('::');
}

function stripUndefinedPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

function buildPart(input: {
  kind: AnalysisInteractionPartKind;
  source: AnalysisInteractionPartSource;
  surfaceHints?: AnalysisInteractionSurface[];
  title?: string;
  label?: string;
  payload: Record<string, unknown>;
  diagnostics?: AnalysisInteractionPartDiagnostics;
}): AnalysisInteractionPart {
  return {
    id: buildPartId(input.kind, input.source),
    kind: input.kind,
    version: ANALYSIS_INTERACTION_PART_SCHEMA_VERSION,
    source: input.source,
    surfaceHints: {
      supportedSurfaces: input.surfaceHints ?? ['workspace', 'mobile'],
    },
    projection: {
      surface: 'workspace',
      density: 'full',
    },
    title: input.title,
    label: input.label ?? input.title,
    payload: input.payload,
    diagnostics: input.diagnostics ?? {
      originalType: input.kind,
      originalSource: input.source,
    },
  };
}

function payloadFromRenderBlock(block: ExecutionRenderBlock) {
  switch (block.type) {
    case 'status':
      return {
        value: block.value,
        tone: block.tone,
      };
    case 'kv-list':
      return { items: block.items };
    case 'tool-list':
      return { items: block.items };
    case 'markdown':
      return { content: block.content };
    case 'table':
      return {
        columns: block.columns,
        rows: block.rows,
      };
    case 'chart':
      return stripUndefinedPayload({
        chartType: block.chartType,
        series: block.series,
        unit: block.unit,
      });
    case 'graph':
      return {
        nodes: block.nodes,
        edges: block.edges,
      };
    case 'evidence-card':
      return stripUndefinedPayload({
        summary: block.summary,
        evidence: block.evidence,
        confidence: block.confidence,
      });
    case 'timeline':
      return { items: block.items };
    case 'approval-state':
      return stripUndefinedPayload({
        state: block.state,
        owner: block.owner,
        reason: block.reason,
      });
    case 'skills-state':
      return { items: block.items };
  }
}

function resolveNormalizedKind(input: {
  rawType: ExecutionRenderBlockType;
  title?: string;
}): AnalysisInteractionPartKind {
  if (
    input.rawType === 'markdown' &&
    (input.title === '阶段说明' || input.title === '推理摘要')
  ) {
    return 'reasoning-summary';
  }

  return input.rawType;
}

type ProcessBoardStepStatus = 'running' | 'completed' | 'failed';

type ProcessBoardStepItem = {
  id: string;
  order: number;
  title: string;
  status: ProcessBoardStepStatus;
};

type ProcessBoardProgress = {
  processed: number;
  total: number;
  percent: number;
  label: string;
};

function buildStepProgressItems(
  events: readonly AnalysisExecutionStreamEvent[],
): ProcessBoardStepItem[] {
  const stepById = new Map<string, ProcessBoardStepItem>();

  events.forEach((event) => {
    if (!event.step) {
      return;
    }

    const previous = stepById.get(event.step.id);
    const nextItem: ProcessBoardStepItem = {
      id: event.step.id,
      order: event.step.order,
      title: event.step.title,
      status: event.step.status,
    };

    if (!previous) {
      stepById.set(event.step.id, nextItem);
      return;
    }

    const previousPriority =
      previous.status === 'failed' ? 3 : previous.status === 'completed' ? 2 : 1;
    const nextPriority =
      nextItem.status === 'failed' ? 3 : nextItem.status === 'completed' ? 2 : 1;

    if (nextPriority >= previousPriority) {
      stepById.set(event.step.id, nextItem);
    }
  });

  return [...stepById.values()].sort((left, right) => left.order - right.order);
}

function isProcessBoardProgress(value: unknown): value is {
  processed: number;
  total: number;
} {
  return !!value
    && typeof value === 'object'
    && typeof (value as { processed?: unknown }).processed === 'number'
    && Number.isFinite((value as { processed: number }).processed)
    && typeof (value as { total?: unknown }).total === 'number'
    && Number.isFinite((value as { total: number }).total);
}

function resolveLatestStructuredProcessBoardProgress(
  events: readonly AnalysisExecutionStreamEvent[],
) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const metadata =
      event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? (event.metadata as Record<string, unknown>)
        : null;
    const progress = metadata?.processBoardProgress;

    if (isProcessBoardProgress(progress) && progress.total > 0) {
      return {
        processed: Math.max(0, Math.min(progress.processed, progress.total)),
        total: progress.total,
      };
    }
  }

  return null;
}

function buildProcessBoardProgress(input: {
  events: readonly AnalysisExecutionStreamEvent[];
  steps: readonly ProcessBoardStepItem[];
}): ProcessBoardProgress {
  const structured = resolveLatestStructuredProcessBoardProgress(input.events);
  const total = structured?.total ?? input.steps.length;
  const processed =
    structured?.processed
    ?? input.steps.filter((step) => step.status === 'completed').length;

  if (total <= 0) {
    return {
      processed: 0,
      total: 0,
      percent: 0,
      label: '正在初始化执行流程',
    };
  }

  return {
    processed,
    total,
    percent: Math.min(100, Math.round((processed / total) * 100)),
    label: `已完成 ${processed}/${total} 步`,
  };
}

export function normalizeExecutionRenderBlock(
  block: ExecutionRenderBlock | unknown,
  source: AnalysisInteractionPartSource,
): AnalysisInteractionPart {
  const candidate = assertObject(block, 'renderBlock');
  const rawType = assertString(candidate.type, 'renderBlock.type');

  if (!isKnownExecutionRenderBlockType(rawType)) {
    throw new InvalidAnalysisInteractionPartError(
      `不支持的 execution render block 类型: ${rawType}。`,
    );
  }

  const typedBlock = block as ExecutionRenderBlock;
  const title =
    typeof candidate.title === 'string' && candidate.title.trim()
      ? candidate.title.trim()
      : undefined;
  const kind = resolveNormalizedKind({
    rawType,
    title,
  });

  if (!isKnownPartKind(kind)) {
    throw new InvalidAnalysisInteractionPartError(
      `不支持的 interaction part 类型: ${kind}。`,
    );
  }

  return buildPart({
    kind,
    source,
    title,
    payload: payloadFromRenderBlock(typedBlock),
    diagnostics: {
      originalType: rawType,
      originalSource: source,
    },
  });
}

export function normalizeExecutionRenderBlocks(
  blocks: readonly (ExecutionRenderBlock | unknown)[],
  source: AnalysisInteractionPartSource,
): AnalysisInteractionPart[] {
  return blocks.map((block, index) =>
    normalizeExecutionRenderBlock(block, {
      ...source,
      blockIndex: (source.blockIndex ?? 0) + index,
    }),
  );
}

function truncateText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return value;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function projectPayload(
  part: AnalysisInteractionPart,
  surface: AnalysisInteractionSurface,
) {
  if (surface === 'workspace') {
    return part.payload;
  }

  switch (part.kind) {
    case 'markdown':
    case 'reasoning-summary':
      return {
        ...part.payload,
        content: truncateText(part.payload.content, 80),
      };
    case 'process-board':
      return {
        ...part.payload,
        steps: Array.isArray(part.payload.steps)
          ? part.payload.steps.slice(0, 3)
          : part.payload.steps,
      };
    case 'table':
      return {
        ...part.payload,
        rows: Array.isArray(part.payload.rows)
          ? part.payload.rows.slice(0, 2)
          : part.payload.rows,
      };
    case 'chart':
      return {
        ...part.payload,
        series: Array.isArray(part.payload.series)
          ? part.payload.series.slice(0, 1)
          : part.payload.series,
      };
    case 'graph':
      return {
        ...part.payload,
        nodes: Array.isArray(part.payload.nodes)
          ? part.payload.nodes.slice(0, 4)
          : part.payload.nodes,
        edges: Array.isArray(part.payload.edges)
          ? part.payload.edges.slice(0, 4)
          : part.payload.edges,
      };
    case 'evidence-card':
      return {
        ...part.payload,
        evidence: Array.isArray(part.payload.evidence)
          ? part.payload.evidence.slice(0, 2)
          : part.payload.evidence,
      };
    case 'timeline':
      return {
        ...part.payload,
        items: Array.isArray(part.payload.items)
          ? part.payload.items.slice(0, 3)
          : part.payload.items,
      };
    case 'assumption-card':
      return {
        ...part.payload,
        assumptions: Array.isArray(part.payload.assumptions)
          ? part.payload.assumptions.slice(0, 2)
          : part.payload.assumptions,
      };
    case 'skills-state':
      return {
        ...part.payload,
        items: Array.isArray(part.payload.items)
          ? part.payload.items.slice(0, 3)
          : part.payload.items,
      };
    default:
      return part.payload;
  }
}

export function buildProcessBoardPart(input: {
  sessionId: string;
  executionId: string;
  events: readonly AnalysisExecutionStreamEvent[];
}): AnalysisInteractionPart {
  const steps = buildStepProgressItems(input.events);
  const progress = buildProcessBoardProgress({
    events: input.events,
    steps,
  });
  const lastSequence = input.events.at(-1)?.sequence ?? 0;

  return buildPart({
    kind: 'process-board',
    source: {
      sourceType: 'runtime-foundation-part',
      sessionId: input.sessionId,
      executionId: input.executionId,
      eventId: 'process-board',
      sequence: lastSequence,
      blockIndex: 0,
    },
    surfaceHints: ['workspace'],
    title: '执行流程看板',
    payload: {
      progress,
      steps,
      eventCount: input.events.length,
      emptyMessage: '正在等待执行事件，请保持当前页面打开。',
    },
  });
}

export function buildAssumptionCardPart(input: {
  assumptions: string[];
  title?: string;
  note?: string;
  testId?: string;
  source?: AnalysisInteractionPartSource;
}): AnalysisInteractionPart {
  if (!Array.isArray(input.assumptions) || input.assumptions.length === 0) {
    throw new InvalidAnalysisInteractionPartError(
      'assumption-card 至少需要一条 assumption。',
    );
  }

  const source = input.source ?? {
    sourceType: 'runtime-foundation-part',
    eventId: 'assumption-card',
    blockIndex: 0,
  };

  return buildPart({
    kind: 'assumption-card',
    source,
    title: input.title ?? '自动执行假设',
    payload: stripUndefinedPayload({
      assumptions: input.assumptions,
      note: input.note,
      testId: input.testId,
    }),
  });
}

export function projectAnalysisInteractionPart(
  part: AnalysisInteractionPart,
  input: { surface: AnalysisInteractionSurface },
): AnalysisInteractionPart {
  return {
    ...part,
    surfaceHints: {
      supportedSurfaces: [input.surface],
    },
    projection: {
      surface: input.surface,
      density: input.surface === 'workspace' ? 'full' : 'compact',
    },
    payload: projectPayload(part, input.surface),
  };
}
