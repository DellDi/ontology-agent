import { NextResponse } from 'next/server';

import { createPostgresDb } from '@/infrastructure/postgres/client';
import { createRedisClient } from '@/infrastructure/redis/client';
import {
  createLogger,
  withRequestObservability,
} from '@/infrastructure/observability';

/**
 * Story 7.4 Health Endpoint。
 *
 * 返回 JSON：
 * ```
 * {
 *   "status": "ok" | "degraded",
 *   "checks": { "postgres": "ok", "redis": "ok", "uptimeSeconds": 123 },
 *   "version": "<git sha | 'unknown'>",
 * }
 * ```
 *
 * 设计：
 * - GET /api/health 对外无需认证（用于探针），但不暴露内部细节（实例 id、环境变量等）。
 * - 任一核心依赖故障时 status 降级为 `degraded` 并返回 503，满足 K8s readinessProbe 语义。
 * - 全部检查在 2s 内超时，避免级联卡死。
 */

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
  const { redis } = createRedisClient();
  try {
    if (!redis.isOpen) {
      await withTimeout(redis.connect(), CHECK_TIMEOUT_MS, 'redis-connect');
    }
    await withTimeout(redis.ping(), CHECK_TIMEOUT_MS, 'redis-ping');
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
  } finally {
    // 本地短连接：检查完毕显式销毁，避免健康检查占用连接池。
    try {
      if (redis.isOpen) {
        await redis.destroy();
      }
    } catch {
      // ignore
    }
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
