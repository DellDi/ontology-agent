export class LlmProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

export class LlmProviderTimeoutError extends LlmProviderError {
  constructor(message = '模型调用超时。') {
    super(message);
    this.name = 'LlmProviderTimeoutError';
  }
}

export class LlmRateLimitExceededError extends LlmProviderError {
  constructor(message = '模型调用超过限流阈值。') {
    super(message);
    this.name = 'LlmRateLimitExceededError';
  }
}

export class LlmProviderUnavailableError extends LlmProviderError {
  constructor(message = '模型 provider 当前不可用。') {
    super(message);
    this.name = 'LlmProviderUnavailableError';
  }
}

export class LlmProviderResponseError extends LlmProviderError {
  constructor(message = '模型 provider 返回了无法解析的结果。') {
    super(message);
    this.name = 'LlmProviderResponseError';
  }
}
