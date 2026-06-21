import {
  normalizePermissionScope,
  type PermissionScope,
} from '@/domain/auth/models';

export const AUTH_ROLE_CODES = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  PROPERTY_ANALYST: 'PROPERTY_ANALYST',
} as const;

const DEFAULT_PLATFORM_ADMIN_ACCOUNTS = new Set(['admin']);

export function isDefaultPlatformAdminAccount(
  account: string | null | undefined,
): boolean {
  const normalizedAccount = account?.trim().toLowerCase();

  return Boolean(
    normalizedAccount &&
      DEFAULT_PLATFORM_ADMIN_ACCOUNTS.has(normalizedAccount),
  );
}

export function applyDirectoryAccountRoleDefaults(
  scope: PermissionScope,
  account: string | null | undefined,
): PermissionScope {
  if (!isDefaultPlatformAdminAccount(account)) {
    return normalizePermissionScope(scope);
  }

  return normalizePermissionScope({
    ...scope,
    roleCodes: [...scope.roleCodes, AUTH_ROLE_CODES.PLATFORM_ADMIN],
  });
}
