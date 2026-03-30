import type { LlmInvocationContext, LlmTextResult } from '@/application/llm/models';
import type { AnalysisAiContractPort } from '@/application/analysis-ai/ports';
import type {
  AnalysisAiTaskRequest,
  AnalysisAiTaskResult,
  AnalysisAiTaskType,
} from '@/domain/analysis-ai/models';

type LlmResponseCreator = {
  createResponse: (
    request: { input: string; systemPrompt?: string; model?: string },
    context: LlmInvocationContext,
  ) => Promise<LlmTextResult>;
};

type AnalysisAiUseCasesDependencies = {
  llmUseCases: LlmResponseCreator;
  contractPort: AnalysisAiContractPort;
};

export function createAnalysisAiUseCases({
  llmUseCases,
  contractPort,
}: AnalysisAiUseCasesDependencies) {
  return {
    async runTask<TTaskType extends AnalysisAiTaskType>(
      request: AnalysisAiTaskRequest<TTaskType>,
    ): Promise<AnalysisAiTaskResult<TTaskType>> {
      const llmRequest = contractPort.buildRequest(
        request.taskType,
        request.input,
      );
      const providerResult = await llmUseCases.createResponse(
        {
          ...llmRequest,
          model: request.model ?? llmRequest.model,
        },
        request.context,
      );
      const parsedResult = contractPort.parseOutput({
        taskType: request.taskType,
        rawText: providerResult.text,
        raw: providerResult.raw,
      });

      return {
        ...parsedResult,
        providerResult,
      };
    },
  };
}
