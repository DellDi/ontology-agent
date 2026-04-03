import type { CubeProviderConfig } from '@/application/semantic-query/models';

const DEFAULT_CUBE_API_URL = 'http://127.0.0.1:4000/cubejs-api/v1';
const DEFAULT_CUBE_QUERY_TIMEOUT_MS = 15_000;

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required to configure Cube.`);
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

function normalizeApiUrl(apiUrl: string) {
  return apiUrl.replace(/\/+$/, '');
}

export function getCubeProviderConfig(): CubeProviderConfig {
  return {
    apiUrl: normalizeApiUrl(
      process.env.CUBE_API_URL?.trim() || DEFAULT_CUBE_API_URL,
    ),
    apiToken: getRequiredEnv('CUBE_API_TOKEN'),
    timeoutMs: getPositiveInt(
      'CUBE_QUERY_TIMEOUT_MS',
      DEFAULT_CUBE_QUERY_TIMEOUT_MS,
    ),
  };
}
