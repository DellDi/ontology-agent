import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';
import type { AnalysisPlanReadModel } from '@/application/analysis-planning/use-cases';
import type { CandidateFactorReadModel } from '@/application/factor-expansion/use-cases';
import type { AnalysisExecutionPlanSnapshot } from '@/domain/analysis-execution/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';
import {
  OntologyGroundingError,
  type OntologyGroundedContext,
} from '@/domain/ontology/grounding';

import type {
  OntologyGroundedContextStore,
} from './grounding';

type GroundingUseCases = {
  groundAnalysisContext: (input: {
    sessionId: string;
    ownerUserId: string;
    analysisContext: AnalysisContextReadModel['context'];
    allowFallbackToFreeText?: boolean;
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

type GroundingIssueType =
  | 'entity'
  | 'metric'
  | 'factor'
  | 'time'
  | 'version'
  | 'permission';

const HARD_BLOCKING_ISSUE_TYPES = new Set<GroundingIssueType>([
  'entity',
  'metric',
  'version',
  'permission',
]);

function collectGroundingIssueTypes(
  error: OntologyGroundingError,
): Set<GroundingIssueType> {
  const types = new Set<GroundingIssueType>();

  error.details.failedItems.forEach((item) => {
    types.add(item.type);
  });
  (error.details.ambiguousItems ?? []).forEach((item) => {
    types.add(item.type);
  });

  return types;
}

export function isHardBlockingGroundingError(error: OntologyGroundingError) {
  const issueTypes = collectGroundingIssueTypes(error);

  for (const issueType of issueTypes) {
    if (HARD_BLOCKING_ISSUE_TYPES.has(issueType)) {
      return true;
    }
  }

  return false;
}

export function buildAutoExecutionAssumptions(error: OntologyGroundingError) {
  const issueTypes = collectGroundingIssueTypes(error);
  const assumptions: string[] = [];

  if (issueTypes.has('time')) {
    assumptions.push('时间语义暂未完全治理化，先按当前问题中的时间范围继续执行。');
  }

  if (issueTypes.has('factor')) {
    assumptions.push('部分候选因素未命中或存在歧义，先按已识别因素推进后续验证。');
  }

  return assumptions;
}

function appendAssumptionsToSummary(summary: string, assumptions: string[]) {
  if (!assumptions.length) {
    return summary;
  }

  return `${summary} 自动假设：${assumptions.join('；')}`;
}

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
  let groundedContext: OntologyGroundedContext;
  let autoExecutionAssumptions: string[] = [];

  try {
    groundedContext = await input.groundingUseCases.groundAnalysisContext({
      sessionId: input.sessionId,
      ownerUserId: input.ownerUserId,
      analysisContext: input.contextReadModel.context,
    });
  } catch (error) {
    if (!(error instanceof OntologyGroundingError)) {
      throw error;
    }

    if (isHardBlockingGroundingError(error)) {
      throw error;
    }

    autoExecutionAssumptions = buildAutoExecutionAssumptions(error);

    // P5 fix: 直接复用 grounding 错误中携带的已构建 groundedContext，
    // 避免对同一上下文再次发起 grounding 造成双倍 DB 往返。
    // 仅当错误未附带已构建 context（防御性兜底）时才降级为二次调用。
    if (error.details.groundedContext) {
      groundedContext = error.details.groundedContext;
    } else {
      groundedContext = await input.groundingUseCases.groundAnalysisContext({
        sessionId: input.sessionId,
        ownerUserId: input.ownerUserId,
        analysisContext: input.contextReadModel.context,
        allowFallbackToFreeText: true,
      });
    }
  }

  await input.groundedContextStore?.save({
    ...groundedContext,
    sessionId: input.sessionId,
    ownerUserId: input.ownerUserId,
  });

  const groundedPlanSnapshot =
    input.analysisPlanningUseCases.buildPlanSnapshotFromGroundedContext({
      intentType: input.intentType,
      groundedContext,
      candidateFactorReadModel: input.candidateFactorReadModel,
    });
  const planSnapshot = {
    ...groundedPlanSnapshot,
    summary: appendAssumptionsToSummary(
      groundedPlanSnapshot.summary,
      autoExecutionAssumptions,
    ),
    _executionAssumptions: autoExecutionAssumptions,
  };

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
    assumptions: [],
    steps: [],
  };
}
