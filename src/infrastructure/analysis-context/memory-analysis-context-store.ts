import type { AnalysisContextStore } from '@/application/analysis-context/ports';
import type { VersionedAnalysisContext } from '@/domain/analysis-context/models';

function getStore() {
  const globalStore = globalThis as typeof globalThis & {
    __dip3AnalysisContextStore?: Map<string, VersionedAnalysisContext[]>;
  };

  if (!globalStore.__dip3AnalysisContextStore) {
    globalStore.__dip3AnalysisContextStore = new Map<
      string,
      VersionedAnalysisContext[]
    >();
  }

  return globalStore.__dip3AnalysisContextStore;
}

export function createMemoryAnalysisContextStore(): AnalysisContextStore {
  const store = getStore();

  return {
    async save(versionedContext) {
      const history = store.get(versionedContext.sessionId) ?? [];
      history.push(versionedContext);
      store.set(versionedContext.sessionId, history);
    },

    async getLatest(sessionId) {
      const history = store.get(sessionId);

      if (!history || history.length === 0) {
        return null;
      }

      return history[history.length - 1];
    },

    async getByVersion(sessionId, version) {
      const history = store.get(sessionId);

      if (!history) {
        return null;
      }

      return history.find((entry) => entry.version === version) ?? null;
    },

    async countVersions(sessionId) {
      return store.get(sessionId)?.length ?? 0;
    },
  };
}
