import type {
  GraphSyncSourceName,
  GraphSyncTriggerType,
} from '@/domain/graph-sync/models';

type GraphSyncOperationsUseCases = {
  runBootstrapJob(input: {
    organizationIds?: string[];
    limit?: number;
    triggerType: GraphSyncTriggerType;
    triggeredBy: string;
  }): Promise<unknown>;
  runOrgJob(input: {
    organizationIds: string[];
    triggerType: GraphSyncTriggerType;
    triggeredBy: string;
  }): Promise<unknown>;
  runIncrementalJob(input: {
    sourceNames?: GraphSyncSourceName[];
    triggerType: GraphSyncTriggerType;
    triggeredBy: string;
  }): Promise<unknown>;
  runDispatchJob(input: {
    sourceNames?: GraphSyncSourceName[];
    triggerType: GraphSyncTriggerType;
    triggeredBy: string;
    retryFailed?: boolean;
    maxRetryAttempts?: number;
  }): Promise<unknown>;
  runConsistencySweepJob(input: {
    organizationIds?: string[];
    limit?: number;
    triggerType: GraphSyncTriggerType;
    triggeredBy: string;
  }): Promise<unknown>;
  getStatus(input?: {
    recentRunLimit?: number;
    maxRetryAttempts?: number;
  }): Promise<unknown>;
};

export function createGraphSyncJobRunner({
  operationsUseCases,
}: {
  operationsUseCases: GraphSyncOperationsUseCases;
}) {
  return {
    async runJob(input: {
      job:
        | 'bootstrap'
        | 'org'
        | 'incremental'
        | 'dispatch'
        | 'consistency-sweep'
        | 'status';
      organizationIds?: string[];
      sourceNames?: GraphSyncSourceName[];
      triggerType?: GraphSyncTriggerType;
      triggeredBy?: string;
      retryFailed?: boolean;
      maxRetryAttempts?: number;
      recentRunLimit?: number;
      limit?: number;
    }) {
      switch (input.job) {
        case 'bootstrap':
          return operationsUseCases.runBootstrapJob({
            organizationIds: input.organizationIds,
            limit: input.limit,
            triggerType: input.triggerType ?? 'manual',
            triggeredBy: input.triggeredBy ?? 'scripts/graph-sync-job',
          });
        case 'org':
          return operationsUseCases.runOrgJob({
            organizationIds: input.organizationIds ?? [],
            triggerType: input.triggerType ?? 'manual',
            triggeredBy: input.triggeredBy ?? 'scripts/graph-sync-job',
          });
        case 'incremental':
          return operationsUseCases.runIncrementalJob({
            sourceNames: input.sourceNames,
            triggerType: input.triggerType ?? 'scheduler',
            triggeredBy: input.triggeredBy ?? 'scripts/graph-sync-job',
          });
        case 'dispatch':
          return operationsUseCases.runDispatchJob({
            sourceNames: input.sourceNames,
            triggerType: input.triggerType ?? 'scheduler',
            triggeredBy: input.triggeredBy ?? 'scripts/graph-sync-job',
            retryFailed: input.retryFailed,
            maxRetryAttempts: input.maxRetryAttempts,
          });
        case 'consistency-sweep':
          return operationsUseCases.runConsistencySweepJob({
            organizationIds: input.organizationIds,
            limit: input.limit,
            triggerType: input.triggerType ?? 'recovery',
            triggeredBy: input.triggeredBy ?? 'scripts/graph-sync-job',
          });
        case 'status':
          return operationsUseCases.getStatus({
            recentRunLimit: input.recentRunLimit,
            maxRetryAttempts: input.maxRetryAttempts,
          });
      }
    },
  };
}

const graphSyncJobRunnerModule = {
  createGraphSyncJobRunner,
};

export default graphSyncJobRunnerModule;
