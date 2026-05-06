import type { JobStatus } from '@/domain/job-contract/models';

export const ANALYSIS_UI_MESSAGE_PROJECTION_VERSION = 1 as const;

export type AnalysisUiMessageProjectionScope = {
  ownerUserId: string;
  sessionId: string;
  executionId: string;
  followUpId: string | null;
  historyRoundId: string | null;
};

export type AnalysisUiMessageProjectionStreamCursor = {
  lastSequence: number;
  lastEventId: string | null;
};

export type AnalysisUiMessageProjectionMessage = {
  id: string;
  role: string;
  parts: Record<string, unknown>[];
  createdAt: string;
  updatedAt: string;
};

export type AnalysisUiMessageProjectionRecoveryMetadata = Record<
  string,
  unknown
>;

export type AnalysisUiMessageProjectionRecord =
  AnalysisUiMessageProjectionScope & {
    id: string;
    projectionVersion: number;
    partSchemaVersion: number;
    contractVersion: number;
    status: JobStatus;
    isTerminal: boolean;
    streamCursor: AnalysisUiMessageProjectionStreamCursor;
    messages: AnalysisUiMessageProjectionMessage[];
    recoveryMetadata: AnalysisUiMessageProjectionRecoveryMetadata;
    createdAt: string;
    updatedAt: string;
  };

export class AnalysisUiMessageProjectionScopeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisUiMessageProjectionScopeMismatchError';
  }
}

function normalizeScopeValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function assertSameScopeValue(
  fieldName: keyof AnalysisUiMessageProjectionScope,
  expected: string | null,
  actual: string | null,
) {
  if (expected !== actual) {
    throw new AnalysisUiMessageProjectionScopeMismatchError(
      `projection scope mismatch: field=${fieldName}, expected=${String(expected)}, actual=${String(actual)}`,
    );
  }
}

export function normalizeAnalysisUiMessageProjectionScope(
  input: {
    ownerUserId: string;
    sessionId: string;
    executionId: string;
    followUpId?: string | null;
    historyRoundId?: string | null;
  },
): AnalysisUiMessageProjectionScope {
  return {
    ownerUserId: input.ownerUserId.trim(),
    sessionId: input.sessionId.trim(),
    executionId: input.executionId.trim(),
    followUpId: normalizeScopeValue(input.followUpId),
    historyRoundId: normalizeScopeValue(input.historyRoundId),
  };
}

export function resolveAnalysisUiMessageProjectionId(
  scope: AnalysisUiMessageProjectionScope,
) {
  const followUpSegment = scope.followUpId ?? 'session-root';
  const roundSegment = scope.historyRoundId ?? followUpSegment;
  return [
    'analysis-ui-message-projection',
    scope.ownerUserId,
    scope.sessionId,
    scope.executionId,
    followUpSegment,
    roundSegment,
  ].join('::');
}

export function assertAnalysisUiMessageProjectionScope(
  record: AnalysisUiMessageProjectionRecord,
  expectedScope: AnalysisUiMessageProjectionScope,
) {
  assertSameScopeValue('ownerUserId', expectedScope.ownerUserId, record.ownerUserId);
  assertSameScopeValue('sessionId', expectedScope.sessionId, record.sessionId);
  assertSameScopeValue('executionId', expectedScope.executionId, record.executionId);
  assertSameScopeValue('followUpId', expectedScope.followUpId, record.followUpId);
  assertSameScopeValue(
    'historyRoundId',
    expectedScope.historyRoundId,
    record.historyRoundId,
  );
}

export function createAnalysisUiMessageProjectionCursor(input: {
  lastSequence: number;
  lastEventId?: string | null;
}): AnalysisUiMessageProjectionStreamCursor {
  return {
    lastSequence: Math.max(0, Math.trunc(input.lastSequence)),
    lastEventId: normalizeScopeValue(input.lastEventId),
  };
}
