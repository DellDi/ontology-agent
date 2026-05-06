import 'server-only';

import type {
  LlmChatCompletionRequest,
  LlmInvocationContext,
  LlmMessage,
  LlmProviderConfig,
  LlmProviderHealth,
  LlmResponseFormatConfig,
  LlmResponseRequest,
  LlmTextResult,
} from '@/application/llm/models';
import type { LlmProviderPort } from '@/application/llm/ports';
import { createRedisClient } from '@/infrastructure/redis/client';
import OpenAI from 'openai';
import type { RedisClientType } from 'redis';

import {
  getLlmProviderConfig,
  resolveProviderModelName,
} from './config';
import {
  LlmProviderResponseError,
  LlmProviderTimeoutError,
  LlmProviderUnavailableError,
  LlmRateLimitExceededError,
} from './errors';
import { enforceLlmRateLimit } from './rate-limit';

type OpenAiCompatibleAdapterDependencies = {
  client?: OpenAI;
  config?: LlmProviderConfig;
  redis?: RedisClientType;
};

type JsonRecord = Record<string, unknown>;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error,
) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(createError());
      }, timeoutMs);

      void promise.finally(() => {
        clearTimeout(timer);
      });
    }),
  ]);
}

function shouldRetry(error: unknown, attempt: number, maxRetries: number) {
  if (attempt >= maxRetries) {
    return false;
  }

  if (
    error instanceof LlmRateLimitExceededError ||
    error instanceof LlmProviderResponseError
  ) {
    return false;
  }

  return (
    error instanceof LlmProviderTimeoutError ||
    error instanceof LlmProviderUnavailableError
  );
}

function shouldTryFallbackModel(error: unknown) {
  return (
    error instanceof LlmRateLimitExceededError ||
    error instanceof LlmProviderResponseError ||
    error instanceof LlmProviderTimeoutError ||
    error instanceof LlmProviderUnavailableError
  );
}

function normalizeSdkError(error: unknown): never {
  if (
    error instanceof Error &&
    (error.name === 'APIConnectionTimeoutError' ||
      error.name === 'AbortError' ||
      error.name === 'TimeoutError')
  ) {
    throw new LlmProviderTimeoutError();
  }

  const candidate = error as {
    message?: string;
    name?: string;
    status?: number;
  };

  if (candidate?.status === 429 || candidate?.name === 'RateLimitError') {
    throw new LlmRateLimitExceededError('模型 provider 返回 429 限流响应。');
  }

  if (
    candidate?.status === 400 ||
    candidate?.status === 404 ||
    candidate?.status === 409 ||
    candidate?.status === 422
  ) {
    throw new LlmProviderResponseError(
      `当前模型不可用或不兼容（HTTP ${candidate.status}），应尝试备用模型。`,
    );
  }

  if (
    typeof candidate?.status === 'number' &&
    candidate.status >= 500
  ) {
    throw new LlmProviderUnavailableError(
      `模型 provider 当前不可用（HTTP ${candidate.status}）。`,
    );
  }

  if (candidate?.name === 'APIConnectionError') {
    throw new LlmProviderUnavailableError(
      candidate.message || '模型 provider 当前不可用。',
    );
  }

  if (typeof candidate?.status === 'number') {
    throw new LlmProviderResponseError(
      `模型 provider 返回非预期状态（HTTP ${candidate.status}）。`,
    );
  }

  if (error instanceof Error) {
    throw new LlmProviderResponseError(error.message);
  }

  throw new LlmProviderUnavailableError();
}

function getResponseText(payload: JsonRecord) {
  const extractedText = extractResponseText(payload);

  if (extractedText) {
    return extractedText;
  }

  const payloadErrorMessage = getPayloadErrorMessage(payload);

  if (payloadErrorMessage) {
    throw new LlmProviderResponseError(payloadErrorMessage);
  }

  throw new LlmProviderResponseError('responses 接口未返回可用文本。');
}

function getPayloadErrorMessage(payload: JsonRecord) {
  const error = payload.error;

  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as JsonRecord;

  if (typeof candidate.message === 'string' && candidate.message.trim()) {
    return candidate.message.trim();
  }

  if (typeof candidate.code === 'string' && candidate.code.trim()) {
    return `模型 provider 返回错误代码：${candidate.code.trim()}`;
  }

  return '模型 provider 返回错误，但未附带可读消息。';
}

function extractResponseText(payload: JsonRecord) {
  const outputText = payload.output_text;

  if (typeof outputText === 'string' && outputText.trim()) {
    return outputText.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];

  for (const entry of output) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const content = Array.isArray((entry as JsonRecord).content)
      ? ((entry as JsonRecord).content as unknown[])
      : [];

    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const candidate = item as JsonRecord;
      const text = candidate.text;

      if (typeof text === 'string' && text.trim()) {
        return text.trim();
      }

      if (
        text &&
        typeof text === 'object' &&
        typeof (text as JsonRecord).value === 'string'
      ) {
        const textValue = (text as JsonRecord).value as string;

        if (textValue.trim()) {
          return textValue.trim();
        }
      }
    }
  }

  return null;
}

function getChatCompletionText(payload: JsonRecord) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];

  if (!firstChoice || typeof firstChoice !== 'object') {
    throw new LlmProviderResponseError('chat completions 未返回 choices。');
  }

  const message = (firstChoice as JsonRecord).message;

  if (!message || typeof message !== 'object') {
    throw new LlmProviderResponseError('chat completions 未返回 message。');
  }

  const content = (message as JsonRecord).content;

  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const candidate = item as JsonRecord;
      const text = candidate.text;

      if (typeof text === 'string' && text.trim()) {
        return text.trim();
      }
    }
  }

  throw new LlmProviderResponseError(
    'chat completions 响应缺少可解析的文本内容。',
  );
}

function createOpenAiClient(config: LlmProviderConfig) {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    maxRetries: 0,
    timeout: config.timeoutMs,
  });
}

function mapResponseFormat(
  responseFormat: LlmResponseFormatConfig | undefined,
) {
  if (!responseFormat) {
    return undefined;
  }

  if (responseFormat.type === 'json_object') {
    return {
      type: 'json_object' as const,
    };
  }

  return {
    type: 'json_schema' as const,
    name: responseFormat.name ?? 'structured_output',
    schema: responseFormat.schema ?? { type: 'object' },
    description: responseFormat.description,
    strict: responseFormat.strict ?? true,
  };
}

function mapChatCompletionResponseFormat(
  responseFormat: LlmResponseFormatConfig | undefined,
) {
  if (!responseFormat) {
    return undefined;
  }

  if (responseFormat.type === 'json_object') {
    return { type: 'json_object' as const };
  }

  return {
    type: 'json_schema' as const,
    json_schema: {
      name: responseFormat.name ?? 'structured_output',
      schema: responseFormat.schema ?? { type: 'object' },
      description: responseFormat.description,
      strict: responseFormat.strict ?? true,
    },
  };
}

async function withRedisClient<T>(
  injectedRedis: RedisClientType | undefined,
  timeoutMs: number,
  execute: (redis: RedisClientType) => Promise<T>,
) {
  if (injectedRedis) {
    return await execute(injectedRedis);
  }

  const { redis } = createRedisClient();
  let timedOut = false;
  const connectPromise = redis.connect().catch((error) => {
    if (timedOut) {
      return;
    }

    throw error;
  });

  await withTimeout(
    connectPromise,
    timeoutMs,
    () => {
      timedOut = true;
      redis.destroy();
      return new LlmProviderTimeoutError('Redis 限流连接超时。');
    },
  );

  try {
    return await execute(redis);
  } finally {
    await redis.quit();
  }
}

export function createOpenAiCompatibleLlmProvider({
  client,
  config = getLlmProviderConfig(),
  redis,
}: OpenAiCompatibleAdapterDependencies = {}): LlmProviderPort {
  const openaiClient = client ?? createOpenAiClient(config);

  async function performResponseRequest(
    request: LlmResponseRequest,
    context: LlmInvocationContext,
  ): Promise<JsonRecord> {
    const requestedModel = request.model?.trim() || config.model;
    const fallbackModels = config.fallbackModels.filter(
      (model) => model !== requestedModel,
    );
    const modelsToTry = [requestedModel, ...fallbackModels];
    let lastError: unknown;

    for (const model of modelsToTry) {
      for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
        try {
          const response = await openaiClient.responses.create(
            {
              model: resolveProviderModelName(model),
              input: request.input,
              instructions: request.systemPrompt,
              text: request.responseFormat
                ? {
                    format: mapResponseFormat(request.responseFormat),
                  }
                : undefined,
            },
            { timeout: context.timeoutMs ?? config.timeoutMs },
          );
          const payload = {
            ...(response as unknown as JsonRecord),
            model,
            output_text:
              typeof response.output_text === 'string'
                ? response.output_text
                : null,
          };

          if (!extractResponseText(payload)) {
            lastError = new LlmProviderResponseError(
              getPayloadErrorMessage(payload) ?? 'responses 接口未返回可用文本。',
            );

            if (shouldRetry(lastError, attempt, config.maxRetries)) {
              continue;
            }

            break;
          }

          return payload;
        } catch (error) {
          try {
            normalizeSdkError(error);
          } catch (normalizedError) {
            lastError = normalizedError;
          }

          if (shouldRetry(lastError, attempt, config.maxRetries)) {
            continue;
          }

          break;
        }
      }

      if (!shouldTryFallbackModel(lastError)) {
        throw lastError;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new LlmProviderUnavailableError();
  }

  async function performChatCompletionRequest(
    request: LlmChatCompletionRequest,
    context: LlmInvocationContext,
    responseFormat?: LlmResponseFormatConfig,
  ): Promise<JsonRecord> {
    const requestedModel = request.model?.trim() || config.model;
    const fallbackModels = config.fallbackModels.filter(
      (model) => model !== requestedModel,
    );
    const modelsToTry = [requestedModel, ...fallbackModels];
    let lastError: unknown;

    for (const model of modelsToTry) {
      for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
        try {
          const response = await openaiClient.chat.completions.create(
            {
              model: resolveProviderModelName(model),
              messages: request.messages,
              ...(responseFormat
                ? { response_format: mapChatCompletionResponseFormat(responseFormat) }
                : {}),
            },
            { timeout: context.timeoutMs ?? config.timeoutMs },
          );

          return {
            ...(response as unknown as JsonRecord),
            model,
          };
        } catch (error) {
          try {
            normalizeSdkError(error);
          } catch (normalizedError) {
            lastError = normalizedError;
          }

          if (shouldRetry(lastError, attempt, config.maxRetries)) {
            continue;
          }

          break;
        }
      }

      if (!shouldTryFallbackModel(lastError)) {
        throw lastError;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new LlmProviderUnavailableError();
  }

  return {
    async createResponse(
      request: LlmResponseRequest,
      context: LlmInvocationContext,
    ): Promise<LlmTextResult> {
      return await withRedisClient(
        redis,
        context.timeoutMs ?? config.timeoutMs,
        async (redisClient) => {
          await enforceLlmRateLimit({
            redis: redisClient,
            userId: context.userId,
            organizationId: context.organizationId,
            purpose: context.purpose,
            maxRequests: config.rateLimit.maxRequests,
            windowSeconds: config.rateLimit.windowSeconds,
          });

          let payload: JsonRecord;
          let usedChatFallback = false;
          try {
            payload = await performResponseRequest(request, context);
          } catch (error) {
            if (!shouldTryFallbackModel(error)) {
              throw error;
            }
            // Provider doesn't support /v1/responses — fall back to chat/completions
            usedChatFallback = true;
            const messages: LlmMessage[] = [];
            if (request.systemPrompt) {
              messages.push({ role: 'system', content: request.systemPrompt });
            }
            messages.push({ role: 'user', content: request.input });
            payload = await performChatCompletionRequest(
              { messages, model: request.model },
              context,
              request.responseFormat,
            );
          }

          const firstChoice =
            Array.isArray(payload.choices) && payload.choices[0]
              ? (payload.choices[0] as JsonRecord)
              : null;

          return {
            provider: config.provider,
            model: String(payload.model ?? request.model ?? config.model),
            text: usedChatFallback
              ? getChatCompletionText(payload)
              : getResponseText(payload),
            finishReason:
              firstChoice &&
              typeof firstChoice.finish_reason === 'string'
                ? firstChoice.finish_reason
                : typeof payload.finish_reason === 'string'
                  ? payload.finish_reason
                  : null,
            raw: payload,
          };
        },
      );
    },

    async createChatCompletion(
      request: LlmChatCompletionRequest,
      context: LlmInvocationContext,
    ): Promise<LlmTextResult> {
      return await withRedisClient(
        redis,
        context.timeoutMs ?? config.timeoutMs,
        async (redisClient) => {
          await enforceLlmRateLimit({
            redis: redisClient,
            userId: context.userId,
            organizationId: context.organizationId,
            purpose: context.purpose,
            maxRequests: config.rateLimit.maxRequests,
            windowSeconds: config.rateLimit.windowSeconds,
          });

          const payload = await performChatCompletionRequest(request, context);
          const firstChoice =
            Array.isArray(payload.choices) && payload.choices[0]
              ? (payload.choices[0] as JsonRecord)
              : null;

          return {
            provider: config.provider,
            model: String(payload.model ?? request.model ?? config.model),
            text: getChatCompletionText(payload),
            finishReason:
              firstChoice && typeof firstChoice.finish_reason === 'string'
                ? firstChoice.finish_reason
                : null,
            raw: payload,
          };
        },
      );
    },

    async checkHealth(): Promise<LlmProviderHealth> {
      const startedAt = Date.now();

      try {
        try {
          await openaiClient.models.list({ timeout: config.timeoutMs });
        } catch {
          // `/models` 对部分 OpenAI-compatible provider 只是可选能力，
          // 健康检查仍以真实模型调用是否成功为准。
        }

        await openaiClient.responses.create(
          {
            model: resolveProviderModelName(config.model),
            input: 'health_check',
          },
          { timeout: config.timeoutMs },
        );

        return {
          ok: true,
          provider: config.provider,
          model: config.model,
          latencyMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
          status: 200,
        };
      } catch (error) {
        try {
          normalizeSdkError(error);
        } catch (normalizedError) {
          if (normalizedError instanceof LlmProviderTimeoutError) {
            throw new LlmProviderTimeoutError('模型健康检查超时。');
          }

          throw new LlmProviderUnavailableError('模型健康检查失败。');
        }

        throw new LlmProviderUnavailableError('模型健康检查失败。');
      }
    },
  };
}
