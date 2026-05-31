/**
 * Story 12-4: LLM 上下文抽取基础设施入口。
 *
 * 提供可直接在 API route 中使用的 LLM 抽取用例实例。
 * LLM 不可用时自动降级到规则抽取（由 use-cases 层处理）。
 */
import { createContextExtractionUseCases } from '@/application/analysis-context-extraction/use-cases';
import { createOpenAiCompatibleLlmProvider } from '@/infrastructure/llm';
import { createLlmContextExtractionAdapter } from './llm-context-extraction-adapter';

let cachedUseCases: ReturnType<typeof createContextExtractionUseCases> | null =
  null;

export function getLlmContextExtractionUseCases() {
  if (cachedUseCases) {
    return cachedUseCases;
  }

  const llmProvider = createOpenAiCompatibleLlmProvider();
  const extractionPort = createLlmContextExtractionAdapter({ llmProvider });

  cachedUseCases = createContextExtractionUseCases({ extractionPort });
  return cachedUseCases;
}
