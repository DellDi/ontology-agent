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
