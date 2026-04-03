import type {
  GraphCandidateFactor,
  GraphCandidateFactorQuery,
  GraphSyncBatch,
} from '@/domain/graph/models';

export type GraphReadPort = {
  findCandidateFactors(
    query: GraphCandidateFactorQuery,
  ): Promise<GraphCandidateFactor[]>;
  checkHealth(): Promise<{
    ok: boolean;
    status: 'ready' | 'disabled' | 'error';
  }>;
};

export type GraphWritePort = {
  syncBaseline(batch: GraphSyncBatch): Promise<{
    nodesWritten: number;
    edgesWritten: number;
  }>;
};
