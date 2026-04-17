/**
 * 最小可用指标聚合。
 *
 * Story 7.4 AC：为 99.5% 可用性跟踪提供必要计数器；配合结构化日志与 correlation id。
 *
 * 设计取舍：
 * - 本地内存计数器，不引入 Prometheus client 依赖；
 *   后续切换到 otel/pushgateway 时只需替换此文件的 exporter。
 * - 指标以「counter + 最近错误采样」两类为主，聚焦"可用性追踪"。
 * - 明确的 reset 与快照语义，方便测试与 `/api/metrics` 暴露。
 */

type CounterKey = string;

export type MetricsSnapshot = {
  generatedAt: string;
  counters: Record<CounterKey, number>;
  recentErrors: Array<{
    at: string;
    kind: string;
    message: string;
    correlationId?: string;
  }>;
};

const MAX_RECENT_ERRORS = 50;

class MetricsRegistry {
  private counters = new Map<CounterKey, number>();
  private recentErrors: MetricsSnapshot['recentErrors'] = [];

  increment(key: CounterKey, delta = 1): void {
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + delta);
  }

  recordError(input: {
    kind: string;
    message: string;
    correlationId?: string;
  }): void {
    this.increment(`errors.${input.kind}`);
    this.recentErrors.push({
      at: new Date().toISOString(),
      kind: input.kind,
      message: input.message,
      correlationId: input.correlationId,
    });
    if (this.recentErrors.length > MAX_RECENT_ERRORS) {
      this.recentErrors = this.recentErrors.slice(-MAX_RECENT_ERRORS);
    }
  }

  snapshot(): MetricsSnapshot {
    return {
      generatedAt: new Date().toISOString(),
      counters: Object.fromEntries(this.counters.entries()),
      recentErrors: [...this.recentErrors],
    };
  }

  reset(): void {
    this.counters.clear();
    this.recentErrors = [];
  }
}

type GlobalWithRegistry = typeof globalThis & {
  __ontologyAgentMetricsRegistry?: MetricsRegistry;
};

function resolveRegistry(): MetricsRegistry {
  const scope = globalThis as GlobalWithRegistry;
  if (!scope.__ontologyAgentMetricsRegistry) {
    scope.__ontologyAgentMetricsRegistry = new MetricsRegistry();
  }
  return scope.__ontologyAgentMetricsRegistry;
}

export const metrics = {
  increment(key: CounterKey, delta = 1): void {
    resolveRegistry().increment(key, delta);
  },
  recordError(input: {
    kind: string;
    message: string;
    correlationId?: string;
  }): void {
    resolveRegistry().recordError(input);
  },
  snapshot(): MetricsSnapshot {
    return resolveRegistry().snapshot();
  },
  reset(): void {
    resolveRegistry().reset();
  },
};
