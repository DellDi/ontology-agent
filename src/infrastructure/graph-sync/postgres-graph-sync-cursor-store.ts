import { eq } from 'drizzle-orm';

import type { GraphSyncCursorStore } from '@/application/graph-sync/runtime-ports';
import type { GraphSyncCursor } from '@/domain/graph-sync/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { graphSyncCursors } from '@/infrastructure/postgres/schema/graph-sync-cursors';

function rowToGraphSyncCursor(
  row: typeof graphSyncCursors.$inferSelect,
): GraphSyncCursor {
  return {
    sourceName: row.sourceName as GraphSyncCursor['sourceName'],
    cursorTime: row.cursorTime?.toISOString() ?? null,
    cursorPk: row.cursorPk,
    lastRunId: row.lastRunId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresGraphSyncCursorStore(
  db?: PostgresDb,
): GraphSyncCursorStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async getBySourceName(sourceName) {
      const rows = await resolvedDb
        .select()
        .from(graphSyncCursors)
        .where(eq(graphSyncCursors.sourceName, sourceName));

      return rows[0] ? rowToGraphSyncCursor(rows[0]) : null;
    },

    async save(cursor) {
      const rows = await resolvedDb
        .insert(graphSyncCursors)
        .values({
          sourceName: cursor.sourceName,
          cursorTime: cursor.cursorTime ? new Date(cursor.cursorTime) : null,
          cursorPk: cursor.cursorPk,
          lastRunId: cursor.lastRunId,
          updatedAt: new Date(cursor.updatedAt),
        })
        .onConflictDoUpdate({
          target: graphSyncCursors.sourceName,
          set: {
            cursorTime: cursor.cursorTime ? new Date(cursor.cursorTime) : null,
            cursorPk: cursor.cursorPk,
            lastRunId: cursor.lastRunId,
            updatedAt: new Date(cursor.updatedAt),
          },
        })
        .returning();

      return rowToGraphSyncCursor(rows[0]);
    },
  };
}
