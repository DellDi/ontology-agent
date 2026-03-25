import type { AnalysisSession } from '@/domain/analysis-session/models';

export interface AnalysisSessionStore {
  create(session: AnalysisSession): Promise<AnalysisSession>;
  getById(sessionId: string): Promise<AnalysisSession | null>;
  listByOwner(ownerUserId: string): Promise<AnalysisSession[]>;
}
