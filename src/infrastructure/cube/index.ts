import { createSemanticQueryUseCases } from '@/application/semantic-query/use-cases';

import { getCubeProviderConfig } from './config';
import { createCubeSemanticQueryAdapter } from './cube-semantic-query-adapter';

export function createCubeSemanticQueryServices() {
  const port = createCubeSemanticQueryAdapter();

  return {
    config: getCubeProviderConfig(),
    port,
    useCases: createSemanticQueryUseCases({ port }),
  };
}

export { getCubeProviderConfig } from './config';
export { createCubeSemanticQueryAdapter } from './cube-semantic-query-adapter';
export { listSemanticMetrics, getSemanticMetricDefinition } from './metric-catalog';
export { buildCubeLoadQuery } from './query-builder';
