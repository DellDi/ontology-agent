import type { PermissionScope } from '@/domain/auth/models';

export type ErpPermissionScope = Pick<
  PermissionScope,
  'organizationId' | 'projectIds'
>;

export type ErpScopedRecord = {
  organizationId: string;
  organizationPath?: string | null;
  projectId?: string | null;
  deleted?: boolean;
};

export type ErpOrganization = {
  id: string;
  parentId: string | null;
  name: string;
  shortName: string | null;
  path: string | null;
  level: number | null;
  nature: string | null;
  enterpriseId: string | null;
  groupId: string | null;
  companyId: string | null;
  departmentId: string | null;
  enabled: boolean;
};

export type ErpProject = {
  id: string;
  code: string | null;
  name: string;
  organizationId: string;
  areaId: string | null;
  areaName: string | null;
  enterpriseId: string | null;
  projectType: string | null;
  projectTypeName: string | null;
  deliveryTime: string | null;
  contractArea: number | null;
  managedArea: number | null;
  chargeArea: number | null;
  totalHouseholds: number | null;
};

export type ErpOwner = {
  recordId: string;
  ownerId: string;
  ownerName: string;
  ownerType: string | null;
  isCurrent: boolean;
  houseId: string | null;
  houseName: string | null;
  projectId: string;
  projectName: string | null;
  organizationId: string;
};

export type ErpChargeItem = {
  id: string;
  code: string | null;
  name: string;
  typeCode: string | null;
  typeName: string | null;
  classCode: string | null;
  className: string | null;
  oneLevelName: string | null;
  organizationId: string;
};

export type ErpReceivable = {
  recordId: string;
  organizationId: string;
  projectId: string | null;
  projectName: string | null;
  houseId: string | null;
  houseName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  chargeItemId: string | null;
  chargeItemCode: string | null;
  chargeItemName: string | null;
  shouldAmount: number | null;
  actualAmount: number | null;
  paidAmount: number | null;
  arrearsAmount: number | null;
  discountAmount: number | null;
  delayAmount: number | null;
  delayDiscountAmount: number | null;
  shouldChargeDate: string | null;
};

export type ErpPayment = {
  recordId: string;
  organizationId: string;
  projectId: string | null;
  projectName: string | null;
  houseId: string | null;
  houseName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  chargeItemId: string | null;
  chargeItemCode: string | null;
  chargeItemName: string | null;
  paidAmount: number | null;
  discountAmount: number | null;
  delayAmount: number | null;
  operatorDate: string | null;
};

export type ErpServiceOrder = {
  id: string;
  organizationId: string;
  organizationPath: string | null;
  projectId: string | null;
  projectName: string | null;
  houseId: string | null;
  customerId: string | null;
  customerName: string | null;
  serviceTypeName: string | null;
  serviceStyleName: string | null;
  serviceKindName: string | null;
  serviceSourceName: string | null;
  status: string | null;
  statusName: string | null;
  content: string | null;
  createdAt: string | null;
  completedAt: string | null;
  satisfaction: number | null;
  satisfactionLevel: number | null;
  isComplaint: boolean;
};

function normalizeScopeValue(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeScopeList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function pathIncludesOrganization(
  organizationPath: string | null | undefined,
  organizationId: string,
) {
  const normalizedPath = normalizeScopeValue(organizationPath);

  if (!normalizedPath) {
    return false;
  }

  return normalizedPath.includes(`/${organizationId}/`);
}

export function normalizeErpPermissionScope(
  scope: ErpPermissionScope,
): ErpPermissionScope {
  return {
    organizationId: scope.organizationId.trim(),
    projectIds: normalizeScopeList(scope.projectIds),
  };
}

export function canAccessErpScope(
  scope: ErpPermissionScope,
  record: ErpScopedRecord,
) {
  const normalizedScope = normalizeErpPermissionScope(scope);
  const recordOrganizationId = normalizeScopeValue(record.organizationId);

  if (!recordOrganizationId || record.deleted) {
    return false;
  }

  const organizationMatched =
    recordOrganizationId === normalizedScope.organizationId ||
    pathIncludesOrganization(record.organizationPath, normalizedScope.organizationId);

  if (!organizationMatched) {
    return false;
  }

  const recordProjectId = normalizeScopeValue(record.projectId);
  const requiresProjectMatch = normalizedScope.projectIds.length > 0;

  if (requiresProjectMatch && !recordProjectId) {
    return false;
  }

  if (
    recordProjectId &&
    requiresProjectMatch &&
    !normalizedScope.projectIds.includes(recordProjectId)
  ) {
    return false;
  }

  return true;
}

export function toComplaintKind(serviceStyleName: string | null | undefined) {
  const normalizedStyleName = normalizeScopeValue(serviceStyleName);

  if (!normalizedStyleName) {
    return 'service-order';
  }

  return normalizedStyleName === '投诉' ? 'complaint' : 'service-order';
}

export function isComplaintServiceOrder(
  serviceStyleName: string | null | undefined,
) {
  return toComplaintKind(serviceStyleName) === 'complaint';
}

export function normalizeSatisfactionLevel(
  value: number | string | null | undefined,
) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);

  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 5) {
    return null;
  }

  return numericValue;
}
