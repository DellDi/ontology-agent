import { NextResponse } from 'next/server';

import { createPostgresDb } from '@/infrastructure/postgres/client';
import {
  createCompositionRoot,
  createLogger,
  withRequestObservability,
} from '@/composition-root';

type CheckStatus = 'ok' | 'degraded';
type CheckResult = {
  status: CheckStatus;
  latencyMs?: number;
  message?: string;
};

const CHECK_TIMEOUT_MS = 2000;
const startedAt = Date.now();

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} check timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

async function checkPostgres(): Promise<CheckResult> {
  const startedAtMs = Date.now();
  try {
    const { pool } = createPostgresDb();
    await withTimeout(pool.query('select 1'), CHECK_TIMEOUT_MS, 'postgres');
    return {
      status: 'ok',
      latencyMs: Date.now() - startedAtMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'degraded',
      latencyMs: Date.now() - startedAtMs,
      message,
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const startedAtMs = Date.now();
  const root = createCompositionRoot();
  try {
    await withTimeout(
      root.ensureRedisConnected(),
      CHECK_TIMEOUT_MS,
      'redis-connect',
    );
    await withTimeout(root.redisClient.redis.ping(), CHECK_TIMEOUT_MS, 'redis-ping');
    return {
      status: 'ok',
      latencyMs: Date.now() - startedAtMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'degraded',
      latencyMs: Date.now() - startedAtMs,
      message,
    };
  }
}

export async function GET(request: Request) {
  return withRequestObservability(request, 'health.check', async () => {
    const logger = createLogger({ route: '/api/health' });

    const [postgres, redis] = await Promise.all([
      checkPostgres(),
      checkRedis(),
    ]);

    const overallStatus: CheckStatus =
      postgres.status === 'ok' && redis.status === 'ok' ? 'ok' : 'degraded';

    const body = {
      status: overallStatus,
      checks: {
        postgres,
        redis,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      },
      version: process.env.GIT_COMMIT_SHA ?? 'unknown',
    };

    if (overallStatus === 'degraded') {
      logger.warn('health.degraded', { checks: body.checks });
      return NextResponse.json(body, { status: 503 });
    }

    logger.info('health.ok', { uptimeSeconds: body.checks.uptimeSeconds });
    return NextResponse.json(body, { status: 200 });
  });
}
