import type { LlmProviderConfig } from '@/application/llm/models';

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1';

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
  const trimmed = baseUrl.trim().replace(/\/+$/, '');

  return trimmed.replace(/\/(?:chat\/completions|responses|models)$/, '');
}

function getApiKey() {
  return (
    process.env.LLM_PROVIDER_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    getRequiredEnv('LLM_PROVIDER_API_KEY')
  );
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
  return model.trim();
}

export function getLlmProviderConfig(): LlmProviderConfig {
  return {
    provider: 'openai-compatible',
    baseUrl: normalizeBaseUrl(
      process.env.LLM_PROVIDER_BASE_URL?.trim() ||
        DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    ),
    apiKey: getApiKey(),
    model: getRequiredEnv('LLM_PROVIDER_MODEL'),
    fallbackModels: getModelList('LLM_FALLBACK_MODELS', []),
    timeoutMs: getPositiveInt('LLM_REQUEST_TIMEOUT_MS', 15_000),
    maxRetries: getPositiveInt('LLM_MAX_RETRIES', 2),
    rateLimit: {
      maxRequests: getPositiveInt('LLM_RATE_LIMIT_MAX_REQUESTS', 20),
      windowSeconds: getPositiveInt('LLM_RATE_LIMIT_WINDOW_SECONDS', 60),
    },
  };
}
