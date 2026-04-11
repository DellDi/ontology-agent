import { InvalidErpCredentialsError } from '@/domain/auth/errors';
import type { AuthIdentity, DirectoryLoginInput } from '@/domain/auth/models';
import type {
  DirectoryAuthAdapter,
  UrlBridgeAuthAdapter,
} from '@/application/auth/ports';
import type { PostgresDb } from '@/infrastructure/postgres/client';

import {
  assertEncryptResult,
  encryptPasswordViaErp,
} from './erp-password-encrypt';
import { createErpScopeResolver } from './erp-scope-resolver';

type ErpDirectoryAdapterConfig = {
  erpApiBaseUrl: string;
  db?: PostgresDb;
};

export function createErpDirectoryAuthAdapter({
  erpApiBaseUrl,
  db,
}: ErpDirectoryAdapterConfig): DirectoryAuthAdapter & UrlBridgeAuthAdapter {
  const scopeResolver = createErpScopeResolver(db);

  async function resolveIdentityByAccount(account: string): Promise<AuthIdentity> {
    const trimmedAccount = account.trim();

    if (!trimmedAccount) {
      throw new InvalidErpCredentialsError('账号不能为空。');
    }

    const users = await scopeResolver.findUserByAccount(trimmedAccount);

    if (users.length === 0) {
      throw new InvalidErpCredentialsError('账号不存在，请检查后重试。');
    }

    if (users.length > 1) {
      throw new InvalidErpCredentialsError('账号命中多条记录，请联系管理员处理。');
    }

    const user = users[0];

    if (user.isDeleted === 1 || user.isActived === '0' || user.isActived === 'false') {
      throw new InvalidErpCredentialsError('该账号已停用，请联系管理员。');
    }

    const organizationId = user.organizationId;

    if (!organizationId) {
      throw new InvalidErpCredentialsError('该账号未关联组织，无法登录。');
    }

    const userId = String(user.sourceId);
    const scope = await scopeResolver.resolveUserScope(userId, organizationId);

    return {
      userId,
      displayName: user.displayName?.trim() || user.userAccount || userId,
      scope,
    };
  }

  return {
    async authenticateWithDirectory(input: DirectoryLoginInput): Promise<AuthIdentity> {
      const { account, password } = input;

      const users = await scopeResolver.findUserByAccount(account.trim());

      if (users.length === 0) {
        throw new InvalidErpCredentialsError('账号不存在，请检查后重试。');
      }

      if (users.length > 1) {
        throw new InvalidErpCredentialsError('账号命中多条记录，请联系管理员处理。');
      }

      const user = users[0];

      if (user.isDeleted === 1 || user.isActived === '0' || user.isActived === 'false') {
        throw new InvalidErpCredentialsError('该账号已停用，请联系管理员。');
      }

      const encryptResult = await encryptPasswordViaErp(password, erpApiBaseUrl);
      assertEncryptResult(encryptResult);

      const storedPassword = user.userPassword?.trim() ?? '';

      if (!storedPassword || encryptResult.encryptedValue !== storedPassword) {
        throw new InvalidErpCredentialsError('密码错误，请重试。');
      }

      const organizationId = user.organizationId;

      if (!organizationId) {
        throw new InvalidErpCredentialsError('该账号未关联组织，无法登录。');
      }

      const userId = String(user.sourceId);
      const scope = await scopeResolver.resolveUserScope(userId, organizationId);

      return {
        userId,
        displayName: user.displayName?.trim() || user.userAccount || userId,
        scope,
      };
    },

    async resolveAccountIdentity(account: string): Promise<AuthIdentity> {
      return resolveIdentityByAccount(account);
    },
  };
}

export function getErpApiBaseUrl(): string {
  const url = process.env.ERP_API_BASE_URL;

  if (!url) {
    throw new Error('环境变量 ERP_API_BASE_URL 未配置。');
  }

  return url.replace(/\/$/, '');
}

export function isUrlBridgeEnabled(): boolean {
  return process.env.ENABLE_URL_BRIDGE === '1';
}
