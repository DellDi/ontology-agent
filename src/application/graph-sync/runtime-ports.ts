import type {
  GraphSyncCursor,
  GraphSyncCursorPosition,
  GraphSyncCursorSnapshot,
  GraphSyncDirtyScope,
  GraphSyncIncrementalChange,
  GraphSyncRun,
  GraphSyncSourceName,
  GraphSyncTriggerType,
} from '@/domain/graph-sync/models';

export type GraphSyncRunStore = {
  save(run: GraphSyncRun): Promise<GraphSyncRun>;
};

export type GraphSyncCursorStore = {
  getBySourceName(sourceName: GraphSyncSourceName): Promise<GraphSyncCursor | null>;
  save(cursor: GraphSyncCursor): Promise<GraphSyncCursor>;
};

export type GraphSyncDirtyScopeStore = {
  upsertPending(scope: GraphSyncDirtyScope): Promise<GraphSyncDirtyScope>;
  listDispatchableBySource(
    sourceName: GraphSyncSourceName,
  ): Promise<GraphSyncDirtyScope[]>;
  markProcessing(scope: GraphSyncDirtyScope): Promise<GraphSyncDirtyScope>;
  markCompleted(
    scope: GraphSyncDirtyScope,
    input: { lastRunId: string | null },
  ): Promise<GraphSyncDirtyScope>;
  markFailed(
    scope: GraphSyncDirtyScope,
    input: { lastRunId: string | null; errorSummary: string },
  ): Promise<GraphSyncDirtyScope>;
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
    sourceName: GraphSyncSourceName;
    triggerType: GraphSyncTriggerType;
    triggeredBy: string;
    cursorSnapshot: GraphSyncCursorSnapshot;
  }): Promise<{
    run: {
      id: string;
    };
  }>;
};
