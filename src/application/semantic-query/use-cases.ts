import type { MetricQueryRequest } from './models';
import type { SemanticQueryOptions, SemanticQueryPort } from './ports';

type SemanticQueryUseCasesDependencies = {
  port: SemanticQueryPort;
};

export function createSemanticQueryUseCases({
  port,
}: SemanticQueryUseCasesDependencies) {
  return {
    async runMetricQuery(
      request: MetricQueryRequest,
      options?: SemanticQueryOptions,
    ) {
      return await port.runMetricQuery(request, options);
    },

    async checkHealth() {
      return await port.checkHealth();
    },

    getMetricCatalog() {
      return port.getMetricCatalog();
    },
  };
}
