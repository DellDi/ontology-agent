import { randomUUID } from 'node:crypto';

import type {
  GraphSyncCursor,
  GraphSyncCursorPosition,
  GraphSyncCursorSnapshot,
  GraphSyncDirtyScope,
  GraphSyncIncrementalChange,
  GraphSyncSourceName,
  GraphSyncTriggerType,
} from '@/domain/graph-sync/models';
import { maxGraphSyncCursorPosition } from '@/domain/graph-sync/models';

import type {
  GraphSyncCursorStore,
  GraphSyncDirtyScopeStore,
  GraphSyncOrganizationRebuildRunner,
  GraphSyncSourceScanPort,
} from './runtime-ports';

function buildCursorSnapshotFromDirtyScope(
  scope: GraphSyncDirtyScope,
): GraphSyncCursorSnapshot {
  return Object.fromEntries(
    Object.entries(scope.sourceProgress).map(([sourceName, sourceState]) => [
      sourceName,
      {
        cursorTime: sourceState?.cursorTime ?? null,
        cursorPk: sourceState?.cursorPk ?? null,
      },
    ]),
  );
}

function buildDirtyScopeFromChange(
  change: GraphSyncIncrementalChange,
): GraphSyncDirtyScope {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    scopeType: 'organization',
    scopeKey: change.scopeOrgId ?? '',
    reason: change.reason,
    sourceName: change.sourceName,
    sourcePk: change.sourcePk,
    sourceProgress: change.scopeOrgId
      ? {
          [change.sourceName]: {
            cursorTime: change.cursorTime,
            cursorPk: change.cursorPk,
            sourcePk: change.sourcePk,
            reason: change.reason,
          },
        }
      : {},
    firstDetectedAt: now,
    lastDetectedAt: now,
    status: 'pending',
    attemptCount: 0,
    lastRunId: null,
  };
}

function toCursorPosition(
  cursor: Pick<GraphSyncCursor, 'cursorTime' | 'cursorPk'> | null,
): GraphSyncCursorPosition | null {
  if (!cursor) {
    return null;
  }

  return {
    cursorTime: cursor.cursorTime,
    cursorPk: cursor.cursorPk,
  };
}

export function createGraphSyncIncrementalUseCases({
  sourceScanPort,
  cursorStore,
  dirtyScopeStore,
  orgRebuildRunner,
}: {
  sourceScanPort: GraphSyncSourceScanPort;
  cursorStore: GraphSyncCursorStore;
  dirtyScopeStore: GraphSyncDirtyScopeStore;
  orgRebuildRunner: GraphSyncOrganizationRebuildRunner;
}) {
  return {
    async scanSource({ sourceName }: { sourceName: GraphSyncSourceName }) {
      const currentCursor = await cursorStore.getBySourceName(sourceName);
      const scanResult = await sourceScanPort.scanSourceChanges({
        sourceName,
        cursor: toCursorPosition(currentCursor),
      });

      let targetCursor: GraphSyncCursorPosition | null = null;
      const dirtyScopeKeys = new Set<string>();
      const diagnostics = [...scanResult.diagnostics];

      for (const change of scanResult.changes) {
        if (!change.scopeOrgId) {
          diagnostics.push(
            `${sourceName} source_pk=${change.sourcePk ?? 'unknown'} 缺失 organizationId，当前停止推进 source cursor。`,
          );
          break;
        }

        await dirtyScopeStore.upsertPending(buildDirtyScopeFromChange(change));
        dirtyScopeKeys.add(change.scopeOrgId);
        targetCursor = maxGraphSyncCursorPosition(targetCursor, {
          cursorTime: change.cursorTime,
          cursorPk: change.cursorPk,
        });
      }

      return {
        sourceName,
        cursor: toCursorPosition(currentCursor),
        targetCursor,
        scannedChangeCount: scanResult.changes.length,
        dirtyScopeCount: dirtyScopeKeys.size,
        diagnostics,
      };
    },

    async dispatchSource(input: {
      sourceName: GraphSyncSourceName;
      targetCursor: GraphSyncCursorPosition | null;
      triggerType: GraphSyncTriggerType;
      triggeredBy: string;
    }) {
      const dispatchableScopes = await dirtyScopeStore.listDispatchableBySource(
        input.sourceName,
      );

      const rebuiltOrganizations: string[] = [];
      let lastRunId: string | null = null;

      for (const scope of dispatchableScopes) {
        const processingScope = await dirtyScopeStore.markProcessing(scope);

        try {
          const rebuildResult = await orgRebuildRunner.runOrganizationRebuild({
            organizationId: processingScope.scopeKey,
            sourceName: input.sourceName,
            triggerType: input.triggerType,
            triggeredBy: input.triggeredBy,
            cursorSnapshot: buildCursorSnapshotFromDirtyScope(processingScope),
          });
          lastRunId = rebuildResult.run.id;
          rebuiltOrganizations.push(processingScope.scopeKey);
          await dirtyScopeStore.markCompleted(processingScope, {
            lastRunId,
          });
        } catch (error) {
          const errorSummary =
            error instanceof Error
              ? error.message
              : 'Graph sync dirty scope dispatch failed.';

          await dirtyScopeStore.markFailed(processingScope, {
            lastRunId,
            errorSummary,
          });

          return {
            sourceName: input.sourceName,
            rebuiltOrganizations,
            cursorAdvanced: false,
            failedScopeKey: processingScope.scopeKey,
            errorSummary,
          };
        }
      }

      let advancedCursor: GraphSyncCursor | null = null;

      if (input.targetCursor) {
        advancedCursor = await cursorStore.save({
          sourceName: input.sourceName,
          cursorTime: input.targetCursor.cursorTime,
          cursorPk: input.targetCursor.cursorPk,
          lastRunId,
          updatedAt: new Date().toISOString(),
        });
      }

      return {
        sourceName: input.sourceName,
        rebuiltOrganizations,
        cursorAdvanced: advancedCursor !== null,
        advancedCursor,
      };
    },

    async runIncrementalSource(input: {
      sourceName: GraphSyncSourceName;
      triggerType: GraphSyncTriggerType;
      triggeredBy: string;
    }) {
      const scanResult = await this.scanSource({
        sourceName: input.sourceName,
      });

      const dispatchResult = await this.dispatchSource({
        sourceName: input.sourceName,
        targetCursor: scanResult.targetCursor,
        triggerType: input.triggerType,
        triggeredBy: input.triggeredBy,
      });

      return {
        ...dispatchResult,
        scannedChangeCount: scanResult.scannedChangeCount,
        dirtyScopeCount: scanResult.dirtyScopeCount,
        diagnostics: scanResult.diagnostics,
      };
    },
  };
}

const graphSyncIncrementalUseCasesModule = {
  createGraphSyncIncrementalUseCases,
};

export default graphSyncIncrementalUseCasesModule;
