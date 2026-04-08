import type { GraphSyncRun } from '@/domain/graph-sync/models';

export type GraphSyncRunStore = {
  save(run: GraphSyncRun): Promise<GraphSyncRun>;
};
