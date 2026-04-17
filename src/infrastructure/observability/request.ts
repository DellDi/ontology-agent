/**
 * 请求级 observability 包装。
 *
 * Story 7.4 AC：为 API 入口统一注入 correlation id、计入指标、结构化日志，
 * 避免每个 route handler 各写一套，导致观测字段漂移。
 *
 * 用法：
 * ```ts
 * export const POST = (request: Request) =>
 *   withRequestObservability(request, 'analysis.execute', async () => {
 *     // 原有 handler 逻辑
 *     return NextResponse.json({ ok: true });
 *   });
 * ```
 */

import {
  attachResponseCorrelationHeader,
  resolveCorrelationIdFromHeaders,
  withCorrelationAsync,
} from './correlation';
import { createLogger } from './logger';
import { metrics } from './metrics';

export type ObservedRequestHandler = () => Promise<Response>;

export type ObservedRequestOutcome = {
  correlationId: string;
  durationMs: number;
  status: number;
};

function extractRoutePath(request: Request): string {
  try {
    const url = new URL(request.url);
    return url.pathname;
  } catch {
    return '(unparsable-url)';
  }
}

export async function withRequestObservability(
  request: Request,
  operation: string,
  handler: ObservedRequestHandler,
): Promise<Response> {
  const { correlationId, origin } = resolveCorrelationIdFromHeaders(
    request.headers,
  );

  const startedAt = Date.now();
  const method = request.method;
  const path = extractRoutePath(request);

  metrics.increment('request.total');
  metrics.increment(`request.by_op.${operation}`);

  const logger = createLogger({
    operation,
    method,
    path,
  });

  return withCorrelationAsync(
    { correlationId, origin },
    async () => {
      logger.info('request.started', {
        correlationOrigin: origin,
      });

      try {
        const response = await handler();
        const durationMs = Date.now() - startedAt;
        const status = response.status;
        metrics.increment(`request.status.${status}`);
        if (status >= 500) {
          metrics.recordError({
            kind: `${operation}.status_${status}`,
            message: `HTTP ${status}`,
            correlationId,
          });
        }
        logger.info('request.completed', {
          status,
          durationMs,
        });
        return attachResponseCorrelationHeader(response, correlationId);
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const err = error instanceof Error ? error : new Error(String(error));
        metrics.recordError({
          kind: `${operation}.unhandled`,
          message: err.message,
          correlationId,
        });
        logger.error('request.failed', {
          errorKind: `${operation}.unhandled`,
          errorMessage: err.message,
          errorStack: err.stack,
          durationMs,
        });
        throw err;
      }
    },
  );
}
