import type {
  ErpChargeItem,
  ErpOrganization,
  ErpOwner,
  ErpPayment,
  ErpPermissionScope,
  ErpProject,
  ErpReceivable,
  ErpServiceOrder,
} from '@/domain/erp-read/models';

export interface ErpReadPort {
  listOrganizations(scope: ErpPermissionScope): Promise<ErpOrganization[]>;
  listProjects(scope: ErpPermissionScope): Promise<ErpProject[]>;
  listCurrentOwners(scope: ErpPermissionScope): Promise<ErpOwner[]>;
  listChargeItems(scope: ErpPermissionScope): Promise<ErpChargeItem[]>;
  listReceivables(scope: ErpPermissionScope): Promise<ErpReceivable[]>;
  listPayments(scope: ErpPermissionScope): Promise<ErpPayment[]>;
  listServiceOrders(scope: ErpPermissionScope): Promise<ErpServiceOrder[]>;
}
