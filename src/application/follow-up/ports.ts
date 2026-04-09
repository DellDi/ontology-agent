import type { AnalysisSessionFollowUp } from '@/domain/analysis-session/follow-up-models';

export interface AnalysisSessionFollowUpStore {
  create(
    followUp: AnalysisSessionFollowUp,
  ): Promise<AnalysisSessionFollowUp>;
  getById(input: {
    followUpId: string;
    ownerUserId: string;
  }): Promise<AnalysisSessionFollowUp | null>;
  updateMergedContext(input: {
    followUpId: string;
    ownerUserId: string;
    mergedContext: AnalysisSessionFollowUp['mergedContext'];
    updatedAt: string;
  }): Promise<AnalysisSessionFollowUp | null>;
  listBySessionId(input: {
    sessionId: string;
    ownerUserId: string;
  }): Promise<AnalysisSessionFollowUp[]>;
}
