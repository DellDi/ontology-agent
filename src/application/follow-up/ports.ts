import type { AnalysisSessionFollowUp } from '@/domain/analysis-session/follow-up-models';

export interface AnalysisSessionFollowUpStore {
  create(
    followUp: AnalysisSessionFollowUp,
  ): Promise<AnalysisSessionFollowUp>;
  listBySessionId(input: {
    sessionId: string;
    ownerUserId: string;
  }): Promise<AnalysisSessionFollowUp[]>;
}
