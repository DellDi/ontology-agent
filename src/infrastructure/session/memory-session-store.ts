import { randomUUID } from 'node:crypto';

import type { SessionStore } from '@/application/auth/ports';
import type { AuthIdentity, AuthSession } from '@/domain/auth/models';

type SessionRecord = {
  session: AuthSession;
  expiresAtMs: number;
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

function getStore() {
  const globalStore = globalThis as typeof globalThis & {
    __dip3SessionStore?: Map<string, SessionRecord>;
  };

  if (!globalStore.__dip3SessionStore) {
    globalStore.__dip3SessionStore = new Map<string, SessionRecord>();
  }

  return globalStore.__dip3SessionStore;
}

function pruneExpiredSessions(store: Map<string, SessionRecord>) {
  const now = Date.now();

  for (const [sessionId, record] of store.entries()) {
    if (record.expiresAtMs <= now) {
      store.delete(sessionId);
    }
  }
}

export function createMemorySessionStore(): SessionStore {
  const store = getStore();

  return {
    async createSession(identity: AuthIdentity) {
      pruneExpiredSessions(store);

      const sessionId = randomUUID();
      const expiresAtMs = Date.now() + SESSION_TTL_MS;
      const session: AuthSession = {
        ...identity,
        sessionId,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };

      store.set(sessionId, {
        session,
        expiresAtMs,
      });

      return session;
    },

    async getSession(sessionId: string) {
      pruneExpiredSessions(store);

      const record = store.get(sessionId);

      return record?.session ?? null;
    },

    async deleteSession(sessionId: string) {
      store.delete(sessionId);
    },
  };
}
