import { createFactorExpansionUseCases } from '@/application/factor-expansion/use-cases';
import { graphUseCases } from '@/infrastructure/neo4j';

export const factorExpansionUseCases = createFactorExpansionUseCases({
  graphUseCases,
});
