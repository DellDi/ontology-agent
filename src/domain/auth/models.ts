export type PermissionScope = {
  organizationId: string;
  projectIds: string[];
  areaIds: string[];
  roleCodes: string[];
};

export type AuthIdentity = {
  userId: string;
  displayName: string;
  scope: PermissionScope;
};

export type AuthSession = AuthIdentity & {
  sessionId: string;
  expiresAt: string;
};

export type ErpLoginInput = {
  employeeId: string;
  displayName?: string;
  organizationId: string;
  projectIds: string[];
  areaIds: string[];
  roleCodes: string[];
};

export type DirectoryLoginInput = {
  account: string;
  password: string;
};

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizePermissionScope(
  scope: PermissionScope,
): PermissionScope {
  return {
    organizationId: scope.organizationId.trim(),
    projectIds: uniqueValues(scope.projectIds),
    areaIds: uniqueValues(scope.areaIds),
    roleCodes: uniqueValues(scope.roleCodes),
  };
}

export function hasWorkspaceAccess(session: AuthSession | AuthIdentity) {
  return (
    Boolean(session.scope.organizationId) &&
    (session.scope.projectIds.length > 0 ||
      session.scope.areaIds.length > 0 ||
      session.scope.roleCodes.length > 0)
  );
}

export function hasScopedTargets(session: AuthSession | AuthIdentity) {
  return (
    session.scope.projectIds.length > 0 || session.scope.areaIds.length > 0
  );
}

export function parseScopeList(value: FormDataEntryValue | string | null) {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  return uniqueValues(value.split(','));
}

export function sanitizeNextPath(nextPath: string | null | undefined) {
  if (!nextPath) {
    return '/workspace';
  }

  const trimmed = nextPath.trim().replace(/\\/g, '/');

  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/workspace';
  }

  const parsedPath = new URL(trimmed, 'http://localhost');
  const normalizedPath = `${parsedPath.pathname}${parsedPath.search}${parsedPath.hash}`;

  if (
    parsedPath.pathname === '/workspace' ||
    parsedPath.pathname.startsWith('/workspace/')
  ) {
    return normalizedPath;
  }

  return '/workspace';
}
