import { redirect } from 'next/navigation';

import type { AuthSession } from '@/domain/auth/models';
import {
  resolveGovernanceCapabilities,
  type OntologyGovernanceCapabilities,
} from '@/domain/ontology/governance';

import { getRequestSession } from './server-auth';

export type OntologyAdminSessionState = {
  session: AuthSession;
  capabilities: OntologyGovernanceCapabilities;
  accessDeniedMessage: string | null;
};

/**
 * 本体治理后台访问入口（Story 9.5）。
 *
 * 与 `(workspace)` 的 `getWorkspaceSessionState` 模式对齐：
 *  - 未登录返回 null（页面侧 redirect 到 /login）
 *  - 已登录但无任何治理角色：返回带 accessDeniedMessage 的状态
 *  - 已登录且至少有 viewer：返回完整 capabilities
 */
export async function getOntologyAdminSessionState(): Promise<OntologyAdminSessionState | null> {
  const session = await getRequestSession();
  if (!session) {
    return null;
  }
  const capabilities = resolveGovernanceCapabilities(session.scope.roleCodes);
  if (!capabilities.canView) {
    return {
      session,
      capabilities,
      accessDeniedMessage:
        '当前账号已登录，但还没有本体治理后台访问权限。请联系平台管理员授予 ONTOLOGY_VIEWER 或更高角色。',
    };
  }
  return {
    session,
    capabilities,
    accessDeniedMessage: null,
  };
}

export async function requireOntologyAdminSession(
  pathname = '/admin/ontology',
): Promise<OntologyAdminSessionState> {
  const state = await getOntologyAdminSessionState();
  if (!state) {
    redirect(`/login?next=${encodeURIComponent(pathname)}`);
  }
  return state;
}
