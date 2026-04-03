export class CubeProviderTimeoutError extends Error {
  constructor(message = 'Cube query timed out.') {
    super(message);
    this.name = 'CubeProviderTimeoutError';
  }
}

export class CubeProviderUnavailableError extends Error {
  constructor(message = 'Cube provider is unavailable.') {
    super(message);
    this.name = 'CubeProviderUnavailableError';
  }
}

export class CubeProviderResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CubeProviderResponseError';
  }
}

export class CubeMetricQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CubeMetricQueryValidationError';
  }
}
