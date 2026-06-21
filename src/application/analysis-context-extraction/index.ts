export {
  llmContextExtractionOutputSchema,
  llmContextExtractionInputSchema,
} from './schemas';
export type {
  LlmContextExtractionOutput,
  LlmContextExtractionInput,
} from './schemas';

export type { ContextExtractionPort } from './ports';

export { createContextExtractionUseCases } from './use-cases';
export type {
  ContextExtractionResult,
  ExtractionIssue,
} from './use-cases';

export { normalizeLlmExtractionOutput } from './normalization';
export type {
  NormalizationContext,
  NormalizedExtraction,
} from './normalization';

export {
  buildMetricDictionaryFromOntology,
  buildProjectNameDictionary,
  summarizeOntologyForContextExtraction,
} from './dictionaries';

export { resolveAutoGuessDecision } from './auto-guess-strategy';
export type { AutoGuessDecision } from './auto-guess-strategy';
