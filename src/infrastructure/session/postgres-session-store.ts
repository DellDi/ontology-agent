import { randomUUID } from 'node:crypto';

import { eq, and, gt } from 'drizzle-orm';

import type { SessionStore } from '@/application/auth/ports';
import type { AuthIdentity, AuthSession } from '@/domain/auth/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { authSessions } from '@/infrastructure/postgres/schema/auth-sessions';

const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

function rowToAuthSession(row: typeof authSessions.$inferSelect): AuthSession {
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    displayName: row.displayName,
    scope: {
      organizationId: row.organizationId,
      projectIds: row.projectIds,
      areaIds: row.areaIds,
      roleCodes: row.roleCodes,
    },
    expiresAt: row.expiresAt.toISOString(),
  };
}

export function createPostgresSessionStore(db?: PostgresDb): SessionStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async createSession(identity: AuthIdentity) {
      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      const session: AuthSession = {
        ...identity,
        sessionId,
        expiresAt: expiresAt.toISOString(),
      };

      await resolvedDb.insert(authSessions).values({
        sessionId,
        userId: identity.userId,
        displayName: identity.displayName,
        organizationId: identity.scope.organizationId,
        projectIds: identity.scope.projectIds,
        areaIds: identity.scope.areaIds,
        roleCodes: identity.scope.roleCodes,
        expiresAt,
      });

      return session;
    },

    async getSession(sessionId: string) {
      const rows = await resolvedDb
        .select()
        .from(authSessions)
        .where(
          and(
            eq(authSessions.sessionId, sessionId),
            gt(authSessions.expiresAt, new Date()),
          ),
        )
        .limit(1);

      const row = rows[0];

      if (!row) {
        return null;
      }

      return rowToAuthSession(row);
    },

    async deleteSession(sessionId: string) {
      await resolvedDb
        .delete(authSessions)
        .where(eq(authSessions.sessionId, sessionId));
    },
  };
}
