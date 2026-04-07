import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';
import type { CandidateFactorReadModel } from '@/application/factor-expansion/use-cases';
import {
  buildAnalysisPlan,
  type AnalysisPlanMode,
} from '@/domain/analysis-plan/models';
import type { AnalysisExecutionPlanSnapshot } from '@/domain/analysis-execution/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';

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
  };
}
