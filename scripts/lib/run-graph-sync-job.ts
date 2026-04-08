import { loadEnvConfig } from '@next/env';

import * as graphSyncJobRunnerModule from '../../src/application/graph-sync/job-runner';
import * as graphSyncOperationsModule from '../../src/application/graph-sync/operations-use-cases';
import * as graphSyncUseCasesModule from '../../src/application/graph-sync/use-cases';
import * as incrementalUseCasesModule from '../../src/application/graph-sync/incremental-use-cases';
import {
  GRAPH_SYNC_SOURCE_NAMES,
  type GraphSyncRunMode,
  type GraphSyncSourceName,
  type GraphSyncTriggerType,
} from '../../src/domain/graph-sync/models';
import * as erpReadUseCasesModule from '../../src/application/erp-read/use-cases';
import * as erpRepositoryModule from '../../src/infrastructure/erp/postgres-erp-read-repository';
import * as graphSyncCursorStoreModule from '../../src/infrastructure/graph-sync/postgres-graph-sync-cursor-store';
import * as graphSyncDirtyScopeStoreModule from '../../src/infrastructure/graph-sync/postgres-graph-sync-dirty-scope-store';
import * as graphSyncOrganizationSourceModule from '../../src/infrastructure/graph-sync/postgres-graph-sync-organization-source';
import * as graphSyncRunStoreModule from '../../src/infrastructure/graph-sync/postgres-graph-sync-run-store';
import * as graphSyncSourceScanPortModule from '../../src/infrastructure/graph-sync/postgres-graph-sync-source-scan-port';
import * as neo4jModule from '../../src/infrastructure/neo4j';

loadEnvConfig(process.cwd());

function resolveModuleExport<T extends Record<string, unknown>>(
  moduleNamespace: T,
): T {
  const defaultExport = (moduleNamespace as T & { default?: T }).default;

  return defaultExport ?? moduleNamespace;
}

const { createGraphSyncJobRunner } =
  resolveModuleExport(graphSyncJobRunnerModule);
const { createGraphSyncOperationsUseCases } = resolveModuleExport(
  graphSyncOperationsModule,
);
const { createGraphSyncUseCases } = resolveModuleExport(graphSyncUseCasesModule);
const { createGraphSyncIncrementalUseCases } = resolveModuleExport(
  incrementalUseCasesModule,
);
const { createErpReadUseCases } = resolveModuleExport(erpReadUseCasesModule);
const { createPostgresErpReadRepository } =
  resolveModuleExport(erpRepositoryModule);
const { createPostgresGraphSyncCursorStore } = resolveModuleExport(
  graphSyncCursorStoreModule,
);
const { createPostgresGraphSyncDirtyScopeStore } = resolveModuleExport(
  graphSyncDirtyScopeStoreModule,
);
const { createPostgresGraphSyncOrganizationSource } = resolveModuleExport(
  graphSyncOrganizationSourceModule,
);
const { createPostgresGraphSyncRunStore } = resolveModuleExport(
  graphSyncRunStoreModule,
);
const { createPostgresGraphSyncSourceScanPort } = resolveModuleExport(
  graphSyncSourceScanPortModule,
);
const { graphUseCases } = resolveModuleExport(neo4jModule);

function parseStringListFlag(flagName: string) {
  const cliArg = process.argv.find((arg) => arg.startsWith(`--${flagName}=`));

  if (!cliArg) {
    return undefined;
  }

  return cliArg
    .split('=', 2)[1]
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseNumberFlag(flagName: string) {
  const cliArg = process.argv.find((arg) => arg.startsWith(`--${flagName}=`));

  if (!cliArg) {
    return undefined;
  }

  const parsed = Number.parseInt(cliArg.split('=', 2)[1] ?? '', 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasBooleanFlag(flagName: string) {
  return process.argv.includes(`--${flagName}`);
}

function parseTriggerTypeFlag(defaultTriggerType: GraphSyncTriggerType) {
  const cliArg = process.argv.find((arg) => arg.startsWith('--triggerType='));
  const value = cliArg?.split('=', 2)[1];

  if (
    value === 'manual' ||
    value === 'scheduler' ||
    value === 'deployment' ||
    value === 'recovery'
  ) {
    return value;
  }

  return defaultTriggerType;
}

function parseTriggeredByFlag(defaultTriggeredBy: string) {
  const cliArg = process.argv.find((arg) => arg.startsWith('--triggeredBy='));

  return cliArg?.split('=', 2)[1] ?? defaultTriggeredBy;
}

function createSystemSessionLabel(input: {
  mode: GraphSyncRunMode;
  organizationId: string;
  sourceName?: GraphSyncSourceName | null;
}) {
  return [input.mode, input.sourceName ?? 'manual', input.organizationId].join(
    ':',
  );
}

function buildGraphSyncJobRunner() {
  const erpReadUseCases = createErpReadUseCases({
    erpReadPort: createPostgresErpReadRepository(),
  });
  const graphSyncRunStore = createPostgresGraphSyncRunStore();
  const graphSyncUseCases = createGraphSyncUseCases({
    erpReadUseCases,
    graphUseCases,
    graphSyncRunStore,
  });

  const organizationRebuildRunner = {
    async runOrganizationRebuild(input: {
      organizationId: string;
      mode: GraphSyncRunMode;
      sourceName?: GraphSyncSourceName | null;
      triggerType: GraphSyncTriggerType;
      triggeredBy: string;
      cursorSnapshot: Record<
        string,
        { cursorTime?: string | null; cursorPk?: string | null }
      >;
    }) {
      const sessionLabel = createSystemSessionLabel({
        mode: input.mode,
        sourceName: input.sourceName,
        organizationId: input.organizationId,
      });
      const session = {
        userId: `graph-sync:${input.organizationId}`,
        displayName: `neo4j-graph-sync:${input.mode}`,
        sessionId: `graph-sync:${sessionLabel}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        scope: {
          organizationId: input.organizationId,
          projectIds: [],
          areaIds: [],
          roleCodes: ['SYSTEM_SYNC'],
        },
      };

      const result = await graphSyncUseCases.runOrganizationRebuild({
        session,
        mode: input.mode,
        triggerType: input.triggerType,
        triggeredBy: input.triggeredBy,
        cursorSnapshot: input.cursorSnapshot,
      });

      return {
        run: {
          id: result.run.id,
        },
      };
    },
  };

  const incrementalUseCases = createGraphSyncIncrementalUseCases({
    sourceScanPort: createPostgresGraphSyncSourceScanPort(),
    cursorStore: createPostgresGraphSyncCursorStore(),
    dirtyScopeStore: createPostgresGraphSyncDirtyScopeStore(),
    orgRebuildRunner: {
      async runOrganizationRebuild(input) {
        return organizationRebuildRunner.runOrganizationRebuild({
          ...input,
          mode: input.mode,
        });
      },
    },
  });

  const operationsUseCases = createGraphSyncOperationsUseCases({
    sourceNames: GRAPH_SYNC_SOURCE_NAMES,
    organizationSource: createPostgresGraphSyncOrganizationSource(),
    graphSyncRunStore,
    dirtyScopeStore: createPostgresGraphSyncDirtyScopeStore(),
    incrementalUseCases,
    organizationRebuildRunner,
  });

  return createGraphSyncJobRunner({
    operationsUseCases,
  });
}

export async function runGraphSyncJobCli(input: {
  job:
    | 'bootstrap'
    | 'org'
    | 'incremental'
    | 'dispatch'
    | 'consistency-sweep'
    | 'diagnose-org'
    | 'status';
  defaultTriggerType: GraphSyncTriggerType;
  defaultTriggeredBy: string;
}) {
  const jobRunner = buildGraphSyncJobRunner();
  const triggerType = parseTriggerTypeFlag(input.defaultTriggerType);
  const triggeredBy = parseTriggeredByFlag(input.defaultTriggeredBy);

  try {
    const result = await jobRunner.runJob({
      job: input.job,
      organizationIds: parseStringListFlag('organizationIds'),
      sourceNames: parseStringListFlag(
        'sourceNames',
      ) as GraphSyncSourceName[] | undefined,
      triggerType,
      triggeredBy,
      retryFailed: hasBooleanFlag('retry-failed'),
      maxRetryAttempts: parseNumberFlag('maxRetryAttempts'),
      recentRunLimit: parseNumberFlag('recentRunLimit'),
      limit: parseNumberFlag('limit'),
    });

    console.log(
      JSON.stringify(
        {
          event: 'graph-sync.job.completed',
          job: input.job,
          triggerType,
          triggeredBy,
          result,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          event: 'graph-sync.job.failed',
          job: input.job,
          triggerType,
          triggeredBy,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                }
              : {
                  message: String(error),
                },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

const runGraphSyncJobModule = {
  runGraphSyncJobCli,
};

export default runGraphSyncJobModule;
