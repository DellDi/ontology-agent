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
import {
  createErpDirectoryAuthAdapter,
  getErpApiBaseUrl,
  isUrlBridgeEnabled,
} from '@/infrastructure/erp-auth/erp-directory-auth-adapter';

import { createPostgresSessionStore } from './postgres-session-store';
import {
  createSessionCookieValue,
  getClearedSessionCookieOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  readSessionIdFromCookie,
} from './session-cookie';

function createDirectoryAdapter() {
  try {
    const baseUrl = getErpApiBaseUrl();
    return createErpDirectoryAuthAdapter({ erpApiBaseUrl: baseUrl });
  } catch {
    return undefined;
  }
}

const directoryAdapter = createDirectoryAdapter();

const authUseCases = createAuthUseCases({
  erpAuthAdapter: createDevErpAuthAdapter(),
  sessionStore: createPostgresSessionStore(),
  directoryAuthAdapter: directoryAdapter,
  urlBridgeAuthAdapter: directoryAdapter,
});

function readStringValue(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === 'string' ? value.trim() : '';
}

export async function createSessionFromLoginForm(formData: FormData) {
  if (!isDevErpAuthEnabled()) {
    throw new DevErpAuthDisabledError(
      '手填 scope 登录入口已关闭，请使用目录账号密码登录。',
    );
  }

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

export async function getWorkspaceSessionState() {
  const session = await getRequestSession();

  if (!session) {
    return null;
  }

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

export async function requireWorkspaceSession(pathname = '/workspace') {
  const workspaceSessionState = await getWorkspaceSessionState();

  if (!workspaceSessionState) {
    redirect(`/login?next=${encodeURIComponent(pathname)}`);
  }

  return workspaceSessionState;
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

export function isDirectoryAuthAvailable(): boolean {
  return directoryAdapter !== undefined;
}

export function isUrlBridgeAvailable(): boolean {
  return isUrlBridgeEnabled() && directoryAdapter !== undefined;
}

export async function createSessionFromDirectoryLogin(formData: FormData) {
  const account = readStringValue(formData, 'account');
  const password = readStringValue(formData, 'password');

  const session = await authUseCases.loginWithDirectory({ account, password });

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

export async function createSessionFromUrlBridge(account: string, next?: string | null) {
  if (!isUrlBridgeAvailable()) {
    throw new Error('URL 桥接入口当前未启用。');
  }

  const session = await authUseCases.loginWithUrlBridge(account);

  const cookieStore = await cookies();
  cookieStore.set(
    getSessionCookieName(),
    createSessionCookieValue(session.sessionId),
    getSessionCookieOptions(),
  );

  return {
    nextPath: sanitizeNextPath(next),
    session,
  };
}

export function mapDirectoryAuthErrorToMessage(error: unknown) {
  if (error instanceof InvalidErpCredentialsError) {
    return error.message;
  }

  return '登录失败，请稍后重试或联系管理员。';
}
