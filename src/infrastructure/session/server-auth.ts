import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  DevErpAuthDisabledError,
  InvalidErpCredentialsError,
  WorkspaceAuthorizationError,
} from '@/domain/auth/errors';
import {
  parseScopeList,
  sanitizeNextPath,
  type AuthSession,
} from '@/domain/auth/models';
import { createAuthUseCases } from '@/application/auth/use-cases';
import { createDevErpAuthAdapter } from '@/infrastructure/erp-auth/dev-erp-auth-adapter';
import { isDevErpAuthEnabled } from '@/infrastructure/erp-auth/dev-auth-config';

import { createPostgresSessionStore } from './postgres-session-store';
import {
  createSessionCookieValue,
  getClearedSessionCookieOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  readSessionIdFromCookie,
} from './session-cookie';

const authUseCases = createAuthUseCases({
  erpAuthAdapter: createDevErpAuthAdapter(),
  sessionStore: createPostgresSessionStore(),
});

function readStringValue(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === 'string' ? value.trim() : '';
}

export async function createSessionFromLoginForm(formData: FormData) {
  const session = await authUseCases.loginWithCredentials({
    employeeId: readStringValue(formData, 'employeeId'),
    displayName: readStringValue(formData, 'displayName') || undefined,
    organizationId: readStringValue(formData, 'organizationId'),
    projectIds: parseScopeList(formData.get('projectIds')),
    areaIds: parseScopeList(formData.get('areaIds')),
    roleCodes: parseScopeList(formData.get('roleCodes')),
  });

  const cookieStore = await cookies();
  cookieStore.set(
    getSessionCookieName(),
    createSessionCookieValue(session.sessionId),
    getSessionCookieOptions(),
  );

  return {
    nextPath: sanitizeNextPath(readStringValue(formData, 'next')),
    session,
  };
}

export async function createSessionFromCallback(searchParams: URLSearchParams) {
  const session = await authUseCases.loginWithCallback(searchParams);
  const cookieStore = await cookies();

  cookieStore.set(
    getSessionCookieName(),
    createSessionCookieValue(session.sessionId),
    getSessionCookieOptions(),
  );

  return {
    nextPath: sanitizeNextPath(searchParams.get('next')),
    session,
  };
}

export async function getRequestSession() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(getSessionCookieName())?.value;
  const sessionId = readSessionIdFromCookie(cookieValue);

  if (!sessionId) {
    return null;
  }

  return await authUseCases.readSession(sessionId);
}

export async function requireRequestSession(loginReturnPath = '/workspace') {
  const session = await getRequestSession();

  if (!session) {
    redirect(`/login?next=${encodeURIComponent(loginReturnPath)}`);
  }

  return session;
}

export async function requireWorkspaceSession(pathname = '/workspace') {
  const session = await requireRequestSession(pathname);

  try {
    authUseCases.assertWorkspaceAccess(session);
    return {
      session,
      accessDeniedMessage: null,
    };
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) {
      return {
        session,
        accessDeniedMessage: error.message,
      };
    }

    throw error;
  }
}

export async function logoutCurrentSession() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(getSessionCookieName())?.value;
  const sessionId = readSessionIdFromCookie(cookieValue);

  if (sessionId) {
    await authUseCases.logout(sessionId);
  }

  cookieStore.set(getSessionCookieName(), '', getClearedSessionCookieOptions());
}

export function mapAuthErrorToMessage(error: unknown) {
  if (error instanceof DevErpAuthDisabledError) {
    return error.message;
  }

  if (error instanceof InvalidErpCredentialsError) {
    return error.message;
  }

  return '登录流程出现异常，请稍后重试或联系管理员。';
}

export type WorkspaceSessionState = {
  session: AuthSession;
  accessDeniedMessage: string | null;
};

export function getDevAuthPageState() {
  return {
    devErpAuthEnabled: isDevErpAuthEnabled(),
    disabledMessage:
      '当前环境未开放开发联调登录入口，请改用真实 ERP 登录流程或显式开启开发认证开关。',
  };
}
