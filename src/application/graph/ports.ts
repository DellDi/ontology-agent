import type {
  GraphCandidateFactor,
  GraphCandidateFactorQuery,
  GraphSyncBatch,
} from '@/domain/graph/models';
import type { GraphScopedCleanupInput } from '@/domain/graph-sync/models';

export type GraphQueryOptions = {
  /** 外部取消信号 — 由 worker 超时机制注入。Neo4j driver 无原生 abort，通过 Promise.race 实现。 */
  signal?: AbortSignal;
};

export type GraphReadPort = {
  findCandidateFactors(
    query: GraphCandidateFactorQuery,
    options?: GraphQueryOptions,
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
  cleanupScopedData(input: GraphScopedCleanupInput): Promise<{
    deletedNodes: number;
    deletedEdges: number;
  }>;
};
