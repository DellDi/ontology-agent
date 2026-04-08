import type {
  GraphSyncCursor,
  GraphSyncCursorPosition,
  GraphSyncCursorSnapshot,
  GraphSyncDirtyScope,
  GraphSyncDirtyScopeStatus,
  GraphSyncIncrementalChange,
  GraphSyncRun,
  GraphSyncRunMode,
  GraphSyncSourceName,
  GraphSyncTriggerType,
} from '@/domain/graph-sync/models';

export type GraphSyncRunStore = {
  save(run: GraphSyncRun): Promise<GraphSyncRun>;
  listRecent(limit: number): Promise<GraphSyncRun[]>;
};

export type GraphSyncCursorStore = {
  getBySourceName(sourceName: GraphSyncSourceName): Promise<GraphSyncCursor | null>;
  save(cursor: GraphSyncCursor): Promise<GraphSyncCursor>;
};

export type GraphSyncDirtyScopeStore = {
  upsertPending(scope: GraphSyncDirtyScope): Promise<GraphSyncDirtyScope>;
  listPendingBySource(
    sourceName: GraphSyncSourceName,
  ): Promise<GraphSyncDirtyScope[]>;
  listFailedBySource(
    sourceName: GraphSyncSourceName,
  ): Promise<GraphSyncDirtyScope[]>;
  listDispatchableBySource(
    sourceName: GraphSyncSourceName,
  ): Promise<GraphSyncDirtyScope[]>;
  markPending(
    scope: GraphSyncDirtyScope,
    input: { retryReason: string },
  ): Promise<GraphSyncDirtyScope>;
  markProcessing(scope: GraphSyncDirtyScope): Promise<GraphSyncDirtyScope>;
  markCompleted(
    scope: GraphSyncDirtyScope,
    input: { lastRunId: string | null },
  ): Promise<GraphSyncDirtyScope>;
  markFailed(
    scope: GraphSyncDirtyScope,
    input: { lastRunId: string | null; errorSummary: string },
  ): Promise<GraphSyncDirtyScope>;
  countByStatus(): Promise<Record<GraphSyncDirtyScopeStatus, number>>;
  listRecentFailures(limit: number): Promise<GraphSyncDirtyScope[]>;
};

export type GraphSyncSourceScanPort = {
  scanSourceChanges(input: {
    sourceName: GraphSyncSourceName;
    cursor: GraphSyncCursorPosition | null;
  }): Promise<{
    changes: GraphSyncIncrementalChange[];
    diagnostics: string[];
  }>;
};

export type GraphSyncOrganizationRebuildRunner = {
  runOrganizationRebuild(input: {
    organizationId: string;
    mode: GraphSyncRunMode;
    sourceName?: GraphSyncSourceName | null;
    triggerType: GraphSyncTriggerType;
    triggeredBy: string;
    cursorSnapshot: GraphSyncCursorSnapshot;
  }): Promise<{
    run: {
      id: string;
    };
  }>;
};
