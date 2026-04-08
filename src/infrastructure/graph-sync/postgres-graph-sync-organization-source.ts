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
        select distinct o.source_id::text as organization_id
        from erp_staging.dw_datacenter_system_organization o
        join erp_staging.dw_datacenter_precinct p
          on p.org_id = o.source_id::text
        where p.org_id is not null
          and p.org_id <> ''
        order by organization_id
        ${limitClause}
      `);

      return result.rows
        .map((row) => String(row.organization_id ?? '').trim())
        .filter(Boolean);
    },

    async diagnoseOrganizationIds(input: { organizationIds: string[] }) {
      const organizationIds = input.organizationIds
        .map((value) => value.trim())
        .filter(Boolean);

      if (organizationIds.length === 0) {
        return [];
      }

      const diagnostics = [];

      for (const organizationId of organizationIds) {
        const [organizationResult, descendantResult, projectResult, serviceResult] =
          await Promise.all([
            resolvedClient.pool.query(
              `
                select
                  source_id::text as organization_id,
                  organization_name,
                  organization_path
                from erp_staging.dw_datacenter_system_organization
                where source_id::text = $1
                limit 1
              `,
              [organizationId],
            ),
            resolvedClient.pool.query(
              `
                select count(*)::int as descendant_organization_count
                from erp_staging.dw_datacenter_system_organization
                where source_id::text = $1
                  or coalesce(organization_path, '') like '%/' || $1 || '/%'
              `,
              [organizationId],
            ),
            resolvedClient.pool.query(
              `
                with descendant_orgs as (
                  select source_id::text as organization_id
                  from erp_staging.dw_datacenter_system_organization
                  where source_id::text = $1
                    or coalesce(organization_path, '') like '%/' || $1 || '/%'
                )
                select
                  count(*) filter (where organization_id::text = $1)::int as precinct_organization_id_match_count,
                  count(*) filter (where org_id = $1)::int as precinct_org_id_match_count,
                  count(*) filter (
                    where org_id in (select organization_id from descendant_orgs)
                  )::int as project_count
                from erp_staging.dw_datacenter_precinct
              `,
              [organizationId],
            ),
            resolvedClient.pool.query(
              `
                with descendant_orgs as (
                  select source_id::text as organization_id
                  from erp_staging.dw_datacenter_system_organization
                  where source_id::text = $1
                    or coalesce(organization_path, '') like '%/' || $1 || '/%'
                )
                select count(*)::int as service_order_count
                from erp_staging.dw_datacenter_services
                where organization_id in (select organization_id from descendant_orgs)
              `,
              [organizationId],
            ),
          ]);

        const matchedOrganizationRow = organizationResult.rows[0];
        const descendantOrganizationCount = Number(
          descendantResult.rows[0]?.descendant_organization_count ?? 0,
        );
        const projectCounts = projectResult.rows[0] ?? {};
        const serviceOrderCount = Number(
          serviceResult.rows[0]?.service_order_count ?? 0,
        );
        const precinctOrganizationIdMatchCount = Number(
          projectCounts.precinct_organization_id_match_count ?? 0,
        );
        const precinctOrgIdMatchCount = Number(
          projectCounts.precinct_org_id_match_count ?? 0,
        );
        const projectCount = Number(projectCounts.project_count ?? 0);

        const summaryDiagnostics = [];

        if (matchedOrganizationRow) {
          summaryDiagnostics.push(
            '命中 erp_staging.dw_datacenter_system_organization.source_id。',
          );

          if (
            precinctOrganizationIdMatchCount === 0 &&
            (precinctOrgIdMatchCount > 0 || projectCount > 0)
          ) {
            summaryDiagnostics.push(
              'dw_datacenter_precinct.organization_id 未命中，实际作用域键为 org_id。',
            );
          }

          if (projectCount > precinctOrgIdMatchCount) {
            summaryDiagnostics.push(
              '项目命中来自 organization_path 扩展后的下级组织范围，而不只是当前组织本身。',
            );
          }
        } else {
          summaryDiagnostics.push(
            '未命中真实组织主数据，无法基于 organization_path 扩展作用域。',
          );
        }

        diagnostics.push({
          requestedOrganizationId: organizationId,
          matchedOrganization: matchedOrganizationRow
            ? {
                organizationId: String(
                  matchedOrganizationRow.organization_id ?? organizationId,
                ),
                organizationName: String(
                  matchedOrganizationRow.organization_name ?? '',
                ),
                organizationPath:
                  matchedOrganizationRow.organization_path === null
                    ? null
                    : String(matchedOrganizationRow.organization_path ?? ''),
              }
            : null,
          descendantOrganizationCount,
          projectCount,
          serviceOrderCount,
          precinctOrganizationIdMatchCount,
          precinctOrgIdMatchCount,
          diagnostics: summaryDiagnostics,
        });
      }

      return diagnostics;
    },
  };
}

const graphSyncOrganizationSourceModule = {
  createPostgresGraphSyncOrganizationSource,
};

export default graphSyncOrganizationSourceModule;
