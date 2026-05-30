import { createHmac } from 'node:crypto';

import type { CubeProviderConfig } from '@/application/semantic-query/models';

const DEFAULT_CUBE_API_URL = 'http://127.0.0.1:4000/cubejs-api/v1';
const DEFAULT_CUBE_QUERY_TIMEOUT_MS = 15_000;
const DEFAULT_CUBE_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

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

function toBase64Url(value: string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signCubeApiToken(secret: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };
  const payload = {
    iat: issuedAt,
    exp: issuedAt + DEFAULT_CUBE_TOKEN_TTL_SECONDS,
  };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(unsignedToken)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return `${unsignedToken}.${signature}`;
}

function getCubeApiToken() {
  return signCubeApiToken(getRequiredEnv('CUBE_API_SECRET'));
}

export function getCubeProviderConfig(): CubeProviderConfig {
  return {
    apiUrl: normalizeApiUrl(
      process.env.CUBE_API_URL?.trim() || DEFAULT_CUBE_API_URL,
    ),
    apiToken: getCubeApiToken(),
    timeoutMs: getPositiveInt(
      'CUBE_QUERY_TIMEOUT_MS',
      DEFAULT_CUBE_QUERY_TIMEOUT_MS,
    ),
  };
}
