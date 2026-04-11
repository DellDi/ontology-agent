import { eq, sql } from 'drizzle-orm';

import type { AuthIdentity } from '@/domain/auth/models';
import { normalizePermissionScope } from '@/domain/auth/models';
import {
  createPostgresDb,
  type PostgresDb,
} from '@/infrastructure/postgres/client';
import {
  erpOrganizations,
  erpPrecincts,
  erpSystemUsers,
} from '@/infrastructure/postgres/schema/erp-staging';

export type ErpDirectoryUser = {
  sourceId: bigint;
  userAccount: string | null;
  userPassword: string | null;
  organizationId: bigint | null;
  isActived: string | null;
  isDeleted: number | null;
  displayName: string | null;
};

export async function findUserByAccount(
  account: string,
  db: PostgresDb,
): Promise<ErpDirectoryUser[]> {
  const rows = await db
    .select({
      sourceId: erpSystemUsers.sourceId,
      userAccount: erpSystemUsers.userAccount,
      userPassword: erpSystemUsers.userPassword,
      organizationId: erpSystemUsers.organizationId,
      isActived: erpSystemUsers.isActived,
      isDeleted: erpSystemUsers.isDeleted,
      displayName: erpSystemUsers.sentryName,
    })
    .from(erpSystemUsers)
    .where(eq(erpSystemUsers.userAccount, account));

  return rows;
}

export async function resolveUserScope(
  userId: string,
  organizationId: bigint,
  db: PostgresDb,
): Promise<AuthIdentity['scope']> {
  const orgIdStr = String(organizationId);

  // 构造当前节点在路径中的匹配模式：
  // 后代节点的 organizationPath 包含 "/<orgId>/" 或以 "/<orgId>" 结尾
  // 例如当前节点 ID=100，后代路径可能是 /1/50/100/200/300
  const pathPrefix1 = `%/${orgIdStr}/%`;
  const pathPrefix2 = `%/${orgIdStr}`;

  // 同时也纳入当前组织节点自身（若其就是 propertyProject）
  const propertyProjectOrgs = await db
    .select({ sourceId: erpOrganizations.sourceId })
    .from(erpOrganizations)
    .where(
      sql`${erpOrganizations.organizationNature} = 'propertyProject'
        AND (
          CAST(${erpOrganizations.sourceId} AS text) = ${orgIdStr}
          OR ${erpOrganizations.organizationPath} LIKE ${pathPrefix1}
          OR ${erpOrganizations.organizationPath} LIKE ${pathPrefix2}
        )`,
    );

  const propertyProjectOrgIds = propertyProjectOrgs.map((row) => String(row.sourceId));

  let projectIds: string[] = [];

  if (propertyProjectOrgIds.length > 0) {
    const projectRows = await db
      .select({ precinctId: erpPrecincts.precinctId })
      .from(erpPrecincts)
      .where(
        sql`CAST(${erpPrecincts.organizationId} AS text) = ANY(${sql`ARRAY[${sql.join(propertyProjectOrgIds.map((id) => sql`${id}`), sql`, `)}]`})`,
      );

    projectIds = projectRows.map((row) => row.precinctId);
  }

  return normalizePermissionScope({
    organizationId: orgIdStr,
    projectIds,
    areaIds: [],
    roleCodes: ['PROPERTY_ANALYST'],
  });
}

export function createErpScopeResolver(db?: PostgresDb) {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    findUserByAccount: (account: string) => findUserByAccount(account, resolvedDb),
    resolveUserScope: (userId: string, organizationId: bigint) =>
      resolveUserScope(userId, organizationId, resolvedDb),
  };
}
