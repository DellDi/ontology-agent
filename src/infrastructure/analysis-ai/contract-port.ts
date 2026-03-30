import type { AnalysisAiContractPort } from '@/application/analysis-ai/ports';
import type { AnalysisAiTaskType } from '@/domain/analysis-ai/models';
import { buildStructuredTaskRequest } from '@/infrastructure/llm/prompt-registry';
import { parseStructuredTaskOutput } from '@/infrastructure/llm/schema-guardrails';

export function createAnalysisAiContractPort(): AnalysisAiContractPort {
  return {
    buildRequest(taskType: AnalysisAiTaskType, input: unknown) {
      return buildStructuredTaskRequest(taskType, input);
    },

    parseOutput({ taskType, rawText, raw }) {
      return parseStructuredTaskOutput({
        taskType,
        rawText,
        raw,
      });
    },
  };
}
