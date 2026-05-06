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
    planVersion?: AnalysisSessionFollowUp['planVersion'];
    currentPlanSnapshot?: AnalysisSessionFollowUp['currentPlanSnapshot'];
    previousPlanSnapshot?: AnalysisSessionFollowUp['previousPlanSnapshot'];
    currentPlanDiff?: AnalysisSessionFollowUp['currentPlanDiff'];
  }): Promise<AnalysisSessionFollowUp | null>;
  updatePlanState(input: {
    followUpId: string;
    ownerUserId: string;
    planVersion: number;
    currentPlanSnapshot: NonNullable<AnalysisSessionFollowUp['currentPlanSnapshot']>;
    previousPlanSnapshot: NonNullable<AnalysisSessionFollowUp['previousPlanSnapshot']>;
    currentPlanDiff: NonNullable<AnalysisSessionFollowUp['currentPlanDiff']>;
    ontologyVersionId: AnalysisSessionFollowUp['ontologyVersionId'];
    ontologyVersionSource: AnalysisSessionFollowUp['ontologyVersionSource'];
    updatedAt: string;
  }): Promise<AnalysisSessionFollowUp | null>;
  attachResultExecution(input: {
    followUpId: string;
    ownerUserId: string;
    resultExecutionId: string;
    ontologyVersionId?: AnalysisSessionFollowUp['ontologyVersionId'];
    ontologyVersionSource?: AnalysisSessionFollowUp['ontologyVersionSource'];
    updatedAt: string;
  }): Promise<AnalysisSessionFollowUp | null>;
  listBySessionId(input: {
    sessionId: string;
    ownerUserId: string;
  }): Promise<AnalysisSessionFollowUp[]>;
}
