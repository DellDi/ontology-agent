import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';
import type { CandidateFactorReadModel } from '@/application/factor-expansion/use-cases';
import {
  buildAnalysisPlan,
  buildAnalysisPlanFromGroundedContext,
  buildAnalysisPlanDiff,
  type AnalysisPlan,
  type AnalysisPlanDiff,
  type AnalysisPlanMode,
} from '@/domain/analysis-plan/models';
import type { AnalysisExecutionPlanSnapshot } from '@/domain/analysis-execution/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';
import type { OntologyGroundedContext } from '@/domain/ontology/grounding';

export type AnalysisPlanStepReadModel = {
  id: string;
  order: number;
  title: string;
  objective: string;
  dependencyLabels: string[];
};

export type AnalysisPlanReadModel = {
  mode: AnalysisPlanMode;
  headline: string;
  summary: string;
  steps: AnalysisPlanStepReadModel[];
};

export type VersionedAnalysisPlanReadModel = {
  version: number;
  plan: AnalysisPlanReadModel;
  diff: AnalysisPlanDiff;
};

export function createAnalysisPlanningUseCases() {
  function buildPlanReadModelFromSnapshot(
    plan: AnalysisExecutionPlanSnapshot,
  ): AnalysisPlanReadModel {
    const titleById = new Map(
      plan.steps.map((step) => [step.id, `步骤 ${step.order} · ${step.title}`]),
    );

    return {
      mode: plan.mode,
      headline: '分析计划',
      summary: plan.summary,
      steps: plan.steps.map((step) => ({
        id: step.id,
        order: step.order,
        title: step.title,
        objective: step.objective,
        dependencyLabels: step.dependencyIds
          .map((dependencyId) => titleById.get(dependencyId))
          .filter((value): value is string => Boolean(value)),
      })),
    };
  }

  function buildPlanFromInputs({
    intentType,
    contextReadModel,
    candidateFactorReadModel,
  }: {
    intentType: AnalysisIntentType;
    contextReadModel: AnalysisContextReadModel;
    candidateFactorReadModel: CandidateFactorReadModel;
  }) {
    return buildAnalysisPlan({
      intentType,
      context: contextReadModel.context,
      candidateFactors: candidateFactorReadModel.factors,
      shouldExpandFactors: candidateFactorReadModel.mode === 'expand',
    });
  }

  return {
    buildPlan({
      intentType,
      contextReadModel,
      candidateFactorReadModel,
    }: {
      intentType: AnalysisIntentType;
      contextReadModel: AnalysisContextReadModel;
      candidateFactorReadModel: CandidateFactorReadModel;
    }) {
      return buildPlanFromInputs({
        intentType,
        contextReadModel,
        candidateFactorReadModel,
      });
    },

    buildPlanReadModelFromSnapshot({
      planSnapshot,
    }: {
      planSnapshot: AnalysisExecutionPlanSnapshot;
    }): AnalysisPlanReadModel {
      return buildPlanReadModelFromSnapshot(planSnapshot);
    },

    buildPlanReadModel({
      intentType,
      contextReadModel,
      candidateFactorReadModel,
    }: {
      intentType: AnalysisIntentType;
      contextReadModel: AnalysisContextReadModel;
      candidateFactorReadModel: CandidateFactorReadModel;
    }): AnalysisPlanReadModel {
      const plan = buildPlanFromInputs({
        intentType,
        contextReadModel,
        candidateFactorReadModel,
      });

      return buildPlanReadModelFromSnapshot(plan);
    },

    buildPlanVersionDiff(input: {
      previousPlanSnapshot: AnalysisPlan;
      nextPlanSnapshot: AnalysisPlan;
      reusableCompletedStepIds: string[];
      reason: string;
    }) {
      return buildAnalysisPlanDiff({
        previousPlan: input.previousPlanSnapshot,
        nextPlan: input.nextPlanSnapshot,
        reusableCompletedStepIds: input.reusableCompletedStepIds,
        reason: input.reason,
      });
    },

    /**
     * 基于 Ontology Grounded Context 构建计划 (Story 9.3)
     *
     * AC2: planner 消费 grounded definitions 而非自由文本
     */
    buildPlanFromGroundedContext({
      intentType,
      groundedContext,
      contextReadModel,
      candidateFactorReadModel,
    }: {
      intentType: AnalysisIntentType;
      groundedContext: OntologyGroundedContext;
      contextReadModel: AnalysisContextReadModel;
      candidateFactorReadModel: CandidateFactorReadModel;
    }): AnalysisPlanReadModel & {
      _groundedSource: string;
      _groundingStatus: OntologyGroundedContext['groundingStatus'];
    } {
      const plan = buildAnalysisPlanFromGroundedContext({
        intentType,
        groundedContext,
        legacyContext: contextReadModel.context,
        candidateFactors: candidateFactorReadModel.factors,
        shouldExpandFactors: candidateFactorReadModel.mode === 'expand',
      });

      const readModel = buildPlanReadModelFromSnapshot(plan);

      return {
        ...readModel,
        _groundedSource: plan._groundedSource,
        _groundingStatus: plan._groundingStatus,
      };
    },
  };
}
