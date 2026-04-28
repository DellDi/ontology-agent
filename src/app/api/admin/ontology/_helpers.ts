import { NextResponse } from 'next/server';

import {
  ChangeRequestNotFoundError,
  InvalidChangeRequestTransitionError,
  OntologyGovernanceForbiddenError,
  OntologyVersionNotReadyForPublishError,
  resolveGovernanceCapabilities,
} from '@/domain/ontology/governance';
import { auditUseCases } from '@/infrastructure/audit';
import { getRequestSession } from '@/infrastructure/session/server-auth';
import type { AuthSession } from '@/domain/auth/models';

export type AuthorizedSession = {
  session: AuthSession;
  capabilities: ReturnType<typeof resolveGovernanceCapabilities>;
};

/**
 * 鉴权与角色判定的最小受控入口（Story 9.5）。
 * 未登录 -> 401；已登录但缺少所需治理角色 -> 403。
 */
export async function authorizeGovernanceRequest(
  request: 'view' | 'author' | 'review' | 'publish',
): Promise<NextResponse | AuthorizedSession> {
  const session = await getRequestSession();
  if (!session) {
    return NextResponse.json({ error: '未登录。' }, { status: 401 });
  }
  const capabilities = resolveGovernanceCapabilities(session.scope.roleCodes);

  let authorized = false;
  switch (request) {
    case 'view':
      authorized = capabilities.canView;
      break;
    case 'author':
      authorized = capabilities.canAuthor;
      break;
    case 'review':
      authorized = capabilities.canReview;
      break;
    case 'publish':
      authorized = capabilities.canPublish;
      break;
  }

  if (!authorized) {
    await auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: session.sessionId,
      eventType: 'authorization.denied',
      eventResult: 'denied',
      eventSource: 'route-handler',
      payload: {
        scope: 'ontology-governance',
        action: request,
      },
    });
    return NextResponse.json(
      { error: '当前账号没有执行该治理操作的权限。' },
      { status: 403 },
    );
  }

  return { session, capabilities };
}

export function buildRedirect(request: Request, pathname: string, params: URLSearchParams) {
  const url = new URL(pathname, request.url);
  params.forEach((value, key) => url.searchParams.set(key, value));
  return NextResponse.redirect(url, { status: 303 });
}

export function describeGovernanceError(error: unknown): {
  message: string;
  reason: string;
} {
  if (error instanceof InvalidChangeRequestTransitionError) {
    return { message: error.message, reason: 'invalid-transition' };
  }
  if (error instanceof ChangeRequestNotFoundError) {
    return { message: error.message, reason: 'not-found' };
  }
  if (error instanceof OntologyVersionNotReadyForPublishError) {
    return { message: error.message, reason: 'not-publishable' };
  }
  if (error instanceof OntologyGovernanceForbiddenError) {
    return { message: error.message, reason: 'forbidden' };
  }
  if (error instanceof Error) {
    return { message: error.message, reason: 'internal' };
  }
  return { message: '未知错误。', reason: 'unknown' };
}
