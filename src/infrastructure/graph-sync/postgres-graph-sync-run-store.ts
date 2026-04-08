import type { GraphSyncRunStore } from '@/application/graph-sync/runtime-ports';
import type { GraphSyncRun } from '@/domain/graph-sync/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { graphSyncRuns } from '@/infrastructure/postgres/schema/graph-sync-runs';

function rowToGraphSyncRun(
  row: typeof graphSyncRuns.$inferSelect,
): GraphSyncRun {
  return {
    id: row.id,
    mode: row.mode as GraphSyncRun['mode'],
    status: row.status as GraphSyncRun['status'],
    scopeType: row.scopeType as GraphSyncRun['scopeType'],
    scopeKey: row.scopeKey,
    triggerType: row.triggerType as GraphSyncRun['triggerType'],
    triggeredBy: row.triggeredBy,
    cursorSnapshot: row.cursorSnapshot as GraphSyncRun['cursorSnapshot'],
    nodesWritten: row.nodesWritten,
    edgesWritten: row.edgesWritten,
    errorSummary: row.errorSummary,
    errorDetail: row.errorDetail as GraphSyncRun['errorDetail'],
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresGraphSyncRunStore(
  db?: PostgresDb,
): GraphSyncRunStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async save(run) {
      const rows = await resolvedDb
        .insert(graphSyncRuns)
        .values({
          id: run.id,
          mode: run.mode,
          status: run.status,
          scopeType: run.scopeType,
          scopeKey: run.scopeKey,
          triggerType: run.triggerType,
          triggeredBy: run.triggeredBy,
          cursorSnapshot: run.cursorSnapshot,
          nodesWritten: run.nodesWritten,
          edgesWritten: run.edgesWritten,
          errorSummary: run.errorSummary,
          errorDetail: run.errorDetail,
          startedAt: run.startedAt ? new Date(run.startedAt) : null,
          finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
          createdAt: new Date(run.createdAt),
          updatedAt: new Date(run.updatedAt),
        })
        .onConflictDoUpdate({
          target: graphSyncRuns.id,
          set: {
            mode: run.mode,
            status: run.status,
            scopeType: run.scopeType,
            scopeKey: run.scopeKey,
            triggerType: run.triggerType,
            triggeredBy: run.triggeredBy,
            cursorSnapshot: run.cursorSnapshot,
            nodesWritten: run.nodesWritten,
            edgesWritten: run.edgesWritten,
            errorSummary: run.errorSummary,
            errorDetail: run.errorDetail,
            startedAt: run.startedAt ? new Date(run.startedAt) : null,
            finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
            updatedAt: new Date(run.updatedAt),
          },
        })
        .returning();

      return rowToGraphSyncRun(rows[0]);
    },
  };
}
