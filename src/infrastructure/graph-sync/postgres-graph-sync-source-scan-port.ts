import type { GraphSyncSourceScanPort } from '@/application/graph-sync/runtime-ports';
import type { GraphSyncCursorPosition, GraphSyncIncrementalChange } from '@/domain/graph-sync/models';
import { createPostgresDb, type PostgresDatabaseClient } from '@/infrastructure/postgres/client';

type SourceScanDefinition = {
  sourceName: GraphSyncIncrementalChange['sourceName'];
  tableName: string;
  pkExpression: string;
  cursorTimeExpression: string;
  scopeOrgExpression: string;
  reason: string;
  deletedPredicate?: string;
};

const NULL_CURSOR_SENTINEL_SQL =
  "timestamp with time zone '9999-12-31 23:59:59.999+00'";

function buildNormalizedCursorTimeExpression(definition: SourceScanDefinition) {
  return `coalesce(${definition.cursorTimeExpression}, ${NULL_CURSOR_SENTINEL_SQL})`;
}

const SOURCE_SCAN_DEFINITIONS: Record<
  GraphSyncIncrementalChange['sourceName'],
  SourceScanDefinition
> = {
  'erp.organizations': {
    sourceName: 'erp.organizations',
    tableName: 'erp_staging.dw_datacenter_system_organization',
    pkExpression: 'source_id::text',
    cursorTimeExpression: 'coalesce(update_time, create_time)',
    scopeOrgExpression: 'source_id::text',
    reason: 'organizations-changed',
    deletedPredicate: 'coalesce(is_deleted, 0) <> 1',
  },
  'erp.projects': {
    sourceName: 'erp.projects',
    tableName: 'erp_staging.dw_datacenter_precinct',
    pkExpression: 'precinct_id::text',
    cursorTimeExpression: 'coalesce(update_date, sync_date, create_date)',
    scopeOrgExpression: "coalesce(nullif(organization_id::text, ''), nullif(org_id, ''))",
    reason: 'projects-changed',
    deletedPredicate: 'coalesce(is_delete, 0) <> 1 and coalesce(delete_flag, 0) <> 1',
  },
  'erp.owners': {
    sourceName: 'erp.owners',
    tableName: 'erp_staging.dw_datacenter_owner',
    pkExpression: 'record_id::text',
    cursorTimeExpression: 'coalesce(update_date, sync_date, create_date)',
    scopeOrgExpression: "nullif(org_id, '')",
    reason: 'owners-changed',
    deletedPredicate: "coalesce(is_current, '') in ('1', 'true', 'yes', 'y')",
  },
  'erp.charge_items': {
    sourceName: 'erp.charge_items',
    tableName: 'erp_staging.dw_datacenter_chargeitem',
    pkExpression: 'charge_item_id::text',
    cursorTimeExpression: 'coalesce(update_date, sync_date, create_date)',
    scopeOrgExpression: "nullif(organization_id, '')",
    reason: 'charge-items-changed',
    deletedPredicate: 'coalesce(delete_flag, 0) <> 1',
  },
  'erp.receivables': {
    sourceName: 'erp.receivables',
    tableName: 'erp_staging.dw_datacenter_charge',
    pkExpression: 'record_id::text',
    cursorTimeExpression: 'coalesce(update_date, sync_date, should_charge_date, create_date)',
    scopeOrgExpression: "nullif(organization_id, '')",
    reason: 'receivables-changed',
    deletedPredicate: 'coalesce(is_delete, 0) <> 1',
  },
  'erp.payments': {
    sourceName: 'erp.payments',
    tableName: 'erp_staging.dw_datacenter_bill',
    pkExpression: 'record_id::text',
    cursorTimeExpression: 'coalesce(operator_date, update_date, sync_date)',
    scopeOrgExpression: "nullif(organization_id, '')",
    reason: 'payments-changed',
    deletedPredicate: 'coalesce(is_delete, 0) <> 1',
  },
  'erp.service_orders': {
    sourceName: 'erp.service_orders',
    tableName: 'erp_staging.dw_datacenter_services',
    pkExpression: 'services_no::text',
    cursorTimeExpression: 'coalesce(update_date_time, sync_date, create_date_time)',
    scopeOrgExpression: "nullif(organization_id, '')",
    reason: 'service-orders-changed',
    deletedPredicate: 'coalesce(is_delete, 0) <> 1',
  },
};

function buildSourceQuery(definition: SourceScanDefinition) {
  const deletedPredicate = definition.deletedPredicate
    ? `${definition.deletedPredicate} and `
    : '';
  const normalizedCursorTimeExpression =
    buildNormalizedCursorTimeExpression(definition);

  return `
    select
      ${definition.pkExpression} as source_pk,
      ${definition.scopeOrgExpression} as scope_org_id,
      ${normalizedCursorTimeExpression} as cursor_time,
      ${definition.cursorTimeExpression} as raw_cursor_time
    from ${definition.tableName}
    where ${deletedPredicate}(
      $1::timestamptz is null
      or ${normalizedCursorTimeExpression} > $1::timestamptz
      or (
        ${normalizedCursorTimeExpression} = $1::timestamptz
        and ${definition.pkExpression} > coalesce($2::text, '')
      )
    )
    order by ${normalizedCursorTimeExpression}, ${definition.pkExpression}
  `;
}

export function createPostgresGraphSyncSourceScanPort(
  postgresClient?: PostgresDatabaseClient,
): GraphSyncSourceScanPort {
  const resolvedClient = postgresClient ?? createPostgresDb();

  return {
    async scanSourceChanges(input: {
      sourceName: GraphSyncIncrementalChange['sourceName'];
      cursor: GraphSyncCursorPosition | null;
    }) {
      const definition = SOURCE_SCAN_DEFINITIONS[input.sourceName];
      const result = await resolvedClient.pool.query<{
        source_pk: string | null;
        scope_org_id: string | null;
        cursor_time: Date;
        raw_cursor_time: Date | null;
      }>(buildSourceQuery(definition), [
        input.cursor?.cursorTime ?? null,
        input.cursor?.cursorPk ?? null,
      ]);

      const diagnostics: string[] = [];

      if (
        result.rows.some((row) => row.raw_cursor_time === null)
      ) {
        diagnostics.push(
          `${input.sourceName} 存在缺失时间字段的记录，当前已退化为主键窗口扫描。`,
        );
      }

      if (
        input.sourceName === 'erp.charge_items' &&
        result.rows.some((row) => !row.scope_org_id)
      ) {
        diagnostics.push(
          'erp.charge_items 存在缺失 organization_id 的记录，当前不会直接派发全局 dirty scope。',
        );
      }

      return {
        changes: result.rows.map((row) => ({
          sourceName: input.sourceName,
          sourcePk: row.source_pk,
          scopeOrgId: row.scope_org_id,
          reason: definition.reason,
          cursorTime: row.cursor_time.toISOString(),
          cursorPk: row.source_pk,
        })),
        diagnostics,
      };
    },
  };
}
