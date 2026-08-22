import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { resolveGovernanceCapabilities } from '@/domain/ontology/governance';

import {
  governanceChangeRequestDetailSchema,
  governanceChangeRequestListSchema,
  governanceDefinitionsSchema,
  governanceOverviewSchema,
  governancePublishHistorySchema,
  governanceVersionListSchema,
} from './governance-schema';
import {
  getCurrentViewer,
  JavaBackendHttpError,
  readJavaBackend,
} from './read-client';

export const getJavaOntologyAdminSessionState = cache(async () => {
  const viewer = await getCurrentViewer();
  const capabilities = resolveGovernanceCapabilities(viewer.scope.roleCodes);
  return {
    viewer,
    capabilities,
    accessDeniedMessage: capabilities.canView
      ? null
      : '当前账号已登录，但还没有本体治理后台访问权限。请联系平台管理员授予 ONTOLOGY_VIEWER 或更高角色。',
  };
});

export async function requireJavaOntologyAdminSession(pathname: string) {
  try {
    return await getJavaOntologyAdminSessionState();
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401) {
      redirect(`/login?next=${encodeURIComponent(pathname)}`);
    }
    throw error;
  }
}

export function getGovernanceOverview() {
  return readJavaBackend('/api/admin/ontology/overview', governanceOverviewSchema);
}

export function getGovernanceVersions(limit = 50) {
  return readJavaBackend(
    `/api/admin/ontology/versions?limit=${encodeURIComponent(String(limit))}`,
    governanceVersionListSchema,
  );
}

export function getGovernanceDefinitions(versionId: string) {
  return readJavaBackend(
    `/api/admin/ontology/definitions?versionId=${encodeURIComponent(versionId)}`,
    governanceDefinitionsSchema,
  );
}

export function getGovernanceChangeRequests(status?: string, limit = 100) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (status) query.set('status', status);
  return readJavaBackend(
    `/api/admin/ontology/change-requests?${query.toString()}`,
    governanceChangeRequestListSchema,
  );
}

export function getGovernanceChangeRequest(id: string) {
  return readJavaBackend(
    `/api/admin/ontology/change-requests/${encodeURIComponent(id)}`,
    governanceChangeRequestDetailSchema,
  );
}

export function getGovernancePublishHistory(limit = 50) {
  return readJavaBackend(
    `/api/admin/ontology/publishes?limit=${encodeURIComponent(String(limit))}`,
    governancePublishHistorySchema,
  );
}
