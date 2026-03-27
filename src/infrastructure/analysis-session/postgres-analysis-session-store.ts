import { eq, desc } from 'drizzle-orm';

import type { AnalysisSessionStore } from '@/application/analysis-session/ports';
import type { AnalysisSession } from '@/domain/analysis-session/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { analysisSessions } from '@/infrastructure/postgres/schema/analysis-sessions';

function rowToAnalysisSession(
  row: typeof analysisSessions.$inferSelect,
): AnalysisSession {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    organizationId: row.organizationId,
    projectIds: row.projectIds,
    areaIds: row.areaIds,
    questionText: row.questionText,
    savedContext: row.savedContext as AnalysisSession['savedContext'],
    status: row.status as AnalysisSession['status'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresAnalysisSessionStore(
  db?: PostgresDb,
): AnalysisSessionStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async create(session: AnalysisSession) {
      await resolvedDb.insert(analysisSessions).values({
        id: session.id,
        ownerUserId: session.ownerUserId,
        organizationId: session.organizationId,
        projectIds: session.projectIds,
        areaIds: session.areaIds,
        questionText: session.questionText,
        savedContext: session.savedContext,
        status: session.status,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
      });

      return session;
    },

    async getById(sessionId: string) {
      const rows = await resolvedDb
        .select()
        .from(analysisSessions)
        .where(eq(analysisSessions.id, sessionId))
        .limit(1);

      const row = rows[0];

      if (!row) {
        return null;
      }

      return rowToAnalysisSession(row);
    },

    async listByOwner(ownerUserId: string) {
      const rows = await resolvedDb
        .select()
        .from(analysisSessions)
        .where(eq(analysisSessions.ownerUserId, ownerUserId))
        .orderBy(desc(analysisSessions.updatedAt));

      return rows.map(rowToAnalysisSession);
    },

    async delete(sessionId: string) {
      await resolvedDb
        .delete(analysisSessions)
        .where(eq(analysisSessions.id, sessionId));
    },
  };
}
