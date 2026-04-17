/**
 * Correlation Id 管理。
 *
 * Story 7.4 AC：跨服务端入口、SSE、异步任务保持同一 trace 标识，
 * 以便从日志 / 指标 / 追踪定位问题范围，不依赖逐节点手工排查。
 *
 * 机制：
 * - 优先读取 `x-correlation-id` 请求头（网关/上游已注入）。
 * - 缺省则生成一个轻量 uuid-ish id，并响应头回写以便客户端串联。
 * - 通过 AsyncLocalStorage 让同一请求作用域内的下游 logger / metrics 自动拿到。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';
export const CORRELATION_META_KEY = 'correlationId';

type CorrelationContext = {
  correlationId: string;
  /** 记录 correlation id 起源，便于区分是从请求头继承还是新生成。 */
  origin: 'inbound-header' | 'generated' | 'job-metadata';
  /** 可选的业务上下文，日志与指标会一起透出。 */
  meta?: Record<string, string | undefined>;
};

const storage = new AsyncLocalStorage<CorrelationContext>();

export function generateCorrelationId(): string {
  return randomUUID();
}

export function resolveCorrelationIdFromHeaders(
  headers: Headers | Record<string, string | string[] | undefined>,
): { correlationId: string; origin: CorrelationContext['origin'] } {
  let inbound: string | undefined;
  if (headers instanceof Headers) {
    inbound = headers.get(CORRELATION_HEADER) ?? undefined;
  } else {
    const value = headers[CORRELATION_HEADER];
    if (typeof value === 'string') {
      inbound = value;
    } else if (Array.isArray(value)) {
      inbound = value[0];
    }
  }

  if (inbound && inbound.trim().length > 0) {
    return { correlationId: inbound.trim(), origin: 'inbound-header' };
  }

  return {
    correlationId: generateCorrelationId(),
    origin: 'generated',
  };
}

export function withCorrelation<T>(
  context: CorrelationContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export async function withCorrelationAsync<T>(
  context: CorrelationContext,
  callback: () => Promise<T>,
): Promise<T> {
  return storage.run(context, callback);
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

export function getCurrentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function attachResponseCorrelationHeader(
  response: Response,
  correlationId: string,
): Response {
  if (response.headers.has(CORRELATION_HEADER)) {
    return response;
  }

  try {
    response.headers.set(CORRELATION_HEADER, correlationId);
    return response;
  } catch {
    // P1: 若 headers frozen，优先尝试原地修改；失败时才考虑克隆。
    // 但 Response body 若为 ReadableStream（SSE / 大文件下载），克隆会锁流导致断流。
    // 因此检测到 stream body 时宁愿丢失 header，也不破坏响应本身。
    if (response.body instanceof ReadableStream) {
      return response;
    }
    const cloned = new Response(response.body, response);
    cloned.headers.set(CORRELATION_HEADER, correlationId);
    return cloned;
  }
}
