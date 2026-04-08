import { createPostgresDb, type PostgresDatabaseClient } from '@/infrastructure/postgres/client';

export function createPostgresGraphSyncOrganizationSource(
  postgresClient?: PostgresDatabaseClient,
) {
  const resolvedClient = postgresClient ?? createPostgresDb();

  return {
    async listOrganizationIds(input?: { limit?: number | null }) {
      const limitClause =
        input?.limit && input.limit > 0
          ? `limit ${Math.trunc(input.limit)}`
          : '';

      const result = await resolvedClient.pool.query(`
        select distinct coalesce(organization_id::text, org_id) as organization_id
        from erp_staging.dw_datacenter_precinct
        where coalesce(organization_id::text, org_id) is not null
        order by organization_id
        ${limitClause}
      `);

      return result.rows
        .map((row) => String(row.organization_id ?? '').trim())
        .filter(Boolean);
    },
  };
}

const graphSyncOrganizationSourceModule = {
  createPostgresGraphSyncOrganizationSource,
};

export default graphSyncOrganizationSourceModule;
