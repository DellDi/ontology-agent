import type { MetricQueryRequest } from './models';
import type { SemanticQueryPort } from './ports';

type SemanticQueryUseCasesDependencies = {
  port: SemanticQueryPort;
};

export function createSemanticQueryUseCases({
  port,
}: SemanticQueryUseCasesDependencies) {
  return {
    async runMetricQuery(request: MetricQueryRequest) {
      return await port.runMetricQuery(request);
    },

    async checkHealth() {
      return await port.checkHealth();
    },

    getMetricCatalog() {
      return port.getMetricCatalog();
    },
  };
}
