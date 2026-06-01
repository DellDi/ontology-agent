export type LlmProviderKind = 'openai-compatible';

export type LlmRateLimitConfig = {
  maxRequests: number;
  windowSeconds: number;
};

export type LlmProviderConfig = {
  provider: LlmProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModels: string[];
  timeoutMs: number;
  maxRetries: number;
  rateLimit: LlmRateLimitConfig;
};

export type LlmInvocationContext = {
  userId: string;
  organizationId: string;
  purpose: string;
  timeoutMs?: number;
  /** 取消信号 — 由 worker 超时守卫注入，传递给 HTTP 客户端以中止底层请求。 */
  signal?: AbortSignal;
};

export type LlmMessageRole = 'system' | 'user' | 'assistant';

export type LlmMessage = {
  role: LlmMessageRole;
  content: string;
};

export type LlmResponseFormatConfig = {
  type: 'json_schema' | 'json_object';
  name?: string;
  schema?: Record<string, unknown>;
  description?: string;
  strict?: boolean | null;
};

export type LlmResponseRequest = {
  input: string;
  systemPrompt?: string;
  model?: string;
  responseFormat?: LlmResponseFormatConfig;
};

export type LlmChatCompletionRequest = {
  messages: LlmMessage[];
  model?: string;
};

export type LlmTextResult = {
  provider: LlmProviderKind;
  model: string;
  text: string;
  finishReason: string | null;
  raw: Record<string, unknown>;
};

export type LlmProviderHealth = {
  ok: boolean;
  provider: LlmProviderKind;
  model: string;
  latencyMs: number;
  checkedAt: string;
  status: number;
};
