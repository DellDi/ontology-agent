import nextEnvModule from '@next/env';

import * as erpReadUseCasesModule from '../src/application/erp-read/use-cases';
import * as graphSyncUseCasesModule from '../src/application/graph-sync/use-cases';
import * as incrementalUseCasesModule from '../src/application/graph-sync/incremental-use-cases';
import * as erpRepositoryModule from '../src/infrastructure/erp/postgres-erp-read-repository';
import * as graphSyncCursorStoreModule from '../src/infrastructure/graph-sync/postgres-graph-sync-cursor-store';
import * as graphSyncDirtyScopeStoreModule from '../src/infrastructure/graph-sync/postgres-graph-sync-dirty-scope-store';
import * as graphSyncRunStoreModule from '../src/infrastructure/graph-sync/postgres-graph-sync-run-store';
import * as graphSyncSourceScanPortModule from '../src/infrastructure/graph-sync/postgres-graph-sync-source-scan-port';
import * as neo4jModule from '../src/infrastructure/neo4j';

const { loadEnvConfig } = nextEnvModule;

loadEnvConfig(process.cwd());

function resolveModuleExport<T extends Record<string, unknown>>(
  moduleNamespace: T,
): T {
  const defaultExport = (moduleNamespace as T & { default?: T }).default;

  return defaultExport ?? moduleNamespace;
}

const { createErpReadUseCases } = resolveModuleExport(erpReadUseCasesModule);
const { createGraphSyncUseCases } = resolveModuleExport(graphSyncUseCasesModule);
const { createGraphSyncIncrementalUseCases } = resolveModuleExport(
  incrementalUseCasesModule,
);
const { createPostgresErpReadRepository } =
  resolveModuleExport(erpRepositoryModule);
const { createPostgresGraphSyncCursorStore } = resolveModuleExport(
  graphSyncCursorStoreModule,
);
const { createPostgresGraphSyncDirtyScopeStore } = resolveModuleExport(
  graphSyncDirtyScopeStoreModule,
);
const { createPostgresGraphSyncRunStore } = resolveModuleExport(
  graphSyncRunStoreModule,
);
const { createPostgresGraphSyncSourceScanPort } = resolveModuleExport(
  graphSyncSourceScanPortModule,
);
const { graphUseCases } = resolveModuleExport(neo4jModule);

const sourceNames = [
  'erp.organizations',
  'erp.projects',
  'erp.owners',
  'erp.charge_items',
  'erp.receivables',
  'erp.payments',
  'erp.service_orders',
] as const;

async function run() {
  const erpReadUseCases = createErpReadUseCases({
    erpReadPort: createPostgresErpReadRepository(),
  });
  const graphSyncUseCases = createGraphSyncUseCases({
    erpReadUseCases,
    graphUseCases,
    graphSyncRunStore: createPostgresGraphSyncRunStore(),
  });
  const incrementalUseCases = createGraphSyncIncrementalUseCases({
    sourceScanPort: createPostgresGraphSyncSourceScanPort(),
    cursorStore: createPostgresGraphSyncCursorStore(),
    dirtyScopeStore: createPostgresGraphSyncDirtyScopeStore(),
    orgRebuildRunner: {
      async runOrganizationRebuild(input) {
        const session = {
          userId: `graph-sync:${input.organizationId}`,
          displayName: 'neo4j-graph-sync-incremental',
          sessionId: `graph-sync:${input.sourceName}:${input.organizationId}`,
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
          mode: 'incremental-rebuild',
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
    },
  });

  const summaries = [];

  for (const sourceName of sourceNames) {
    const result = await incrementalUseCases.runIncrementalSource({
      sourceName,
      triggerType: 'manual',
      triggeredBy: 'scripts/sync-neo4j-incremental.mts',
    });

    summaries.push(result);
  }

  console.log(JSON.stringify(summaries, null, 2));
}

run().catch((error) => {
  console.error(
    '[sync-neo4j-incremental] Failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
