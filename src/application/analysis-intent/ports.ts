import type { AnalysisIntent } from '@/domain/analysis-intent/models';

export interface AnalysisIntentStore {
  save(intent: AnalysisIntent): Promise<AnalysisIntent>;
  getBySessionId(sessionId: string): Promise<AnalysisIntent | null>;
}
