import type {
  MetricQueryRequest,
  MetricQueryResult,
  SemanticMetricDefinition,
  SemanticQueryHealth,
} from './models';

export type SemanticQueryPort = {
  runMetricQuery(request: MetricQueryRequest): Promise<MetricQueryResult>;
  checkHealth(): Promise<SemanticQueryHealth>;
  getMetricCatalog(): SemanticMetricDefinition[];
};
