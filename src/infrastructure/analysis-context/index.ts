import { createAnalysisContextUseCases } from '@/application/analysis-context/use-cases';
import { createMemoryAnalysisContextStore } from './memory-analysis-context-store';

export const analysisContextUseCases = createAnalysisContextUseCases({
  analysisContextStore: createMemoryAnalysisContextStore(),
});
