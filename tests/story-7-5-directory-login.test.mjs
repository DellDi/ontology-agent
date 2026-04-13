import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import net from 'node:net';

import { ensureNextBuildReady } from './helpers/ensure-next-build-ready.mjs';

const execFileAsync = promisify(execFile);

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const TEST_REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? 'dip3';
const TEST_SESSION_SECRET = 'story-7-5-test-secret';
const TEST_ERP_API_BASE_URL = process.env.ERP_API_BASE_URL ?? '';

const TEST_USER_ACCOUNT = process.env.TEST_ERP_ACCOUNT ?? '';
const TEST_USER_PASSWORD = process.env.TEST_ERP_PASSWORD ?? '';

const DIRECTORY_AUTH_AVAILABLE =
  Boolean(TEST_ERP_API_BASE_URL) &&
  Boolean(TEST_USER_ACCOUNT) &&
  Boolean(TEST_USER_PASSWORD);

let port;
let baseUrl;
let serverProcess;

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('无法获取可用端口。')));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });

    server.on('error', reject);
  });
}

async function waitForServerReady(processHandle) {
  const start = Date.now();

  while (Date.now() - start < 30_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Next server exited early with code ${processHandle.exitCode}.`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/`, { redirect: 'manual' });

      if (response.status > 0) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw new Error('Next server did not become ready in time.');
}

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        REDIS_URL: TEST_REDIS_URL,
        REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
        SESSION_SECRET: TEST_SESSION_SECRET,
        ERP_API_BASE_URL: TEST_ERP_API_BASE_URL,
        ENABLE_URL_BRIDGE: '1',
      },
    },
  );

  return JSON.parse(stdout.trim());
}

async function loginWithDirectory({ account, password }) {
  const formData = new FormData();
  formData.set('account', account);
  formData.set('password', password);

  return await fetch(`${baseUrl}/api/auth/directory-login`, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
    headers: {},
  });
}

async function loginWithUrlBridge(account) {
  return await fetch(
    `${baseUrl}/api/auth/bridge?account=${encodeURIComponent(account)}&next=/workspace`,
    {
      redirect: 'manual',
    },
  );
}

test.before(async () => {
  if (!DIRECTORY_AUTH_AVAILABLE) {
    return;
  }

  port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;

  await execFileAsync('pnpm', ['db:migrate'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  await ensureNextBuildReady({
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
      ERP_API_BASE_URL: TEST_ERP_API_BASE_URL,
      ENABLE_URL_BRIDGE: '1',
    },
  });

  serverProcess = spawn(
    'pnpm',
    ['exec', 'next', 'start', '--port', String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SESSION_SECRET: TEST_SESSION_SECRET,
        DATABASE_URL: TEST_DATABASE_URL,
        REDIS_URL: TEST_REDIS_URL,
        REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
        ERP_API_BASE_URL: TEST_ERP_API_BASE_URL,
        ENABLE_URL_BRIDGE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  await waitForServerReady(serverProcess);
});

test.after(async () => {
  if (serverProcess) {
    serverProcess.kill('SIGINT');
    await once(serverProcess, 'exit');
  }
});

test('Story 7.5 账号密码登录成功并跳转工作台', async (t) => {
  if (!DIRECTORY_AUTH_AVAILABLE) {
    t.skip('需要 ERP_API_BASE_URL / TEST_ERP_ACCOUNT / TEST_ERP_PASSWORD 环境变量才能运行此测试。');
    return;
  }

  const response = await loginWithDirectory({
    account: TEST_USER_ACCOUNT,
    password: TEST_USER_PASSWORD,
  });

  assert.equal(response.status, 303, '登录成功应重定向');

  const location = response.headers.get('location') ?? '';
  assert.ok(
    location.includes('/workspace'),
    `重定向目标应包含 /workspace，实际: ${location}`,
  );

  const setCookie = response.headers.get('set-cookie') ?? '';
  assert.ok(setCookie.includes('dip3_session'), '应设置会话 cookie');
});

test('Story 7.5 密码错误登录失败并跳回登录页', async (t) => {
  if (!DIRECTORY_AUTH_AVAILABLE) {
    t.skip('需要 ERP_API_BASE_URL / TEST_ERP_ACCOUNT / TEST_ERP_PASSWORD 环境变量。');
    return;
  }

  const response = await loginWithDirectory({
    account: TEST_USER_ACCOUNT,
    password: 'wrong-password-that-will-never-match-#!$',
  });

  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.ok(location.includes('/login'), `密码错误应回到登录页，实际: ${location}`);
  assert.ok(
    location.includes('error='),
    `跳回登录页应带 error 参数，实际: ${location}`,
  );
});

test('Story 7.5 账号不存在登录失败并跳回登录页', async (t) => {
  if (!DIRECTORY_AUTH_AVAILABLE) {
    t.skip('需要 ERP_API_BASE_URL / TEST_ERP_ACCOUNT / TEST_ERP_PASSWORD 环境变量。');
    return;
  }

  const response = await loginWithDirectory({
    account: 'account-that-does-not-exist-7x5z',
    password: 'anypassword',
  });

  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.ok(location.includes('/login'), `账号不存在应回到登录页，实际: ${location}`);
  assert.ok(location.includes('error='), '应带 error 参数');
});

test('Story 7.5 用户停用登录失败', async (t) => {
  if (!DIRECTORY_AUTH_AVAILABLE) {
    t.skip('需要 ERP_API_BASE_URL / TEST_ERP_ACCOUNT / TEST_ERP_PASSWORD 环境变量。');
    return;
  }

  await runTsSnippet(`
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(
        "UPDATE erp_staging.dw_datacenter_system_user SET is_actived = '0' WHERE user_account = $1",
        [${JSON.stringify(TEST_USER_ACCOUNT)}]
      );
      console.log(JSON.stringify({ ok: true }));
    } finally { await pool.end(); }
  `);

  try {
    const response = await loginWithDirectory({
      account: TEST_USER_ACCOUNT,
      password: TEST_USER_PASSWORD,
    });

    assert.equal(response.status, 303);
    const location = response.headers.get('location') ?? '';
    assert.ok(location.includes('/login'), '停用账号应回到登录页');
    assert.ok(location.includes('error='), '应带 error 参数');
  } finally {
    await runTsSnippet(`
      import pg from 'pg';
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await pool.query(
          "UPDATE erp_staging.dw_datacenter_system_user SET is_actived = '1' WHERE user_account = $1",
          [${JSON.stringify(TEST_USER_ACCOUNT)}]
        );
        console.log(JSON.stringify({ ok: true }));
      } finally { await pool.end(); }
    `);
  }
});

test('Story 7.5 URL 桥接可直接按 account 进入工作台', async (t) => {
  if (!DIRECTORY_AUTH_AVAILABLE) {
    t.skip('需要 ERP_API_BASE_URL / TEST_ERP_ACCOUNT / TEST_ERP_PASSWORD 环境变量。');
    return;
  }

  const response = await loginWithUrlBridge(TEST_USER_ACCOUNT);

  assert.equal(response.status, 303, 'URL 桥接应重定向');
  const location = response.headers.get('location') ?? '';
  assert.ok(
    location.includes('/workspace'),
    `URL 桥接应跳转工作台，实际: ${location}`,
  );

  const setCookie = response.headers.get('set-cookie') ?? '';
  assert.ok(setCookie.includes('dip3_session'), '应设置会话 cookie');
});

test('Story 7.5 URL 桥接缺少 account 参数返回登录页错误', async (t) => {
  if (!DIRECTORY_AUTH_AVAILABLE) {
    t.skip('需要 ERP_API_BASE_URL / TEST_ERP_ACCOUNT / TEST_ERP_PASSWORD 环境变量。');
    return;
  }

  const response = await fetch(`${baseUrl}/api/auth/bridge`, {
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.ok(location.includes('/login'), '缺少 account 应跳回登录页');
  assert.ok(location.includes('error='), '应带 error 参数');
});

test('Story 7.5 直接登录与 URL 桥接得到的 scope 来源一致（不含 areaId）', async (t) => {
  if (!DIRECTORY_AUTH_AVAILABLE) {
    t.skip('需要 ERP_API_BASE_URL / TEST_ERP_ACCOUNT / TEST_ERP_PASSWORD 环境变量。');
    return;
  }

  // 直接登录获取 scope
  const directResponse = await loginWithDirectory({
    account: TEST_USER_ACCOUNT,
    password: TEST_USER_PASSWORD,
  });
  assert.equal(directResponse.status, 303, '直接登录应成功');
  const directCookie = directResponse.headers.get('set-cookie') ?? '';
  assert.ok(directCookie, '直接登录应设置 cookie');

  const directMeResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: directCookie.split(';')[0] },
  });
  assert.equal(directMeResponse.status, 200, '/api/auth/me 应返回 200');
  const directMe = await directMeResponse.json();

  assert.ok(
    Array.isArray(directMe.scope?.areaIds) && directMe.scope.areaIds.length === 0,
    'scope.areaIds 应为空数组，不再作为权限链路',
  );
  assert.ok(
    Array.isArray(directMe.scope?.projectIds) &&
      directMe.scope.projectIds.length > 0,
    '目录登录成功后必须自动解析出非空 projectIds',
  );
  assert.ok(
    typeof directMe.scope?.organizationId === 'string' && directMe.scope.organizationId,
    'scope.organizationId 应来自目录',
  );

  // URL 桥接获取 scope
  const bridgeResponse = await loginWithUrlBridge(TEST_USER_ACCOUNT);
  assert.equal(bridgeResponse.status, 303, 'URL 桥接应成功');
  const bridgeCookie = bridgeResponse.headers.get('set-cookie') ?? '';
  assert.ok(bridgeCookie, 'URL 桥接应设置 cookie');

  const bridgeMeResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: bridgeCookie.split(';')[0] },
  });
  assert.equal(bridgeMeResponse.status, 200, 'URL 桥接 /api/auth/me 应返回 200');
  const bridgeMe = await bridgeMeResponse.json();

  // 直接登录与 URL 桥接 scope 应完全一致
  assert.deepEqual(
    directMe.scope,
    bridgeMe.scope,
    '直接登录与 URL 桥接的 scope 应完全一致',
  );

  assert.ok(
    Array.isArray(bridgeMe.scope?.areaIds) && bridgeMe.scope.areaIds.length === 0,
    'URL 桥接 scope.areaIds 应为空数组',
  );
  assert.ok(
    Array.isArray(bridgeMe.scope?.projectIds) &&
      bridgeMe.scope.projectIds.length > 0,
    'URL 桥接成功后也必须自动解析出非空 projectIds',
  );
});
