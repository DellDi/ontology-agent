import {
  hasWorkspaceAccess,
  type AuthSession,
  type DirectoryLoginInput,
  type ErpLoginInput,
} from '@/domain/auth/models';
import { WorkspaceAuthorizationError } from '@/domain/auth/errors';

import type {
  DirectoryAuthAdapter,
  ErpAuthAdapter,
  SessionStore,
  UrlBridgeAuthAdapter,
} from './ports';

type AuthUseCasesDependencies = {
  erpAuthAdapter: ErpAuthAdapter;
  sessionStore: SessionStore;
  directoryAuthAdapter?: DirectoryAuthAdapter;
  urlBridgeAuthAdapter?: UrlBridgeAuthAdapter;
};

export function createAuthUseCases({
  erpAuthAdapter,
  sessionStore,
  directoryAuthAdapter,
  urlBridgeAuthAdapter,
}: AuthUseCasesDependencies) {
  return {
    async loginWithCredentials(input: ErpLoginInput) {
      const identity = await erpAuthAdapter.authenticate(input);
      return await sessionStore.createSession(identity);
    },

    async loginWithDirectory(input: DirectoryLoginInput) {
      if (!directoryAuthAdapter) {
        throw new Error('目录登录适配器未配置。');
      }

      const identity = await directoryAuthAdapter.authenticateWithDirectory(input);
      return await sessionStore.createSession(identity);
    },

    async loginWithUrlBridge(account: string) {
      if (!urlBridgeAuthAdapter) {
        throw new Error('URL 桥接适配器未配置。');
      }

      const identity = await urlBridgeAuthAdapter.resolveAccountIdentity(account);
      return await sessionStore.createSession(identity);
    },

    async loginWithCallback(searchParams: URLSearchParams) {
      const identity = await erpAuthAdapter.exchangeCallback(searchParams);
      return await sessionStore.createSession(identity);
    },

    async readSession(sessionId: string) {
      return await sessionStore.getSession(sessionId);
    },

    async logout(sessionId: string) {
      await sessionStore.deleteSession(sessionId);
    },

    assertWorkspaceAccess(session: AuthSession) {
      if (!hasWorkspaceAccess(session)) {
        throw new WorkspaceAuthorizationError();
      }

      return session;
    },
  };
}
