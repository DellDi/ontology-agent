import type { AuthIdentity } from '@/domain/auth/models';

function formatList(values: string[]) {
  return values.length > 0 ? values.join(', ') : '未分配';
}

export function formatScopeSummary(session: AuthIdentity) {
  return {
    organization: session.scope.organizationId,
    projects: formatList(session.scope.projectIds),
    roles: formatList(session.scope.roleCodes),
  };
}
