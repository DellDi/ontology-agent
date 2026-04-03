import type {
  GraphCandidateFactor,
  GraphCandidateFactorQuery,
} from '@/domain/graph/models';

import type { GraphReadPort, GraphWritePort } from './ports';

type GraphUseCasesDependencies = {
  graphReadPort: GraphReadPort;
  graphWritePort?: GraphWritePort;
};

type GraphCandidateFactorReadModel = GraphCandidateFactor & {
  label: string;
};

export function createGraphUseCases({
  graphReadPort,
  graphWritePort,
}: GraphUseCasesDependencies) {
  return {
    async expandCandidateFactors(
      query: GraphCandidateFactorQuery,
    ): Promise<{
      mode: 'expand' | 'skip';
      factors: GraphCandidateFactorReadModel[];
    }> {
      const factors = await graphReadPort.findCandidateFactors(query);

      if (factors.length === 0) {
        return {
          mode: 'skip',
          factors: [],
        };
      }

      return {
        mode: 'expand',
        factors: factors.map((factor) => ({
          ...factor,
          label: factor.factorLabel,
        })),
      };
    },

    async checkHealth() {
      return await graphReadPort.checkHealth();
    },

    async syncBaseline(batchParameters: Parameters<GraphWritePort['syncBaseline']>[0]) {
      if (!graphWritePort) {
        throw new Error('Graph write port is not configured.');
      }

      return await graphWritePort.syncBaseline(batchParameters);
    },
  };
}
