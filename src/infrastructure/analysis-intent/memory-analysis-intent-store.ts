import type { AnalysisIntentStore } from '@/application/analysis-intent/ports';
import type { AnalysisIntent } from '@/domain/analysis-intent/models';

function getStore() {
  const globalStore = globalThis as typeof globalThis & {
    __dip3AnalysisIntentStore?: Map<string, AnalysisIntent>;
  };

  if (!globalStore.__dip3AnalysisIntentStore) {
    globalStore.__dip3AnalysisIntentStore = new Map<string, AnalysisIntent>();
  }

  return globalStore.__dip3AnalysisIntentStore;
}

export function createMemoryAnalysisIntentStore(): AnalysisIntentStore {
  const store = getStore();

  return {
    async save(intent) {
      store.set(intent.sessionId, intent);
      return intent;
    },

    async getBySessionId(sessionId) {
      return store.get(sessionId) ?? null;
    },
  };
}
