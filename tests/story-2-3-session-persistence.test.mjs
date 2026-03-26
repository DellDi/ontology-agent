import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// 1. 契约测试：Postgres session store 文件存在且结构正确
// ---------------------------------------------------------------------------

test('Story 2.3 工件存在：postgres-session-store.ts', async () => {
  await access(
    path.join(repoRoot, 'src/infrastructure/session/postgres-session-store.ts'),
  );
});

test('postgres-session-store 实现 SessionStore 接口（createSession / getSession / deleteSession）', async () => {
  const storeSource = await readRepoFile(
    'src/infrastructure/session/postgres-session-store.ts',
  );

  assert.match(storeSource, /createPostgresSessionStore/);
  assert.match(storeSource, /createSession/);
  assert.match(storeSource, /getSession/);
  assert.match(storeSource, /deleteSession/);
  assert.match(storeSource, /SessionStore/);
});

test('postgres-session-store 复用 platform.auth_sessions 表，不新建平行 schema', async () => {
  const storeSource = await readRepoFile(
    'src/infrastructure/session/postgres-session-store.ts',
  );

  assert.match(storeSource, /authSessions/);
  assert.match(
    storeSource,
    /from ['"]@\/infrastructure\/postgres/,
    '应复用 infrastructure/postgres 下的 schema 与 client',
  );
  assert.doesNotMatch(
    storeSource,
    /pgSchema\(/,
    '不应在 session store 中重新定义 pgSchema',
  );
});

test('postgres-session-store 保留过期时间、用户作用域与角色字段映射', async () => {
  const storeSource = await readRepoFile(
    'src/infrastructure/session/postgres-session-store.ts',
  );

  for (const field of [
    'sessionId',
    'userId',
    'displayName',
    'organizationId',
    'projectIds',
    'areaIds',
    'roleCodes',
    'expiresAt',
  ]) {
    assert.match(
      storeSource,
      new RegExp(field),
      `应映射领域模型字段 ${field}`,
    );
  }
});

test('postgres-session-store 在 getSession 中检查过期时间', async () => {
  const storeSource = await readRepoFile(
    'src/infrastructure/session/postgres-session-store.ts',
  );

  assert.match(
    storeSource,
    /gt\(.*expiresAt/s,
    'getSession 应使用 gt 比较 expiresAt 过滤过期会话',
  );
});

// ---------------------------------------------------------------------------
// 2. 契约测试：server-auth.ts 已切换到 Postgres session store
// ---------------------------------------------------------------------------

test('server-auth.ts 使用 createPostgresSessionStore 而非 createMemorySessionStore', async () => {
  const serverAuth = await readRepoFile(
    'src/infrastructure/session/server-auth.ts',
  );

  assert.match(serverAuth, /createPostgresSessionStore/);
  assert.doesNotMatch(
    serverAuth,
    /createMemorySessionStore/,
    '不应再导入或使用内存 session store',
  );
});

test('server-auth.ts cookie 契约不变：仍使用 HMAC 签名的最小会话标识', async () => {
  const serverAuth = await readRepoFile(
    'src/infrastructure/session/server-auth.ts',
  );

  assert.match(serverAuth, /createSessionCookieValue/);
  assert.match(serverAuth, /readSessionIdFromCookie/);
  assert.match(serverAuth, /getSessionCookieName/);
});

test('server-auth.ts 注销时同时清除 cookie 与调用 deleteSession', async () => {
  const serverAuth = await readRepoFile(
    'src/infrastructure/session/server-auth.ts',
  );

  assert.match(serverAuth, /logoutCurrentSession/);
  assert.match(serverAuth, /authUseCases\.logout/);
  assert.match(serverAuth, /getClearedSessionCookieOptions/);
});

test('server-auth.ts requireRequestSession / requireWorkspaceSession 仍从服务端读取会话', async () => {
  const serverAuth = await readRepoFile(
    'src/infrastructure/session/server-auth.ts',
  );

  assert.match(serverAuth, /requireRequestSession/);
  assert.match(serverAuth, /requireWorkspaceSession/);
  assert.match(serverAuth, /authUseCases\.readSession/);
});

// ---------------------------------------------------------------------------
// 3. 契约测试：memory-session-store.ts 仍保留（未删除），但不再被 server-auth 引用
// ---------------------------------------------------------------------------

test('memory-session-store.ts 保留存在但 server-auth 不再引用', async () => {
  await access(
    path.join(repoRoot, 'src/infrastructure/session/memory-session-store.ts'),
  );

  const serverAuth = await readRepoFile(
    'src/infrastructure/session/server-auth.ts',
  );
  assert.doesNotMatch(serverAuth, /memory-session-store/);
});

// ---------------------------------------------------------------------------
// 4. 契约测试：SessionStore port 接口未被修改
// ---------------------------------------------------------------------------

test('SessionStore port 接口保持稳定', async () => {
  const ports = await readRepoFile('src/application/auth/ports.ts');

  assert.match(ports, /interface SessionStore/);
  assert.match(ports, /createSession\(identity: AuthIdentity\): Promise<AuthSession>/);
  assert.match(ports, /getSession\(sessionId: string\): Promise<AuthSession \| null>/);
  assert.match(ports, /deleteSession\(sessionId: string\): Promise<void>/);
});

// ---------------------------------------------------------------------------
// 5. 契约测试：路由处理器未改变（不把认证逻辑下沉到客户端）
// ---------------------------------------------------------------------------

test('auth 路由处理器未引入客户端状态依赖', async () => {
  const callback = await readRepoFile('src/app/api/auth/callback/route.ts');
  const login = await readRepoFile('src/app/api/auth/login/route.ts');
  const logout = await readRepoFile('src/app/api/auth/logout/route.ts');

  for (const source of [callback, login, logout]) {
    assert.doesNotMatch(
      source,
      /localStorage|sessionStorage|indexedDB/i,
      '路由处理器不应引用浏览器客户端存储',
    );
  }
});
