import type { AnalysisSession } from '@/domain/analysis-session/models';
import type { AnalysisContext } from '@/domain/analysis-context/models';

export interface AnalysisSessionStore {
  create(session: AnalysisSession): Promise<AnalysisSession>;
  getById(sessionId: string): Promise<AnalysisSession | null>;
  listByOwner(ownerUserId: string): Promise<AnalysisSession[]>;
  updateSavedContext(input: {
    sessionId: string;
    ownerUserId: string;
    savedContext: AnalysisContext;
    updatedAt: string;
  }): Promise<AnalysisSession | null>;
  delete(sessionId: string): Promise<void>;
}
