import {
  DevErpAuthDisabledError,
  InvalidErpCredentialsError,
} from '@/domain/auth/errors';
import {
  normalizePermissionScope,
  parseScopeList,
  type AuthIdentity,
  type ErpLoginInput,
} from '@/domain/auth/models';

import type { ErpAuthAdapter } from '@/application/auth/ports';

import { isDevErpAuthEnabled } from './dev-auth-config';

function buildIdentity(input: ErpLoginInput): AuthIdentity {
  const userId = input.employeeId.trim();
  const organizationId = input.organizationId.trim();

  if (!userId || !organizationId) {
    throw new InvalidErpCredentialsError();
  }

  const scope = normalizePermissionScope({
    organizationId,
    projectIds: input.projectIds,
    areaIds: input.areaIds,
    roleCodes: input.roleCodes,
  });

  return {
    userId,
    displayName: input.displayName?.trim() || `ERP 用户 ${userId}`,
    scope,
  };
}

function parseTicket(ticket: string) {
  const [employeeId, displayName, organizationId, projects, areas, roles] =
    ticket.split('|');

  return buildIdentity({
    employeeId,
    displayName,
    organizationId,
    projectIds: projects?.split(',') ?? [],
    areaIds: areas?.split(',') ?? [],
    roleCodes: roles?.split(',') ?? [],
  });
}

export function createDevErpAuthAdapter(): ErpAuthAdapter {
  return {
    async authenticate(input) {
      if (!isDevErpAuthEnabled()) {
        throw new DevErpAuthDisabledError();
      }

      return buildIdentity(input);
    },

    async exchangeCallback(searchParams) {
      if (!isDevErpAuthEnabled()) {
        throw new DevErpAuthDisabledError();
      }

      const ticket = searchParams.get('ticket');

      if (ticket) {
        return parseTicket(ticket);
      }

      return buildIdentity({
        employeeId: searchParams.get('employeeId') ?? '',
        displayName: searchParams.get('displayName') ?? undefined,
        organizationId: searchParams.get('organizationId') ?? '',
        projectIds: parseScopeList(searchParams.get('projectIds')),
        areaIds: parseScopeList(searchParams.get('areaIds')),
        roleCodes: parseScopeList(searchParams.get('roleCodes')),
      });
    },
  };
}
