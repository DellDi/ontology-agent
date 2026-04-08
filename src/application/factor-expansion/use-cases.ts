import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';
import type { GraphCandidateFactor } from '@/domain/graph/models';
import {
  expandCandidateFactors,
  type CandidateFactor,
} from '@/domain/factor-expansion/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';
import type { ReturnTypeOfCreateGraphUseCases } from '@/shared/types/graph';

export type CandidateFactorReadModel = {
  mode: 'expand' | 'skip';
  headline: string;
  disclaimer: string;
  skipReason?: string;
  basisLabel: string;
  factors: (CandidateFactor & {
    relationType?: string;
    direction?: string;
    source?: string;
  })[];
};

function mapGraphFactor(factor: GraphCandidateFactor): CandidateFactorReadModel['factors'][number] {
  return {
    key: factor.factorKey,
    label: factor.factorLabel,
    rationale: factor.explanation,
    relationType: factor.relationType,
    direction: factor.direction,
    source: factor.source,
  };
}

type GraphUseCases = {
  expandCandidateFactors: ReturnTypeOfCreateGraphUseCases['expandCandidateFactors'];
};

export function createFactorExpansionUseCases({
  graphUseCases,
}: {
  graphUseCases: GraphUseCases;
}) {
  return {
    async buildCandidateFactorReadModel({
      intentType,
      questionText,
      contextReadModel,
    }: {
      intentType: AnalysisIntentType;
      questionText: string;
      contextReadModel: AnalysisContextReadModel;
    }): Promise<CandidateFactorReadModel> {
      let graphResult:
        | Awaited<ReturnType<GraphUseCases['expandCandidateFactors']>>
        | null = null;
      let graphUnavailable = false;

      try {
        graphResult = await graphUseCases.expandCandidateFactors({
          intentType,
          metric: contextReadModel.context.targetMetric.value,
          entity: contextReadModel.context.entity.value,
          timeRange: contextReadModel.context.timeRange.value,
          questionText,
        });
      } catch {
        graphUnavailable = true;
      }

      if (graphResult?.mode === 'expand' && graphResult.factors.length > 0) {
        return {
          mode: 'expand',
          headline: '候选影响因素',
          disclaimer: '这些因素不是最终结论，而是系统基于图谱关系与治理因果边扩展出的候选方向。',
          basisLabel: '图谱关系与当前指标的相关依据',
          factors: graphResult.factors.map(mapGraphFactor),
        };
      }

      const ruleFallback = expandCandidateFactors({
        intentType,
        questionText,
        context: contextReadModel.context,
      });

      return {
        mode: ruleFallback.mode,
        headline:
          ruleFallback.mode === 'expand' ? '候选影响因素' : '候选因素扩展已跳过',
        disclaimer: graphUnavailable
          ? '图谱候选因素暂不可用，系统已回退到治理规则候选方向。'
          : ruleFallback.disclaimer,
        skipReason: ruleFallback.skipReason,
        basisLabel: '与当前指标或实体的相关依据',
        factors: ruleFallback.factors.map((factor) => ({
          ...factor,
          source: 'governed-rule',
        })),
      };
    },
  };
}
