import { desc, eq, sql } from 'drizzle-orm';

import type { GraphSyncDirtyScopeStore } from '@/application/graph-sync/runtime-ports';
import type {
  GraphSyncDirtyScope,
  GraphSyncDirtyScopeSourceProgress,
} from '@/domain/graph-sync/models';
import {
  compareGraphSyncCursorPositions,
} from '@/domain/graph-sync/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { graphSyncDirtyScopes } from '@/infrastructure/postgres/schema/graph-sync-dirty-scopes';

type GraphSyncDirtyScopeRow = typeof graphSyncDirtyScopes.$inferSelect;

function rowToGraphSyncDirtyScope(
  row: GraphSyncDirtyScopeRow,
): GraphSyncDirtyScope {
  return {
    id: row.id,
    scopeType: row.scopeType as GraphSyncDirtyScope['scopeType'],
    scopeKey: row.scopeKey,
    reason: row.reason,
    sourceName: row.sourceName as GraphSyncDirtyScope['sourceName'],
    sourcePk: row.sourcePk,
    sourceProgress: row.sourceProgress as GraphSyncDirtyScopeSourceProgress,
    firstDetectedAt: row.firstDetectedAt.toISOString(),
    lastDetectedAt: row.lastDetectedAt.toISOString(),
    status: row.status as GraphSyncDirtyScope['status'],
    attemptCount: row.attemptCount,
    lastRunId: row.lastRunId,
  };
}

function mergeSourceProgress(
  existing: GraphSyncDirtyScopeSourceProgress,
  incoming: GraphSyncDirtyScopeSourceProgress,
) {
  const merged: GraphSyncDirtyScopeSourceProgress = {
    ...existing,
  };

  for (const [sourceName, incomingState] of Object.entries(incoming)) {
    const existingState = merged[sourceName as keyof GraphSyncDirtyScopeSourceProgress];

    if (
      !existingState ||
      compareGraphSyncCursorPositions(
        {
          cursorTime: existingState.cursorTime,
          cursorPk: existingState.cursorPk,
        },
        {
          cursorTime: incomingState?.cursorTime ?? null,
          cursorPk: incomingState?.cursorPk ?? null,
        },
      ) < 0
    ) {
      merged[sourceName as keyof GraphSyncDirtyScopeSourceProgress] = incomingState;
    }
  }

  return merged;
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

export function createPostgresGraphSyncDirtyScopeStore(
  db?: PostgresDb,
): GraphSyncDirtyScopeStore {
  const resolvedDb = db ?? createPostgresDb().db;

  async function findPendingRow(scope: GraphSyncDirtyScope) {
    const pendingRows = await resolvedDb
      .select()
      .from(graphSyncDirtyScopes)
      .where(
        sql`${graphSyncDirtyScopes.scopeType} = ${scope.scopeType}
          and ${graphSyncDirtyScopes.scopeKey} = ${scope.scopeKey}
          and ${graphSyncDirtyScopes.status} = 'pending'`,
      );

    return pendingRows[0] ?? null;
  }

  async function insertPendingRow(scope: GraphSyncDirtyScope) {
    const insertedRows = await resolvedDb
      .insert(graphSyncDirtyScopes)
      .values({
        id: scope.id,
        scopeType: scope.scopeType,
        scopeKey: scope.scopeKey,
        reason: scope.reason,
        sourceName: scope.sourceName,
        sourcePk: scope.sourcePk,
        sourceProgress: scope.sourceProgress,
        firstDetectedAt: new Date(scope.firstDetectedAt),
        lastDetectedAt: new Date(scope.lastDetectedAt),
        status: scope.status,
        attemptCount: scope.attemptCount,
        lastRunId: scope.lastRunId,
        errorSummary: null,
      })
      .returning();

    return rowToGraphSyncDirtyScope(insertedRows[0]);
  }

  async function updatePendingRow(
    pendingRow: GraphSyncDirtyScopeRow,
    scope: GraphSyncDirtyScope,
  ) {
    const mergedSourceProgress = mergeSourceProgress(
      pendingRow.sourceProgress as GraphSyncDirtyScopeSourceProgress,
      scope.sourceProgress,
    );

    const updatedRows = await resolvedDb
      .update(graphSyncDirtyScopes)
      .set({
        reason: scope.reason,
        sourceName: scope.sourceName,
        sourcePk: scope.sourcePk,
        sourceProgress: mergedSourceProgress,
        lastDetectedAt: new Date(scope.lastDetectedAt),
      })
      .where(eq(graphSyncDirtyScopes.id, pendingRow.id))
      .returning();

    return rowToGraphSyncDirtyScope(updatedRows[0]);
  }

  return {
    async upsertPending(scope) {
      let pendingRow = await findPendingRow(scope);

      if (!pendingRow) {
        try {
          return await insertPendingRow(scope);
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }

          pendingRow = await findPendingRow(scope);

          if (!pendingRow) {
            throw error;
          }
        }
      }

      return updatePendingRow(pendingRow, scope);
    },

    async listPendingBySource(sourceName) {
      const rows = await resolvedDb
        .select()
        .from(graphSyncDirtyScopes)
        .where(
          sql`${graphSyncDirtyScopes.status} = 'pending'
            and ${graphSyncDirtyScopes.sourceProgress} ? ${sourceName}`,
        )
        .orderBy(graphSyncDirtyScopes.firstDetectedAt);

      return rows.map(rowToGraphSyncDirtyScope);
    },

    async listFailedBySource(sourceName) {
      const rows = await resolvedDb
        .select()
        .from(graphSyncDirtyScopes)
        .where(
          sql`${graphSyncDirtyScopes.status} = 'failed'
            and ${graphSyncDirtyScopes.sourceProgress} ? ${sourceName}`,
        )
        .orderBy(graphSyncDirtyScopes.lastDetectedAt);

      return rows.map(rowToGraphSyncDirtyScope);
    },

    async listDispatchableBySource(sourceName) {
      return this.listPendingBySource(sourceName);
    },

    async markPending(scope) {
      const rows = await resolvedDb
        .update(graphSyncDirtyScopes)
        .set({
          status: 'pending',
          errorSummary: null,
        })
        .where(eq(graphSyncDirtyScopes.id, scope.id))
        .returning();

      return rowToGraphSyncDirtyScope(rows[0]);
    },

    async markProcessing(scope) {
      const rows = await resolvedDb
        .update(graphSyncDirtyScopes)
        .set({
          status: 'processing',
          attemptCount: scope.attemptCount + 1,
          errorSummary: null,
        })
        .where(eq(graphSyncDirtyScopes.id, scope.id))
        .returning();

      return rowToGraphSyncDirtyScope(rows[0]);
    },

    async markCompleted(scope, input) {
      const rows = await resolvedDb
        .update(graphSyncDirtyScopes)
        .set({
          status: 'completed',
          lastRunId: input.lastRunId,
          errorSummary: null,
        })
        .where(eq(graphSyncDirtyScopes.id, scope.id))
        .returning();

      return rowToGraphSyncDirtyScope(rows[0]);
    },

    async markFailed(scope, input) {
      const rows = await resolvedDb
        .update(graphSyncDirtyScopes)
        .set({
          status: 'failed',
          lastRunId: input.lastRunId,
          errorSummary: input.errorSummary,
        })
        .where(eq(graphSyncDirtyScopes.id, scope.id))
        .returning();

      return rowToGraphSyncDirtyScope(rows[0]);
    },

    async countByStatus() {
      const rows = await resolvedDb
        .select({
          status: graphSyncDirtyScopes.status,
          count: sql<number>`count(*)::int`,
        })
        .from(graphSyncDirtyScopes)
        .groupBy(graphSyncDirtyScopes.status);

      const counts = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      } as const;

      return rows.reduce<Record<'pending' | 'processing' | 'completed' | 'failed', number>>(
        (accumulator, row) => {
          const key = row.status as keyof typeof counts;

          if (key in accumulator) {
            accumulator[key] = row.count;
          }

          return accumulator;
        },
        {
          ...counts,
        },
      );
    },

    async listRecentFailures(limit) {
      if (limit <= 0) {
        return [];
      }

      const rows = await resolvedDb
        .select()
        .from(graphSyncDirtyScopes)
        .where(eq(graphSyncDirtyScopes.status, 'failed'))
        .orderBy(desc(graphSyncDirtyScopes.lastDetectedAt))
        .limit(limit);

      return rows.map(rowToGraphSyncDirtyScope);
    },
  };
}
