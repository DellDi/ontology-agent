import { createGraphUseCases } from '@/application/graph/use-cases';

import { createNeo4jGraphAdapter } from './neo4j-graph-adapter';

const graphPort = createNeo4jGraphAdapter();

export const graphUseCases = createGraphUseCases({
  graphReadPort: graphPort,
  graphWritePort: graphPort,
});
