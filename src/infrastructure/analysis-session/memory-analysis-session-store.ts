import type { AnalysisSessionStore } from '@/application/analysis-session/ports';
import type { AnalysisSession } from '@/domain/analysis-session/models';

function getStore() {
  const globalStore = globalThis as typeof globalThis & {
    __dip3AnalysisSessionStore?: Map<string, AnalysisSession>;
  };

  if (!globalStore.__dip3AnalysisSessionStore) {
    globalStore.__dip3AnalysisSessionStore = new Map<string, AnalysisSession>();
  }

  return globalStore.__dip3AnalysisSessionStore;
}

export function createMemoryAnalysisSessionStore(): AnalysisSessionStore {
  const store = getStore();

  return {
    async create(session) {
      store.set(session.id, session);
      return session;
    },

    async getById(sessionId) {
      return store.get(sessionId) ?? null;
    },

    async listByOwner(ownerUserId) {
      return Array.from(store.values())
        .filter((session) => session.ownerUserId === ownerUserId)
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        );
    },

    async updateSavedContext({
      sessionId,
      ownerUserId,
      savedContext,
      updatedAt,
    }) {
      const session = store.get(sessionId);

      if (!session || session.ownerUserId !== ownerUserId) {
        return null;
      }

      const updated = {
        ...session,
        savedContext,
        updatedAt,
      };
      store.set(sessionId, updated);

      return updated;
    },

    async delete(sessionId) {
      store.delete(sessionId);
    },
  };
}
