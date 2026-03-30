import type {
  LlmChatCompletionRequest,
  LlmInvocationContext,
  LlmProviderHealth,
  LlmResponseRequest,
  LlmTextResult,
} from './models';

export interface LlmProviderPort {
  createResponse(
    request: LlmResponseRequest,
    context: LlmInvocationContext,
  ): Promise<LlmTextResult>;

  createChatCompletion(
    request: LlmChatCompletionRequest,
    context: LlmInvocationContext,
  ): Promise<LlmTextResult>;

  checkHealth(): Promise<LlmProviderHealth>;
}
