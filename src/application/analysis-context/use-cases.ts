import {
  extractAnalysisContext,
  type AnalysisContext,
} from '@/domain/analysis-context/models';

export type AnalysisContextReadModel = {
  sessionId: string;
  context: AnalysisContext;
};

export function createAnalysisContextUseCases() {
  return {
    buildContextReadModel({
      sessionId,
      questionText,
    }: {
      sessionId: string;
      questionText: string;
    }): AnalysisContextReadModel {
      return {
        sessionId,
        context: extractAnalysisContext(questionText),
      };
    },
  };
}
