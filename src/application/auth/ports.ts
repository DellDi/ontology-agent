import type {
  AuthIdentity,
  AuthSession,
  DirectoryLoginInput,
  ErpLoginInput,
} from '@/domain/auth/models';

export interface ErpAuthAdapter {
  authenticate(input: ErpLoginInput): Promise<AuthIdentity>;
  exchangeCallback(searchParams: URLSearchParams): Promise<AuthIdentity>;
}

export interface DirectoryAuthAdapter {
  authenticateWithDirectory(input: DirectoryLoginInput): Promise<AuthIdentity>;
}

export interface UrlBridgeAuthAdapter {
  resolveAccountIdentity(account: string): Promise<AuthIdentity>;
}

export interface SessionStore {
  createSession(identity: AuthIdentity): Promise<AuthSession>;
  getSession(sessionId: string): Promise<AuthSession | null>;
  deleteSession(sessionId: string): Promise<void>;
}
