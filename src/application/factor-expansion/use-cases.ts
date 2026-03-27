import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';
import {
  expandCandidateFactors,
  type CandidateFactor,
} from '@/domain/factor-expansion/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';

export type CandidateFactorReadModel = {
  mode: 'expand' | 'skip';
  headline: string;
  disclaimer: string;
  skipReason?: string;
  basisLabel: string;
  factors: CandidateFactor[];
};

export function createFactorExpansionUseCases() {
  return {
    buildCandidateFactorReadModel({
      intentType,
      questionText,
      contextReadModel,
    }: {
      intentType: AnalysisIntentType;
      questionText: string;
      contextReadModel: AnalysisContextReadModel;
    }): CandidateFactorReadModel {
      const result = expandCandidateFactors({
        intentType,
        questionText,
        context: contextReadModel.context,
      });

      return {
        mode: result.mode,
        headline:
          result.mode === 'expand' ? '候选影响因素' : '候选因素扩展已跳过',
        disclaimer: result.disclaimer,
        skipReason: result.skipReason,
        basisLabel: '与当前指标或实体的相关依据',
        factors: result.factors,
      };
    },
  };
}
