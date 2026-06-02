import type {
  MetricQueryRequest,
  MetricQueryResult,
  SemanticMetricDefinition,
  SemanticQueryHealth,
} from './models';

export type SemanticQueryOptions = {
  /** 外部取消信号 — 由 worker 超时机制注入，与内部超时合并。 */
  signal?: AbortSignal;
};

export type SemanticQueryPort = {
  runMetricQuery(
    request: MetricQueryRequest,
    options?: SemanticQueryOptions,
  ): Promise<MetricQueryResult>;
  checkHealth(): Promise<SemanticQueryHealth>;
  getMetricCatalog(): SemanticMetricDefinition[];
};
