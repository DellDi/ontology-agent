import { randomUUID } from 'node:crypto';

import type {
  GraphSyncCursorPosition,
  GraphSyncCursorSnapshot,
  GraphSyncDirtyScope,
  GraphSyncRun,
  GraphSyncRunMode,
  GraphSyncSourceName,
  GraphSyncTriggerType,
} from '@/domain/graph-sync/models';

import type {
  GraphSyncDirtyScopeStore,
  GraphSyncOrganizationRebuildRunner,
  GraphSyncRunStore,
} from './runtime-ports';

type GraphSyncIncrementalRuntime = {
  scanSource(input: {
    sourceName: GraphSyncSourceName;
  }): Promise<{
    sourceName: GraphSyncSourceName;
    cursor: GraphSyncCursorPosition | null;
    targetCursor: GraphSyncCursorPosition | null;
    scannedChangeCount: number;
    dirtyScopeCount: number;
    diagnostics: string[];
  }>;
  dispatchSource(input: {
    sourceName: GraphSyncSourceName;
    targetCursor: GraphSyncCursorPosition | null;
    triggerType: GraphSyncTriggerType;
    triggeredBy: string;
  }): Promise<{
    sourceName: GraphSyncSourceName;
    rebuiltOrganizations: string[];
    cursorAdvanced: boolean;
    advancedCursor?: {
      sourceName: GraphSyncSourceName;
      cursorTime: string | null;
      cursorPk: string | null;
      lastRunId: string | null;
      updatedAt: string;
    } | null;
    failedScopeKey?: string;
    errorSummary?: string;
  }>;
};

type GraphSyncOrganizationSource = {
  listOrganizationIds(input?: {
    limit?: number | null;
  }): Promise<string[]>;
};

function buildGraphSyncJobRun(input: {
  id?: string;
  mode: GraphSyncRunMode;
  status: GraphSyncRun['status'];
  scopeType: GraphSyncRun['scopeType'];
  scopeKey: string;
  triggerType: GraphSyncTriggerType;
  triggeredBy: string;
  cursorSnapshot?: GraphSyncCursorSnapshot;
  errorSummary?: string | null;
  errorDetail?: Record<string, unknown> | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string;
}) {
  const now = new Date().toISOString();

  return {
    id: input.id ?? randomUUID(),
    mode: input.mode,
    status: input.status,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    triggerType: input.triggerType,
    triggeredBy: input.triggeredBy,
    cursorSnapshot: input.cursorSnapshot ?? {},
    nodesWritten: 0,
    edgesWritten: 0,
    errorSummary: input.errorSummary ?? null,
    errorDetail: input.errorDetail ?? null,
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  } satisfies GraphSyncRun;
}

function summarizeBacklogByRetryState(
  failedScopes: GraphSyncDirtyScope[],
  maxRetryAttempts: number,
) {
  const blockedFailed = failedScopes.filter(
    (scope) => scope.attemptCount >= maxRetryAttempts,
  ).length;

  return {
    blockedFailed,
    retryableFailed: failedScopes.length - blockedFailed,
  };
}

export function createGraphSyncOperationsUseCases({
  sourceNames,
  organizationSource,
  graphSyncRunStore,
  dirtyScopeStore,
  incrementalUseCases,
  organizationRebuildRunner,
}: {
  sourceNames: readonly GraphSyncSourceName[];
  organizationSource: GraphSyncOrganizationSource;
  graphSyncRunStore: GraphSyncRunStore;
  dirtyScopeStore: GraphSyncDirtyScopeStore;
  incrementalUseCases: GraphSyncIncrementalRuntime;
  organizationRebuildRunner: GraphSyncOrganizationRebuildRunner;
}) {
  async function runJobWithLifecycle<T>(input: {
    mode: GraphSyncRunMode;
    scopeKey: string;
    triggerType: GraphSyncTriggerType;
    triggeredBy: string;
    execute: (runningRun: GraphSyncRun) => Promise<{
      status: GraphSyncRun['status'];
      errorSummary?: string | null;
      errorDetail?: Record<string, unknown> | null;
      output: T;
    }>;
  }) {
    const pendingRun = buildGraphSyncJobRun({
      mode: input.mode,
      status: 'pending',
      scopeType: 'all',
      scopeKey: input.scopeKey,
      triggerType: input.triggerType,
      triggeredBy: input.triggeredBy,
    });
    await graphSyncRunStore.save(pendingRun);

    const runningStartedAt = new Date().toISOString();
    const runningRun = buildGraphSyncJobRun({
      ...pendingRun,
      status: 'running',
      startedAt: runningStartedAt,
      createdAt: pendingRun.createdAt,
    });
    await graphSyncRunStore.save(runningRun);

    try {
      const result = await input.execute(runningRun);
      const finishedRun = buildGraphSyncJobRun({
        ...runningRun,
        status: result.status,
        errorSummary: result.errorSummary ?? null,
        errorDetail: result.errorDetail ?? null,
        startedAt: runningStartedAt,
        finishedAt: new Date().toISOString(),
        createdAt: pendingRun.createdAt,
      });
      await graphSyncRunStore.save(finishedRun);

      return {
        run: finishedRun,
        output: result.output,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Graph sync job failed.';
      const failedRun = buildGraphSyncJobRun({
        ...runningRun,
        status: 'failed',
        errorSummary: message,
        errorDetail:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
              }
            : {
                message,
              },
        startedAt: runningStartedAt,
        finishedAt: new Date().toISOString(),
        createdAt: pendingRun.createdAt,
      });
      await graphSyncRunStore.save(failedRun);

      return {
        run: failedRun,
        output: null,
      };
    }
  }

  async function resolveOrganizationIds(input?: {
    organizationIds?: string[];
    limit?: number;
  }) {
    const explicitOrganizationIds = input?.organizationIds
      ?.map((value) => value.trim())
      .filter(Boolean);

    if (explicitOrganizationIds && explicitOrganizationIds.length > 0) {
      return explicitOrganizationIds;
    }

    return organizationSource.listOrganizationIds({
      limit: input?.limit ?? null,
    });
  }

  return {
    async runBootstrapJob(input: {
      organizationIds?: string[];
      limit?: number;
      triggerType: GraphSyncTriggerType;
      triggeredBy: string;
    }) {
      const organizationIds = await resolveOrganizationIds(input);
      const summaries = [];

      for (const organizationId of organizationIds) {
        const rebuildResult = await organizationRebuildRunner.runOrganizationRebuild({
          organizationId,
          mode: 'full-bootstrap',
          sourceName: null,
          triggerType: input.triggerType,
          triggeredBy: input.triggeredBy,
          cursorSnapshot: {},
        });

        summaries.push({
          organizationId,
          runId: rebuildResult.run.id,
        });
      }

      return {
        job: 'bootstrap' as const,
        organizationIds,
        summaries,
      };
    },

    async runOrgJob(input: {
      organizationIds: string[];
      triggerType: GraphSyncTriggerType;
      triggeredBy: string;
    }) {
      const organizationIds = input.organizationIds
        .map((value) => value.trim())
        .filter(Boolean);

      if (organizationIds.length === 0) {
        throw new Error('手工 org-rebuild 必须显式提供 organizationIds。');
      }
      const summaries = [];

      for (const organizationId of organizationIds) {
        const rebuildResult = await organizationRebuildRunner.runOrganizationRebuild({
          organizationId,
          mode: 'org-rebuild',
          sourceName: null,
          triggerType: input.triggerType,
          triggeredBy: input.triggeredBy,
          cursorSnapshot: {},
        });

        summaries.push({
          organizationId,
          runId: rebuildResult.run.id,
        });
      }

      return {
        job: 'org' as const,
        organizationIds,
        summaries,
      };
    },

    async runIncrementalJob(input: {
      sourceNames?: GraphSyncSourceName[];
      triggerType: GraphSyncTriggerType;
      triggeredBy: string;
    }) {
      const requestedSourceNames = input.sourceNames?.length
        ? input.sourceNames
        : [...sourceNames];
      const summaries = [];

      for (const sourceName of requestedSourceNames) {
        const lifecycle = await runJobWithLifecycle({
          mode: 'incremental-scan',
          scopeKey: sourceName,
          triggerType: input.triggerType,
          triggeredBy: input.triggeredBy,
          execute: async () => {
            const scanResult = await incrementalUseCases.scanSource({
              sourceName,
            });

            return {
              status: 'completed' as const,
              errorDetail: {
                cursor: scanResult.cursor,
                targetCursor: scanResult.targetCursor,
                scannedChangeCount: scanResult.scannedChangeCount,
                dirtyScopeCount: scanResult.dirtyScopeCount,
                diagnostics: scanResult.diagnostics,
              },
              output: scanResult,
            };
          },
        });

        if (!lifecycle.output) {
          summaries.push({
            sourceName,
            status: lifecycle.run.status,
            runId: lifecycle.run.id,
            errorSummary: lifecycle.run.errorSummary,
          });
          continue;
        }

        summaries.push({
          sourceName,
          status: lifecycle.run.status,
          runId: lifecycle.run.id,
          scannedChangeCount: lifecycle.output.scannedChangeCount,
          dirtyScopeCount: lifecycle.output.dirtyScopeCount,
          diagnostics: lifecycle.output.diagnostics,
          targetCursor: lifecycle.output.targetCursor,
        });
      }

      return {
        job: 'incremental' as const,
        summaries,
      };
    },

    async runDispatchJob(input: {
      sourceNames?: GraphSyncSourceName[];
      triggerType: GraphSyncTriggerType;
      triggeredBy: string;
      retryFailed?: boolean;
      maxRetryAttempts?: number;
    }) {
      const requestedSourceNames = input.sourceNames?.length
        ? input.sourceNames
        : [...sourceNames];
      const maxRetryAttempts = input.maxRetryAttempts ?? 3;
      const summaries = [];

      for (const sourceName of requestedSourceNames) {
        const lifecycle = await runJobWithLifecycle({
          mode: 'dispatch',
          scopeKey: sourceName,
          triggerType: input.triggerType,
          triggeredBy: input.triggeredBy,
          execute: async () => {
            let retriedScopeCount = 0;
            let blockedFailedScopeCount = 0;

            if (input.retryFailed) {
              const failedScopes = await dirtyScopeStore.listFailedBySource(
                sourceName,
              );

              for (const scope of failedScopes) {
                if (scope.attemptCount >= maxRetryAttempts) {
                  blockedFailedScopeCount += 1;
                  continue;
                }

                await dirtyScopeStore.markPending(scope, {
                  retryReason: 'manual-retry-dispatch',
                });
                retriedScopeCount += 1;
              }
            }

            const dispatchResult = await incrementalUseCases.dispatchSource({
              sourceName,
              targetCursor: null,
              triggerType: input.triggerType,
              triggeredBy: input.triggeredBy,
            });

            const status = dispatchResult.failedScopeKey
              ? dispatchResult.rebuiltOrganizations.length > 0
                ? 'partial'
                : 'failed'
              : 'completed';

            return {
              status,
              errorSummary: dispatchResult.errorSummary ?? null,
              errorDetail: {
                rebuiltOrganizations: dispatchResult.rebuiltOrganizations,
                cursorAdvanced: dispatchResult.cursorAdvanced,
                advancedCursor: dispatchResult.advancedCursor ?? null,
                failedScopeKey: dispatchResult.failedScopeKey ?? null,
                retriedScopeCount,
                blockedFailedScopeCount,
              },
              output: {
                ...dispatchResult,
                retriedScopeCount,
                blockedFailedScopeCount,
              },
            };
          },
        });

        summaries.push({
          sourceName,
          status: lifecycle.run.status,
          runId: lifecycle.run.id,
          rebuiltOrganizations: lifecycle.output?.rebuiltOrganizations ?? [],
          cursorAdvanced: lifecycle.output?.cursorAdvanced ?? false,
          failedScopeKey: lifecycle.output?.failedScopeKey ?? null,
          errorSummary: lifecycle.run.errorSummary,
          retriedScopeCount: lifecycle.output?.retriedScopeCount ?? 0,
          blockedFailedScopeCount:
            lifecycle.output?.blockedFailedScopeCount ?? 0,
        });
      }

      return {
        job: 'dispatch' as const,
        summaries,
      };
    },

    async runConsistencySweepJob(input: {
      organizationIds?: string[];
      limit?: number;
      triggerType: GraphSyncTriggerType;
      triggeredBy: string;
    }) {
      const organizationIds = await resolveOrganizationIds(input);
      const summaries = [];

      for (const organizationId of organizationIds) {
        const rebuildResult = await organizationRebuildRunner.runOrganizationRebuild({
          organizationId,
          mode: 'consistency-sweep',
          sourceName: null,
          triggerType: input.triggerType,
          triggeredBy: input.triggeredBy,
          cursorSnapshot: {},
        });

        summaries.push({
          organizationId,
          runId: rebuildResult.run.id,
        });
      }

      return {
        job: 'consistency-sweep' as const,
        organizationIds,
        summaries,
      };
    },

    async getStatus(input?: {
      recentRunLimit?: number;
      maxRetryAttempts?: number;
    }) {
      const recentRunLimit = input?.recentRunLimit ?? 10;
      const maxRetryAttempts = input?.maxRetryAttempts ?? 3;
      const [recentRuns, counts] = await Promise.all([
        graphSyncRunStore.listRecent(recentRunLimit),
        dirtyScopeStore.countByStatus(),
      ]);
      const failedScopes = await dirtyScopeStore.listRecentFailures(counts.failed);
      const retryStateSummary = summarizeBacklogByRetryState(
        failedScopes,
        maxRetryAttempts,
      );

      return {
        recentRuns,
        backlog: {
          pending: counts.pending,
          processing: counts.processing,
          completed: counts.completed,
          failed: counts.failed,
          retryableFailed: retryStateSummary.retryableFailed,
          blockedFailed: retryStateSummary.blockedFailed,
        },
        recentFailures: failedScopes,
        runbook: [
          '待补偿失败范围可通过 `pnpm graph:sync:dispatch --retry-failed --maxRetryAttempts=3` 重新派发。',
          '需要按组织人工校正时，可使用 `pnpm graph:sync:org --organizationIds=<org-id>`。',
          '需要定期查漏补缺时，可使用 `pnpm graph:sync:consistency-sweep`。',
        ],
      };
    },
  };
}

const graphSyncOperationsUseCasesModule = {
  createGraphSyncOperationsUseCases,
};

export default graphSyncOperationsUseCasesModule;
