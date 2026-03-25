import type { AuthSession } from '@/domain/auth/models';

function formatList(values: string[]) {
  return values.length > 0 ? values.join(', ') : '未分配';
}

export function formatScopeSummary(session: AuthSession) {
  return {
    organization: session.scope.organizationId,
    projects: formatList(session.scope.projectIds),
    areas: formatList(session.scope.areaIds),
    roles: formatList(session.scope.roleCodes),
  };
}
