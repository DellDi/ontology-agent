import type { ErpReadPort } from '@/application/erp-read/ports';
import {
  canAccessErpScope,
  isComplaintServiceOrder,
  normalizeSatisfactionLevel,
  type ErpChargeItem,
  type ErpOrganization,
  type ErpOwner,
  type ErpPayment,
  type ErpPermissionScope,
  type ErpProject,
  type ErpReceivable,
  type ErpServiceOrder,
} from '@/domain/erp-read/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import {
  erpChargeItems,
  erpOrganizations,
  erpOwners,
  erpPayments,
  erpPrecincts,
  erpReceivables,
  erpServiceOrders,
} from '@/infrastructure/postgres/schema';

type OrganizationPathMap = Map<string, string | null>;

function normalizeText(value: string | number | bigint | null | undefined) {
  const normalizedValue = String(value ?? '').trim();

  return normalizedValue ? normalizedValue : null;
}

function normalizeRequiredText(
  value: string | number | bigint | null | undefined,
  fallback: string,
) {
  return normalizeText(value) ?? fallback;
}

function safeNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalizedValue =
    typeof value === 'number' ? value : Number.parseFloat(String(value));

  return Number.isFinite(normalizedValue) ? normalizedValue : null;
}

function isDeletedFlag(value: string | number | bigint | null | undefined) {
  const normalizedValue = normalizeText(value)?.toLowerCase();

  return (
    normalizedValue === '1' ||
    normalizedValue === 'true' ||
    normalizedValue === 'yes' ||
    normalizedValue === 'y'
  );
}

function isCurrentFlag(value: string | number | bigint | null | undefined) {
  const normalizedValue = normalizeText(value)?.toLowerCase();

  return (
    normalizedValue === '1' ||
    normalizedValue === 'true' ||
    normalizedValue === 'yes' ||
    normalizedValue === 'y'
  );
}

function toIsoString(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString() : null;
}

function createOrganizationPathMap(
  organizations: typeof erpOrganizations.$inferSelect[],
): OrganizationPathMap {
  return new Map(
    organizations.map((organization) => [
      normalizeRequiredText(organization.sourceId, '0'),
      normalizeText(organization.organizationPath),
    ]),
  );
}

function resolveOrganizationPath(
  organizationPaths: OrganizationPathMap,
  organizationId: string | null | undefined,
) {
  const normalizedOrganizationId = normalizeText(organizationId);

  if (!normalizedOrganizationId) {
    return null;
  }

  return organizationPaths.get(normalizedOrganizationId) ?? null;
}

function mapOrganizationRow(
  row: typeof erpOrganizations.$inferSelect,
): ErpOrganization {
  return {
    id: normalizeRequiredText(row.sourceId, '0'),
    parentId: normalizeText(row.organizationParentId),
    name: normalizeRequiredText(row.organizationName, '未命名组织'),
    shortName: normalizeText(row.organizationShortName),
    path: normalizeText(row.organizationPath),
    level: row.organizationLevel,
    nature: normalizeText(row.organizationNature),
    enterpriseId: normalizeText(row.enterpriseId),
    groupId: normalizeText(row.groupId),
    companyId: normalizeText(row.companyId),
    departmentId: normalizeText(row.departmentId),
    enabled: !isDeletedFlag(row.isDeleted) &&
      normalizeText(row.organizationEnableState) !== '0',
  };
}

function mapPrecinctRow(row: typeof erpPrecincts.$inferSelect): ErpProject {
  return {
    id: row.precinctId,
    code: normalizeText(row.precinctNo),
    name: normalizeRequiredText(row.precinctName, '未命名项目'),
    organizationId:
      normalizeText(row.organizationId) ?? normalizeRequiredText(row.orgId, ''),
    areaId: normalizeText(row.areaId),
    areaName: normalizeText(row.areaName),
    enterpriseId: normalizeText(row.enterpriseId),
    projectType: normalizeText(row.precinctType),
    projectTypeName: normalizeText(row.precinctTypeName),
    deliveryTime: toIsoString(row.deliveryTime),
    contractArea: safeNumber(row.contractArea),
    managedArea: safeNumber(row.nozzleArea),
    chargeArea: safeNumber(row.payChargeArea),
    totalHouseholds: row.totalHouseHolder,
  };
}

function mapOwnerRow(row: typeof erpOwners.$inferSelect): ErpOwner {
  return {
    recordId: normalizeRequiredText(row.recordId, '0'),
    ownerId: row.ownerId,
    ownerName: normalizeRequiredText(row.ownerName, '未命名客户'),
    ownerType: normalizeText(row.ownerType),
    isCurrent: isCurrentFlag(row.isCurrent),
    houseId: normalizeText(row.houseId),
    houseName: normalizeText(row.houseName),
    projectId: row.precinctId,
    projectName: normalizeText(row.precinctName),
    organizationId: normalizeRequiredText(row.orgId, ''),
  };
}

function mapChargeItemRow(
  row: typeof erpChargeItems.$inferSelect,
): ErpChargeItem {
  return {
    id: row.chargeItemId,
    code: normalizeText(row.chargeItemCode),
    name: normalizeRequiredText(row.chargeItemName, '未命名收费项目'),
    typeCode: normalizeText(row.chargeItemType),
    typeName: normalizeText(row.chargeItemTypeName),
    classCode: normalizeText(row.chargeItemClass),
    className: normalizeText(row.chargeItemClassName),
    oneLevelName: normalizeText(row.oneLevelChargeItemName),
    organizationId: normalizeRequiredText(row.organizationId, ''),
  };
}

function mapReceivableRow(
  row: typeof erpReceivables.$inferSelect,
): ErpReceivable {
  return {
    recordId: normalizeRequiredText(row.recordId, '0'),
    organizationId: row.organizationId,
    projectId: normalizeText(row.precinctId),
    projectName: normalizeText(row.precinctName),
    houseId: normalizeText(row.houseId),
    houseName: normalizeText(row.houseName),
    ownerId: normalizeText(row.ownerId),
    ownerName: normalizeText(row.ownerName),
    chargeItemId: normalizeText(row.chargeItemId),
    chargeItemCode: normalizeText(row.chargeItemCode),
    chargeItemName: normalizeText(row.chargeItemName),
    shouldAmount: safeNumber(row.chargeSum),
    actualAmount: safeNumber(row.actualChargeSum),
    paidAmount: safeNumber(row.paidChargeSum),
    arrearsAmount: safeNumber(row.arrears),
    discountAmount: safeNumber(row.discount),
    delayAmount: safeNumber(row.delaySum),
    delayDiscountAmount: safeNumber(row.delayDiscount),
    shouldChargeDate: toIsoString(row.shouldChargeDate),
  };
}

function mapPaymentRow(
  row: typeof erpPayments.$inferSelect,
): ErpPayment {
  return {
    recordId: normalizeRequiredText(row.recordId, '0'),
    organizationId: row.organizationId,
    projectId: normalizeText(row.precinctId),
    projectName: normalizeText(row.precinctName),
    houseId: normalizeText(row.houseId),
    houseName: normalizeText(row.houseName),
    ownerId: normalizeText(row.ownerId),
    ownerName: normalizeText(row.ownerName),
    chargeItemId: normalizeText(row.chargeItemId),
    chargeItemCode: normalizeText(row.chargeItemCode),
    chargeItemName: normalizeText(row.chargeItemName),
    paidAmount: safeNumber(row.chargePaid),
    discountAmount: safeNumber(row.discount),
    delayAmount: safeNumber(row.delaySum),
    operatorDate: toIsoString(row.operatorDate),
  };
}

function mapServiceOrderRow(
  row: typeof erpServiceOrders.$inferSelect,
  organizationPath: string | null,
): ErpServiceOrder {
  return {
    id: row.servicesNo,
    organizationId: row.organizationId,
    organizationPath,
    projectId: normalizeText(row.precinctId),
    projectName: normalizeText(row.precinctName),
    houseId: normalizeText(row.houseId),
    customerId: normalizeText(row.customerId),
    customerName: normalizeText(row.customerName),
    serviceTypeName: normalizeText(row.serviceTypeName),
    serviceStyleName: normalizeText(row.serviceStyleName),
    serviceKindName: normalizeText(row.serviceKindIdName),
    serviceSourceName: normalizeText(row.serviceSourceName),
    status: normalizeText(row.serviceStatus),
    statusName: normalizeText(row.serviceStatusName),
    content: normalizeText(row.content),
    createdAt: toIsoString(row.createDateTime),
    completedAt: toIsoString(row.accomplishDate),
    satisfaction: safeNumber(row.satisfaction),
    satisfactionLevel: normalizeSatisfactionLevel(row.satisfactionEval),
    isComplaint: isComplaintServiceOrder(row.serviceStyleName),
  };
}

export function createPostgresErpReadRepository(db?: PostgresDb): ErpReadPort {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async listOrganizations(scope: ErpPermissionScope) {
      const rows = await resolvedDb.select().from(erpOrganizations);

      return rows
        .map(mapOrganizationRow)
        .filter((organization) =>
          canAccessErpScope(scope, {
            organizationId: organization.id,
            organizationPath: organization.path,
            deleted: !organization.enabled,
          }),
        );
    },

    async listProjects(scope: ErpPermissionScope) {
      const [rows, organizations] = await Promise.all([
        resolvedDb.select().from(erpPrecincts),
        resolvedDb.select().from(erpOrganizations),
      ]);
      const organizationPaths = createOrganizationPathMap(organizations);

      return rows
        .filter((row) => !isDeletedFlag(row.isDelete) && !isDeletedFlag(row.deleteFlag))
        .map(mapPrecinctRow)
        .filter((project) =>
          canAccessErpScope(scope, {
            organizationId: project.organizationId,
            organizationPath: resolveOrganizationPath(
              organizationPaths,
              project.organizationId,
            ),
            projectId: project.id,
          }),
        );
    },

    async listCurrentOwners(scope: ErpPermissionScope) {
      const [rows, organizations] = await Promise.all([
        resolvedDb.select().from(erpOwners),
        resolvedDb.select().from(erpOrganizations),
      ]);
      const organizationPaths = createOrganizationPathMap(organizations);

      return rows
        .filter((row) => isCurrentFlag(row.isCurrent))
        .map(mapOwnerRow)
        .filter((owner) =>
          canAccessErpScope(scope, {
            organizationId: owner.organizationId,
            organizationPath: resolveOrganizationPath(
              organizationPaths,
              owner.organizationId,
            ),
            projectId: owner.projectId,
          }),
        );
    },

    async listChargeItems(_scope: ErpPermissionScope) {
      void _scope;
      const rows = await resolvedDb.select().from(erpChargeItems);

      return rows.map(mapChargeItemRow);
    },

    async listReceivables(scope: ErpPermissionScope) {
      const [rows, organizations] = await Promise.all([
        resolvedDb.select().from(erpReceivables),
        resolvedDb.select().from(erpOrganizations),
      ]);
      const organizationPaths = createOrganizationPathMap(organizations);

      return rows
        .filter((row) => !isDeletedFlag(row.isDelete))
        .map(mapReceivableRow)
        .filter((receivable) =>
          canAccessErpScope(scope, {
            organizationId: receivable.organizationId,
            organizationPath: resolveOrganizationPath(
              organizationPaths,
              receivable.organizationId,
            ),
            projectId: receivable.projectId,
          }),
        );
    },

    async listPayments(scope: ErpPermissionScope) {
      const [rows, organizations] = await Promise.all([
        resolvedDb.select().from(erpPayments),
        resolvedDb.select().from(erpOrganizations),
      ]);
      const organizationPaths = createOrganizationPathMap(organizations);

      return rows
        .filter((row) => !isDeletedFlag(row.isDelete))
        .map(mapPaymentRow)
        .filter((payment) =>
          canAccessErpScope(scope, {
            organizationId: payment.organizationId,
            organizationPath: resolveOrganizationPath(
              organizationPaths,
              payment.organizationId,
            ),
            projectId: payment.projectId,
          }),
        );
    },

    async listServiceOrders(scope: ErpPermissionScope) {
      const [rows, organizations] = await Promise.all([
        resolvedDb.select().from(erpServiceOrders),
        resolvedDb.select().from(erpOrganizations),
      ]);
      const organizationPaths = createOrganizationPathMap(organizations);

      return rows
        .filter((row) => !isDeletedFlag(row.isDelete))
        .map((row) =>
          mapServiceOrderRow(
            row,
            resolveOrganizationPath(organizationPaths, row.organizationId),
          ),
        )
        .filter((serviceOrder) =>
          canAccessErpScope(scope, {
            organizationId: serviceOrder.organizationId,
            organizationPath: serviceOrder.organizationPath,
            projectId: serviceOrder.projectId,
          }),
        );
    },
  };
}
