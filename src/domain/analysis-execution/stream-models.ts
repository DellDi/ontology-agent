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

export type ExecutionRenderBlock =
  | ExecutionStatusRenderBlock
  | ExecutionKeyValueBlock
  | ExecutionToolListBlock
  | ExecutionMarkdownBlock
  | ExecutionTableBlock;

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
