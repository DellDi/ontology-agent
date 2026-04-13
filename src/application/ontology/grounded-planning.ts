import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';
import type { AnalysisPlanReadModel } from '@/application/analysis-planning/use-cases';
import type { CandidateFactorReadModel } from '@/application/factor-expansion/use-cases';
import type { AnalysisExecutionPlanSnapshot } from '@/domain/analysis-execution/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';
import type {
  OntologyGroundedContext,
  OntologyGroundingError,
} from '@/domain/ontology/grounding';

import type {
  OntologyGroundedContextStore,
} from './grounding';

type GroundingUseCases = {
  groundAnalysisContext: (input: {
    sessionId: string;
    ownerUserId: string;
    analysisContext: AnalysisContextReadModel['context'];
  }) => Promise<OntologyGroundedContext>;
};

type AnalysisPlanningUseCases = {
  buildPlanSnapshotFromGroundedContext: (input: {
    intentType: AnalysisIntentType;
    groundedContext: OntologyGroundedContext;
    candidateFactorReadModel: CandidateFactorReadModel;
  }) => AnalysisExecutionPlanSnapshot & {
    _groundedSource: string;
    _groundingStatus: OntologyGroundedContext['groundingStatus'];
  };
  buildPlanReadModelFromSnapshot: (input: {
    planSnapshot: AnalysisExecutionPlanSnapshot;
  }) => AnalysisPlanReadModel;
};

export async function buildGroundedPlanningArtifacts(input: {
  sessionId: string;
  ownerUserId: string;
  intentType: AnalysisIntentType;
  contextReadModel: AnalysisContextReadModel;
  candidateFactorReadModel: CandidateFactorReadModel;
  groundingUseCases: GroundingUseCases;
  analysisPlanningUseCases: AnalysisPlanningUseCases;
  groundedContextStore?: OntologyGroundedContextStore;
}) {
  const groundedContext = await input.groundingUseCases.groundAnalysisContext({
    sessionId: input.sessionId,
    ownerUserId: input.ownerUserId,
    analysisContext: input.contextReadModel.context,
  });

  await input.groundedContextStore?.save({
    ...groundedContext,
    sessionId: input.sessionId,
    ownerUserId: input.ownerUserId,
  });

  const planSnapshot =
    input.analysisPlanningUseCases.buildPlanSnapshotFromGroundedContext({
      intentType: input.intentType,
      groundedContext,
      candidateFactorReadModel: input.candidateFactorReadModel,
    });

  return {
    groundedContext,
    planSnapshot,
    planReadModel: input.analysisPlanningUseCases.buildPlanReadModelFromSnapshot({
      planSnapshot,
    }),
  };
}

export function buildGroundingBlockedPlanReadModel(
  error: OntologyGroundingError | Error,
): AnalysisPlanReadModel {
  return {
    mode: 'minimal',
    headline: '治理化计划阻断',
    summary: error.message,
    steps: [],
  };
}
