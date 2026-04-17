/**
 * Observability public surface.
 *
 * 所有 observability 用户（route handler / worker / application 层）只从本文件导入，
 * 方便未来替换 logger/metrics 实现（例如切到 OpenTelemetry）。
 */

export {
  createLogger,
  rootLogger,
} from './logger';
export type { Logger, LogLevel, LogFields } from './logger';

export {
  CORRELATION_HEADER,
  attachResponseCorrelationHeader,
  generateCorrelationId,
  getCorrelationContext,
  getCurrentCorrelationId,
  resolveCorrelationIdFromHeaders,
  withCorrelation,
  withCorrelationAsync,
} from './correlation';

export { metrics } from './metrics';
export type { MetricsSnapshot } from './metrics';

export { sanitizeLogPayload } from './sanitize';

export { withRequestObservability } from './request';
export type {
  ObservedRequestHandler,
  ObservedRequestOutcome,
} from './request';
