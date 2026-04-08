export const GRAPH_SYNC_RUN_MODES = [
  'full-bootstrap',
  'org-rebuild',
  'incremental-rebuild',
] as const;

export type GraphSyncRunMode = (typeof GRAPH_SYNC_RUN_MODES)[number];

export const GRAPH_SYNC_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'partial',
] as const;

export type GraphSyncRunStatus = (typeof GRAPH_SYNC_RUN_STATUSES)[number];

export type GraphSyncRunScopeType = 'all' | 'organization';

export type GraphSyncTriggerType =
  | 'manual'
  | 'scheduler'
  | 'deployment'
  | 'recovery';

export type GraphSyncCursorSnapshot = Record<
  string,
  {
    cursorTime?: string | null;
    cursorPk?: string | null;
  }
>;

export const GRAPH_SYNC_SOURCE_NAMES = [
  'erp.organizations',
  'erp.projects',
  'erp.owners',
  'erp.charge_items',
  'erp.receivables',
  'erp.payments',
  'erp.service_orders',
] as const;

export type GraphSyncSourceName = (typeof GRAPH_SYNC_SOURCE_NAMES)[number];

export type GraphSyncCursorPosition = {
  cursorTime: string | null;
  cursorPk: string | null;
};

export type GraphSyncCursor = {
  sourceName: GraphSyncSourceName;
  cursorTime: string | null;
  cursorPk: string | null;
  lastRunId: string | null;
  updatedAt: string;
};

export const GRAPH_SYNC_DIRTY_SCOPE_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;

export type GraphSyncDirtyScopeStatus =
  (typeof GRAPH_SYNC_DIRTY_SCOPE_STATUSES)[number];

export type GraphSyncDirtyScopeSourceState = {
  cursorTime: string | null;
  cursorPk: string | null;
  sourcePk: string | null;
  reason: string;
};

export type GraphSyncDirtyScopeSourceProgress = Partial<
  Record<GraphSyncSourceName, GraphSyncDirtyScopeSourceState>
>;

export type GraphSyncDirtyScope = {
  id: string;
  scopeType: 'organization';
  scopeKey: string;
  reason: string;
  sourceName: GraphSyncSourceName;
  sourcePk: string | null;
  sourceProgress: GraphSyncDirtyScopeSourceProgress;
  firstDetectedAt: string;
  lastDetectedAt: string;
  status: GraphSyncDirtyScopeStatus;
  attemptCount: number;
  lastRunId: string | null;
};

export type GraphSyncIncrementalChange = {
  sourceName: GraphSyncSourceName;
  sourcePk: string | null;
  scopeOrgId: string | null;
  reason: string;
  cursorTime: string | null;
  cursorPk: string | null;
};

export type GraphSyncRun = {
  id: string;
  mode: GraphSyncRunMode;
  status: GraphSyncRunStatus;
  scopeType: GraphSyncRunScopeType;
  scopeKey: string;
  triggerType: GraphSyncTriggerType;
  triggeredBy: string;
  cursorSnapshot: GraphSyncCursorSnapshot;
  nodesWritten: number;
  edgesWritten: number;
  errorSummary: string | null;
  errorDetail: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GraphScopedCleanupInput = {
  scopeOrgId: string;
  lastSeenRunId: string;
};

function normalizeCursorTime(cursorTime: string | null) {
  return cursorTime ? Date.parse(cursorTime) : Number.NEGATIVE_INFINITY;
}

function normalizeCursorPk(cursorPk: string | null) {
  return cursorPk ?? '';
}

export function compareGraphSyncCursorPositions(
  left: GraphSyncCursorPosition | null,
  right: GraphSyncCursorPosition | null,
) {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return -1;
  }

  if (!right) {
    return 1;
  }

  const timeDifference =
    normalizeCursorTime(left.cursorTime) - normalizeCursorTime(right.cursorTime);

  if (timeDifference !== 0) {
    return timeDifference > 0 ? 1 : -1;
  }

  const leftPk = normalizeCursorPk(left.cursorPk);
  const rightPk = normalizeCursorPk(right.cursorPk);

  if (leftPk === rightPk) {
    return 0;
  }

  return leftPk > rightPk ? 1 : -1;
}

export function maxGraphSyncCursorPosition(
  left: GraphSyncCursorPosition | null,
  right: GraphSyncCursorPosition | null,
) {
  return compareGraphSyncCursorPositions(left, right) >= 0 ? left : right;
}
