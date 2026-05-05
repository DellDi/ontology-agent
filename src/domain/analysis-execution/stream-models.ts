import type { JobStatus } from '@/domain/job-contract/models';

export const EXECUTION_EVENT_KINDS = [
  'execution-status',
  'step-lifecycle',
  'stage-result',
] as const;

export type ExecutionEventKind = (typeof EXECUTION_EVENT_KINDS)[number];

export const EXECUTION_RENDER_BLOCK_TYPES = [
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

export type ExecutionRenderBlockType =
  (typeof EXECUTION_RENDER_BLOCK_TYPES)[number];

export type ExecutionStatusRenderBlock = {
  type: 'status';
  title: string;
  value: string;
  tone: 'neutral' | 'info' | 'success' | 'error';
};

export type ExecutionKeyValueBlock = {
  type: 'kv-list';
  title: string;
  items: { label: string; value: string }[];
};

export type ExecutionToolListBlock = {
  type: 'tool-list';
  title: string;
  items: {
    toolName: string;
    objective: string;
    status: 'selected' | 'running' | 'completed' | 'failed';
  }[];
};

export type ExecutionMarkdownBlock = {
  type: 'markdown';
  title: string;
  content: string;
};

export type ExecutionTableBlock = {
  type: 'table';
  title: string;
  columns: string[];
  rows: string[][];
};

export type ExecutionChartBlock = {
  type: 'chart';
  title: string;
  chartType: 'bar' | 'line' | 'pie' | 'metric';
  series: {
    name: string;
    points: { label: string; value: number }[];
  }[];
  unit?: string;
};

export type ExecutionGraphBlock = {
  type: 'graph';
  title: string;
  nodes: { id: string; label: string; kind?: string }[];
  edges: { source: string; target: string; label?: string }[];
};

export type ExecutionEvidenceCardBlock = {
  type: 'evidence-card';
  title: string;
  summary: string;
  evidence: { label: string; summary: string }[];
  confidence?: number;
};

export type ExecutionTimelineBlock = {
  type: 'timeline';
  title: string;
  items: {
    id: string;
    title: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    timestamp?: string;
    summary?: string;
  }[];
};

export type ExecutionApprovalStateBlock = {
  type: 'approval-state';
  title: string;
  state: 'not-required' | 'pending' | 'approved' | 'rejected';
  owner?: string;
  reason?: string;
};

export type ExecutionSkillsStateBlock = {
  type: 'skills-state';
  title: string;
  items: {
    skillName: string;
    status: 'ready' | 'running' | 'completed' | 'failed' | 'blocked';
    summary?: string;
  }[];
};

export type ExecutionRenderBlock =
  | ExecutionStatusRenderBlock
  | ExecutionKeyValueBlock
  | ExecutionToolListBlock
  | ExecutionMarkdownBlock
  | ExecutionTableBlock
  | ExecutionChartBlock
  | ExecutionGraphBlock
  | ExecutionEvidenceCardBlock
  | ExecutionTimelineBlock
  | ExecutionApprovalStateBlock
  | ExecutionSkillsStateBlock;

export type ExecutionStepSnapshot = {
  id: string;
  order: number;
  title: string;
  status: 'running' | 'completed' | 'failed';
};

export type ExecutionStageSnapshot = {
  key: string;
  label: string;
  status: 'running' | 'completed' | 'failed';
};

export type AnalysisExecutionStreamEvent = {
  id: string;
  sessionId: string;
  executionId: string;
  sequence: number;
  kind: ExecutionEventKind;
  timestamp: string;
  status?: JobStatus;
  message?: string;
  step?: ExecutionStepSnapshot;
  stage?: ExecutionStageSnapshot;
  renderBlocks: ExecutionRenderBlock[];
  metadata?: Record<string, unknown>;
};

export class InvalidAnalysisExecutionStreamEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAnalysisExecutionStreamEventError';
  }
}

function assertNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidAnalysisExecutionStreamEventError(
      `${fieldName} 必须是非空字符串。`,
    );
  }

  return value.trim();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringMatrix(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'))
  );
}

function assertOptionalString(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  return assertNonEmptyString(value, fieldName);
}

function assertFiniteNumber(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidAnalysisExecutionStreamEventError(
      `${fieldName} 必须是有限数字。`,
    );
  }

  return value;
}

function assertObjectArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value)) {
    throw new InvalidAnalysisExecutionStreamEventError(
      `${fieldName} 必须是数组。`,
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new InvalidAnalysisExecutionStreamEventError(
        `${fieldName}[${index}] 必须是对象。`,
      );
    }

    return item as Record<string, unknown>;
  });
}

function validateChartBlock(
  candidate: Record<string, unknown>,
): ExecutionChartBlock {
  const chartType =
    candidate.chartType === 'bar' ||
    candidate.chartType === 'line' ||
    candidate.chartType === 'pie' ||
    candidate.chartType === 'metric'
      ? candidate.chartType
      : null;

  if (!chartType) {
    throw new InvalidAnalysisExecutionStreamEventError(
      'chart.chartType 必须是 bar / line / pie / metric。',
    );
  }

  const series = assertObjectArray(candidate.series, 'chart.series');
  if (series.length === 0) {
    throw new InvalidAnalysisExecutionStreamEventError(
      'chart.series 必须至少包含一个序列。',
    );
  }

  return {
    type: 'chart',
    title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
    chartType,
    series: series.map((entry, index) => {
      const points = assertObjectArray(
        entry.points,
        `chart.series[${index}].points`,
      );
      if (points.length === 0) {
        throw new InvalidAnalysisExecutionStreamEventError(
          `chart.series[${index}].points 必须至少包含一个点。`,
        );
      }

      return {
        name: assertNonEmptyString(
          entry.name,
          `chart.series[${index}].name`,
        ),
        points: points.map((point, pointIndex) => ({
          label: assertNonEmptyString(
            point.label,
            `chart.series[${index}].points[${pointIndex}].label`,
          ),
          value: assertFiniteNumber(
            point.value,
            `chart.series[${index}].points[${pointIndex}].value`,
          ),
        })),
      };
    }),
    unit: assertOptionalString(candidate.unit, 'chart.unit'),
  };
}

function validateGraphBlock(
  candidate: Record<string, unknown>,
): ExecutionGraphBlock {
  const nodes = assertObjectArray(candidate.nodes, 'graph.nodes');
  if (nodes.length === 0) {
    throw new InvalidAnalysisExecutionStreamEventError(
      'graph.nodes 必须至少包含一个节点。',
    );
  }

  return {
    type: 'graph',
    title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
    nodes: nodes.map((node, index) => ({
      id: assertNonEmptyString(node.id, `graph.nodes[${index}].id`),
      label: assertNonEmptyString(node.label, `graph.nodes[${index}].label`),
      kind: assertOptionalString(node.kind, `graph.nodes[${index}].kind`),
    })),
    edges: assertObjectArray(candidate.edges, 'graph.edges').map((edge, index) => ({
      source: assertNonEmptyString(edge.source, `graph.edges[${index}].source`),
      target: assertNonEmptyString(edge.target, `graph.edges[${index}].target`),
      label: assertOptionalString(edge.label, `graph.edges[${index}].label`),
    })),
  };
}

function validateEvidenceCardBlock(
  candidate: Record<string, unknown>,
): ExecutionEvidenceCardBlock {
  const evidence = assertObjectArray(
    candidate.evidence,
    'evidence-card.evidence',
  );
  if (evidence.length === 0) {
    throw new InvalidAnalysisExecutionStreamEventError(
      'evidence-card.evidence 必须至少包含一个证据项。',
    );
  }

  return {
    type: 'evidence-card',
    title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
    summary: assertNonEmptyString(candidate.summary, 'evidence-card.summary'),
    evidence: evidence.map((item, index) => ({
        label: assertNonEmptyString(
          item.label,
          `evidence-card.evidence[${index}].label`,
        ),
        summary: assertNonEmptyString(
          item.summary,
          `evidence-card.evidence[${index}].summary`,
        ),
      })),
    confidence:
      candidate.confidence === undefined
        ? undefined
        : assertFiniteNumber(candidate.confidence, 'evidence-card.confidence'),
  };
}

function validateTimelineBlock(
  candidate: Record<string, unknown>,
): ExecutionTimelineBlock {
  const items = assertObjectArray(candidate.items, 'timeline.items');
  if (items.length === 0) {
    throw new InvalidAnalysisExecutionStreamEventError(
      'timeline.items 必须至少包含一个节点。',
    );
  }

  return {
    type: 'timeline',
    title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
    items: items.map((item, index) => {
      const status =
        item.status === 'pending' ||
        item.status === 'running' ||
        item.status === 'completed' ||
        item.status === 'failed'
          ? item.status
          : 'pending';

      return {
        id: assertNonEmptyString(item.id, `timeline.items[${index}].id`),
        title: assertNonEmptyString(
          item.title,
          `timeline.items[${index}].title`,
        ),
        status,
        timestamp: assertOptionalString(
          item.timestamp,
          `timeline.items[${index}].timestamp`,
        ),
        summary: assertOptionalString(
          item.summary,
          `timeline.items[${index}].summary`,
        ),
      };
    }),
  };
}

function validateApprovalStateBlock(
  candidate: Record<string, unknown>,
): ExecutionApprovalStateBlock {
  const state =
    candidate.state === 'not-required' ||
    candidate.state === 'pending' ||
    candidate.state === 'approved' ||
    candidate.state === 'rejected'
      ? candidate.state
      : null;

  if (!state) {
    throw new InvalidAnalysisExecutionStreamEventError(
      'approval-state.state 必须是 not-required / pending / approved / rejected。',
    );
  }

  return {
    type: 'approval-state',
    title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
    state,
    owner: assertOptionalString(candidate.owner, 'approval-state.owner'),
    reason: assertOptionalString(candidate.reason, 'approval-state.reason'),
  };
}

function validateSkillsStateBlock(
  candidate: Record<string, unknown>,
): ExecutionSkillsStateBlock {
  const items = assertObjectArray(candidate.items, 'skills-state.items');
  if (items.length === 0) {
    throw new InvalidAnalysisExecutionStreamEventError(
      'skills-state.items 必须至少包含一个 skill 状态。',
    );
  }

  return {
    type: 'skills-state',
    title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
    items: items.map((item, index) => {
      const status =
        item.status === 'ready' ||
        item.status === 'running' ||
        item.status === 'completed' ||
        item.status === 'failed' ||
        item.status === 'blocked'
          ? item.status
          : null;

      if (!status) {
        throw new InvalidAnalysisExecutionStreamEventError(
          `skills-state.items[${index}].status 必须是 ready / running / completed / failed / blocked。`,
        );
      }

      return {
        skillName: assertNonEmptyString(
          item.skillName,
          `skills-state.items[${index}].skillName`,
        ),
        status,
        summary: assertOptionalString(
          item.summary,
          `skills-state.items[${index}].summary`,
        ),
      };
    }),
  };
}

function validateRenderBlock(
  block: unknown,
): ExecutionRenderBlock {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    throw new InvalidAnalysisExecutionStreamEventError(
      'render block 必须是对象。',
    );
  }

  const candidate = block as Record<string, unknown>;

  switch (candidate.type) {
    case 'status':
      return {
        type: 'status',
        title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
        value: assertNonEmptyString(candidate.value, 'renderBlocks.value'),
        tone:
          candidate.tone === 'info' ||
          candidate.tone === 'success' ||
          candidate.tone === 'error'
            ? candidate.tone
            : 'neutral',
      };
    case 'kv-list':
      if (!Array.isArray(candidate.items)) {
        throw new InvalidAnalysisExecutionStreamEventError(
          'kv-list.items 必须是数组。',
        );
      }

      return {
        type: 'kv-list',
        title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
        items: candidate.items.map((item, index) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new InvalidAnalysisExecutionStreamEventError(
              `kv-list.items[${index}] 必须是对象。`,
            );
          }

          const kvCandidate = item as Record<string, unknown>;

          return {
            label: assertNonEmptyString(
              kvCandidate.label,
              `kv-list.items[${index}].label`,
            ),
            value: assertNonEmptyString(
              kvCandidate.value,
              `kv-list.items[${index}].value`,
            ),
          };
        }),
      };
    case 'tool-list':
      if (!Array.isArray(candidate.items)) {
        throw new InvalidAnalysisExecutionStreamEventError(
          'tool-list.items 必须是数组。',
        );
      }

      return {
        type: 'tool-list',
        title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
        items: candidate.items.map((item, index) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new InvalidAnalysisExecutionStreamEventError(
              `tool-list.items[${index}] 必须是对象。`,
            );
          }

          const toolCandidate = item as Record<string, unknown>;
          const status =
            toolCandidate.status === 'running' ||
            toolCandidate.status === 'completed' ||
            toolCandidate.status === 'failed'
              ? toolCandidate.status
              : 'selected';

          return {
            toolName: assertNonEmptyString(
              toolCandidate.toolName,
              `tool-list.items[${index}].toolName`,
            ),
            objective: assertNonEmptyString(
              toolCandidate.objective,
              `tool-list.items[${index}].objective`,
            ),
            status,
          };
        }),
      };
    case 'markdown':
      return {
        type: 'markdown',
        title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
        content: assertNonEmptyString(
          candidate.content,
          'renderBlocks.content',
        ),
      };
    case 'table':
      if (!isStringArray(candidate.columns)) {
        throw new InvalidAnalysisExecutionStreamEventError(
          'table.columns 必须是字符串数组。',
        );
      }

      if (!isStringMatrix(candidate.rows)) {
        throw new InvalidAnalysisExecutionStreamEventError(
          'table.rows 必须是二维字符串数组。',
        );
      }

      return {
        type: 'table',
        title: assertNonEmptyString(candidate.title, 'renderBlocks.title'),
        columns: candidate.columns,
        rows: candidate.rows,
      };
    case 'chart':
      return validateChartBlock(candidate);
    case 'graph':
      return validateGraphBlock(candidate);
    case 'evidence-card':
      return validateEvidenceCardBlock(candidate);
    case 'timeline':
      return validateTimelineBlock(candidate);
    case 'approval-state':
      return validateApprovalStateBlock(candidate);
    case 'skills-state':
      return validateSkillsStateBlock(candidate);
    default:
      throw new InvalidAnalysisExecutionStreamEventError(
        `不支持的 render block 类型: ${String(candidate.type)}。`,
      );
  }
}

export function validateAnalysisExecutionStreamEvent(
  event: unknown,
): AnalysisExecutionStreamEvent {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new InvalidAnalysisExecutionStreamEventError('执行事件必须是对象。');
  }

  const candidate = event as Record<string, unknown>;

  if (
    typeof candidate.kind !== 'string' ||
    !EXECUTION_EVENT_KINDS.includes(candidate.kind as ExecutionEventKind)
  ) {
    throw new InvalidAnalysisExecutionStreamEventError(
      `不支持的执行事件类型: ${String(candidate.kind)}。`,
    );
  }

  if (!Array.isArray(candidate.renderBlocks)) {
    throw new InvalidAnalysisExecutionStreamEventError(
      'renderBlocks 必须是数组。',
    );
  }

  return {
    id: assertNonEmptyString(candidate.id, 'id'),
    sessionId: assertNonEmptyString(candidate.sessionId, 'sessionId'),
    executionId: assertNonEmptyString(candidate.executionId, 'executionId'),
    sequence:
      typeof candidate.sequence === 'number' && candidate.sequence > 0
        ? candidate.sequence
        : 1,
    kind: candidate.kind as ExecutionEventKind,
    timestamp: assertNonEmptyString(candidate.timestamp, 'timestamp'),
    status:
      candidate.status === 'pending' ||
      candidate.status === 'processing' ||
      candidate.status === 'completed' ||
      candidate.status === 'failed'
        ? candidate.status
        : undefined,
    message:
      typeof candidate.message === 'string' ? candidate.message : undefined,
    step:
      candidate.step &&
      typeof candidate.step === 'object' &&
      !Array.isArray(candidate.step)
        ? {
            id: assertNonEmptyString(
              (candidate.step as Record<string, unknown>).id,
              'step.id',
            ),
            order:
              typeof (candidate.step as Record<string, unknown>).order ===
              'number'
                ? ((candidate.step as Record<string, unknown>).order as number)
                : 0,
            title: assertNonEmptyString(
              (candidate.step as Record<string, unknown>).title,
              'step.title',
            ),
            status:
              (candidate.step as Record<string, unknown>).status === 'completed'
                ? 'completed'
                : (candidate.step as Record<string, unknown>).status === 'failed'
                  ? 'failed'
                  : 'running',
          }
        : undefined,
    stage:
      candidate.stage &&
      typeof candidate.stage === 'object' &&
      !Array.isArray(candidate.stage)
        ? {
            key: assertNonEmptyString(
              (candidate.stage as Record<string, unknown>).key,
              'stage.key',
            ),
            label: assertNonEmptyString(
              (candidate.stage as Record<string, unknown>).label,
              'stage.label',
            ),
            status:
              (candidate.stage as Record<string, unknown>).status === 'completed'
                ? 'completed'
                : (candidate.stage as Record<string, unknown>).status === 'failed'
                  ? 'failed'
                  : 'running',
          }
        : undefined,
    renderBlocks: candidate.renderBlocks.map((block) =>
      validateRenderBlock(block),
    ),
    metadata:
      candidate.metadata &&
      typeof candidate.metadata === 'object' &&
      !Array.isArray(candidate.metadata)
        ? (candidate.metadata as Record<string, unknown>)
        : undefined,
  };
}

export function getExecutionStatusTone(
  status: JobStatus,
): ExecutionStatusRenderBlock['tone'] {
  switch (status) {
    case 'processing':
      return 'info';
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}

export function getExecutionStatusLabel(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return '等待中';
    case 'queued':
      return '已入队';
    case 'processing':
      return '执行中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '已失败';
    case 'dead_letter':
      return '已进入死信';
  }
}
