import { createAnalysisIntentUseCases } from '@/application/analysis-intent/use-cases';
import { createMemoryAnalysisIntentStore } from '@/infrastructure/analysis-intent/memory-analysis-intent-store';

export const analysisIntentUseCases = createAnalysisIntentUseCases({
  analysisIntentStore: createMemoryAnalysisIntentStore(),
});
