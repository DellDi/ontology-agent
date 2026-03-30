import type {
  LlmChatCompletionRequest,
  LlmInvocationContext,
  LlmResponseRequest,
} from './models';
import type { LlmProviderPort } from './ports';

type LlmUseCasesDependencies = {
  provider: LlmProviderPort;
};

export function createLlmUseCases({ provider }: LlmUseCasesDependencies) {
  return {
    async createResponse(
      request: LlmResponseRequest,
      context: LlmInvocationContext,
    ) {
      return await provider.createResponse(request, context);
    },

    async createChatCompletion(
      request: LlmChatCompletionRequest,
      context: LlmInvocationContext,
    ) {
      return await provider.createChatCompletion(request, context);
    },

    async checkHealth() {
      return await provider.checkHealth();
    },
  };
}
