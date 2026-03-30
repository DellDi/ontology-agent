import type { LlmProviderConfig } from '@/application/llm/models';

const DEFAULT_BAILIAN_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_BAILIAN_MODEL = 'bailian/kimi-2.5';
const DEFAULT_BAILIAN_FALLBACK_MODELS = [
  'bailian/qwen3.5-plus',
  'bailian/MiniMax/MiniMax-M2.7',
  'bailian/glm-5',
] as const;

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required to configure the LLM provider.`);
  }

  return value;
}

function getPositiveInt(name: string, fallback: number) {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function getApiKey() {
  return getRequiredEnv('DASHSCOPE_API_KEY');
}

function getModelList(name: string, fallback: readonly string[]) {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return [...fallback];
  }

  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveProviderModelName(model: string) {
  return model.replace(/^bailian\//, '');
}

export function getLlmProviderConfig(): LlmProviderConfig {
  return {
    provider: 'openai-compatible',
    baseUrl: normalizeBaseUrl(
      process.env.LLM_PROVIDER_BASE_URL?.trim() || DEFAULT_BAILIAN_BASE_URL,
    ),
    apiKey: getApiKey(),
    model: process.env.LLM_PROVIDER_MODEL?.trim() || DEFAULT_BAILIAN_MODEL,
    fallbackModels: getModelList(
      'LLM_FALLBACK_MODELS',
      DEFAULT_BAILIAN_FALLBACK_MODELS,
    ),
    timeoutMs: getPositiveInt('LLM_REQUEST_TIMEOUT_MS', 15_000),
    maxRetries: getPositiveInt('LLM_MAX_RETRIES', 2),
    rateLimit: {
      maxRequests: getPositiveInt('LLM_RATE_LIMIT_MAX_REQUESTS', 20),
      windowSeconds: getPositiveInt('LLM_RATE_LIMIT_WINDOW_SECONDS', 60),
    },
  };
}
