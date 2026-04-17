/**
 * 结构化 JSON Logger。
 *
 * Story 7.4 AC：
 * - 关键请求产生带 correlation id 的可聚合日志字段
 * - 日志去敏（见 sanitize.ts）
 * - 错误可在 metrics 中被计数以支撑可用性追踪
 *
 * 不依赖任何第三方 logger（winston/pino），保持 production 可替换。
 * 所有输出统一走 stdout/stderr（容器收集层接管）。
 */

import { getCurrentCorrelationId, getCorrelationContext } from './correlation';
import { sanitizeLogPayload } from './sanitize';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
};

type LogRecord = {
  level: LogLevel;
  time: string;
  service: string;
  message: string;
  correlationId?: string;
  correlationOrigin?: string;
  fields?: LogFields;
  bindings?: LogFields;
};

function detectService(): string {
  if (typeof process !== 'undefined') {
    return process.env.OBSERVABILITY_SERVICE_NAME ?? 'ontology-agent-web';
  }
  return 'ontology-agent-web';
}

function emit(record: LogRecord): void {
  const sanitized = sanitizeLogPayload(record);
  const serialized = JSON.stringify(sanitized);
  if (record.level === 'error') {
    console.error(serialized);
    return;
  }
  if (record.level === 'warn') {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}

function composeRecord(
  level: LogLevel,
  message: string,
  fields: LogFields | undefined,
  bindings: LogFields | undefined,
): LogRecord {
  const context = getCorrelationContext();
  return {
    level,
    time: new Date().toISOString(),
    service: detectService(),
    message,
    correlationId: context?.correlationId ?? getCurrentCorrelationId(),
    correlationOrigin: context?.origin,
    fields,
    bindings,
  };
}

function createLoggerInternal(bindings?: LogFields): Logger {
  return {
    debug(message, fields) {
      emit(composeRecord('debug', message, fields, bindings));
    },
    info(message, fields) {
      emit(composeRecord('info', message, fields, bindings));
    },
    warn(message, fields) {
      emit(composeRecord('warn', message, fields, bindings));
    },
    error(message, fields) {
      // 注意：logger.error 不再自动调用 metrics.recordError，避免与显式的
      // withRequestObservability / worker 错误路径造成双计数。
      // 需要纳入指标的错误应由调用方显式调用 metrics.recordError。
      emit(composeRecord('error', message, fields, bindings));
    },
    child(nextBindings) {
      return createLoggerInternal({
        ...(bindings ?? {}),
        ...nextBindings,
      });
    },
  };
}

export function createLogger(bindings?: LogFields): Logger {
  return createLoggerInternal(bindings);
}

/** 根 logger：无 bindings，用于纯顶层代码。业务路径建议通过 child() 附加上下文。 */
export const rootLogger: Logger = createLoggerInternal();
