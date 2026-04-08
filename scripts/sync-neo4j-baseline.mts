import nextEnvModule from '@next/env';

import * as erpReadUseCasesModule from '../src/application/erp-read/use-cases';
import * as graphSyncUseCasesModule from '../src/application/graph-sync/use-cases';
import * as erpRepositoryModule from '../src/infrastructure/erp/postgres-erp-read-repository';
import * as neo4jModule from '../src/infrastructure/neo4j';
import * as postgresClientModule from '../src/infrastructure/postgres/client';

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
const { createPostgresErpReadRepository } =
  resolveModuleExport(erpRepositoryModule);
const { graphUseCases } = resolveModuleExport(neo4jModule);
const { createPostgresDb } = resolveModuleExport(postgresClientModule);

function parseOrganizationIds() {
  const cliArg = process.argv.find((arg) => arg.startsWith('--organizationIds='));

  if (!cliArg) {
    return null;
  }

  return cliArg
    .split('=', 2)[1]
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function resolveOrganizationIds() {
  const explicitOrganizationIds = parseOrganizationIds();

  if (explicitOrganizationIds && explicitOrganizationIds.length > 0) {
    return explicitOrganizationIds;
  }

  const { pool } = createPostgresDb();
  const queryResult = await pool.query(`
    select distinct coalesce(organization_id::text, org_id) as organization_id
    from erp_staging.dw_datacenter_precinct
    where coalesce(organization_id::text, org_id) is not null
    order by organization_id
  `);

  return queryResult.rows
    .map((row) => String(row.organization_id ?? '').trim())
    .filter(Boolean);
}

async function run() {
  const organizationIds = await resolveOrganizationIds();

  if (organizationIds.length === 0) {
    throw new Error('未能从 ERP staging 中解析出可同步的 organizationId。');
  }

  const erpReadUseCases = createErpReadUseCases({
    erpReadPort: createPostgresErpReadRepository(),
  });
  const syncUseCases = createGraphSyncUseCases({
    erpReadUseCases,
    graphUseCases,
  });

  const summaries = [];

  for (const organizationId of organizationIds) {
    const session = {
      userId: `graph-sync:${organizationId}`,
      displayName: 'neo4j-graph-sync',
      sessionId: `graph-sync:${organizationId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scope: {
        organizationId,
        projectIds: [],
        areaIds: [],
        roleCodes: ['SYSTEM_SYNC'],
      },
    };

    const result = await syncUseCases.syncBaseline({
      session,
    });

    summaries.push({
      organizationId,
      nodesWritten: result.nodesWritten,
      edgesWritten: result.edgesWritten,
    });
  }

  console.log(JSON.stringify(summaries, null, 2));
}

run().catch((error) => {
  console.error(
    '[sync-neo4j-baseline] Failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
