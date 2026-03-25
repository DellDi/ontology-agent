import {
  hasWorkspaceAccess,
  type AuthSession,
  type ErpLoginInput,
} from '@/domain/auth/models';
import { WorkspaceAuthorizationError } from '@/domain/auth/errors';

import type { ErpAuthAdapter, SessionStore } from './ports';

type AuthUseCasesDependencies = {
  erpAuthAdapter: ErpAuthAdapter;
  sessionStore: SessionStore;
};

export function createAuthUseCases({
  erpAuthAdapter,
  sessionStore,
}: AuthUseCasesDependencies) {
  return {
    async loginWithCredentials(input: ErpLoginInput) {
      const identity = await erpAuthAdapter.authenticate(input);
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
