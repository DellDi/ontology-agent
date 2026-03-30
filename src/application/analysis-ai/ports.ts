import type { LlmResponseRequest } from '@/application/llm/models';
import type {
  AnalysisAiTaskType,
  StructuredTaskParseResult,
} from '@/domain/analysis-ai/models';

export interface AnalysisAiContractPort {
  buildRequest(taskType: AnalysisAiTaskType, input: unknown): LlmResponseRequest;
  parseOutput<TTaskType extends AnalysisAiTaskType>(input: {
    taskType: TTaskType;
    rawText: string;
    raw: Record<string, unknown>;
  }): StructuredTaskParseResult<TTaskType>;
}
