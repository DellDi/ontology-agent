import type { ExecutionRenderBlock } from '@/domain/analysis-execution/stream-models';

export const ANALYSIS_INTERACTION_PART_SCHEMA_VERSION = 1 as const;

export const ANALYSIS_INTERACTION_SURFACES = ['workspace', 'mobile'] as const;
export type AnalysisInteractionSurface =
  (typeof ANALYSIS_INTERACTION_SURFACES)[number];

export const ANALYSIS_INTERACTION_PART_KINDS = [
  'status',
  'kv-list',
  'tool-list',
  'markdown',
  'table',
  'chart',
  'graph',
  'evidence-card',
  'timeline',
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

export function normalizeExecutionRenderBlock(
  block: ExecutionRenderBlock | unknown,
  source: AnalysisInteractionPartSource,
): AnalysisInteractionPart {
  const candidate = assertObject(block, 'renderBlock');
  const kind = assertString(candidate.type, 'renderBlock.type');

  if (!isKnownPartKind(kind)) {
    throw new InvalidAnalysisInteractionPartError(
      `不支持的 interaction part 类型: ${kind}。`,
    );
  }

  const typedBlock = block as ExecutionRenderBlock;
  const title =
    typeof candidate.title === 'string' && candidate.title.trim()
      ? candidate.title.trim()
      : undefined;

  return {
    id: buildPartId(kind, source),
    kind,
    version: ANALYSIS_INTERACTION_PART_SCHEMA_VERSION,
    source,
    surfaceHints: {
      supportedSurfaces: ['workspace', 'mobile'],
    },
    projection: {
      surface: 'workspace',
      density: 'full',
    },
    title,
    label: title,
    payload: payloadFromRenderBlock(typedBlock),
    diagnostics: {
      originalType: kind,
      originalSource: source,
    },
  };
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
      return {
        ...part.payload,
        content: truncateText(part.payload.content, 80),
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
