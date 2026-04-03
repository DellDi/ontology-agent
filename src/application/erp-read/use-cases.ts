import type { AuthSession } from '@/domain/auth/models';
import { normalizeErpPermissionScope } from '@/domain/erp-read/models';

import type { ErpReadPort } from './ports';

type ErpReadUseCasesDependencies = {
  erpReadPort: ErpReadPort;
};

function toPermissionScope(session: AuthSession) {
  return normalizeErpPermissionScope({
    organizationId: session.scope.organizationId,
    projectIds: session.scope.projectIds,
  });
}

export function createErpReadUseCases({
  erpReadPort,
}: ErpReadUseCasesDependencies) {
  return {
    async listOrganizations(session: AuthSession) {
      return await erpReadPort.listOrganizations(toPermissionScope(session));
    },

    async listProjects(session: AuthSession) {
      return await erpReadPort.listProjects(toPermissionScope(session));
    },

    async listCurrentOwners(session: AuthSession) {
      return await erpReadPort.listCurrentOwners(toPermissionScope(session));
    },

    async listChargeItems(session: AuthSession) {
      return await erpReadPort.listChargeItems(toPermissionScope(session));
    },

    async listReceivables(session: AuthSession) {
      return await erpReadPort.listReceivables(toPermissionScope(session));
    },

    async listPayments(session: AuthSession) {
      return await erpReadPort.listPayments(toPermissionScope(session));
    },

    async listServiceOrders(session: AuthSession) {
      return await erpReadPort.listServiceOrders(toPermissionScope(session));
    },
  };
}
