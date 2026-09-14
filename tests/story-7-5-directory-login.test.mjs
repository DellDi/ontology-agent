import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stopProcessTree } from './helpers/stop-process-tree.mjs';
import { spawn } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import net from 'node:net';
import netns from 'node:net';

import { ensureNextBuildReady } from './helpers/ensure-next-build-ready.mjs';

const execFileAsync = promisify(execFile);

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';
const parsedDatabaseUrl = new URL(TEST_DATABASE_URL);
const TEST_JAVA_DATABASE_ENV = {
  JAVA_DATABASE_URL: `jdbc:postgresql://${parsedDatabaseUrl.host}${parsedDatabaseUrl.pathname}${parsedDatabaseUrl.search}`,
  JAVA_DATABASE_USERNAME: decodeURIComponent(parsedDatabaseUrl.username),
  JAVA_DATABASE_PASSWORD: decodeURIComponent(parsedDatabaseUrl.password),
};
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const TEST_REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? 'dip3';
const TEST_SESSION_SECRET = 'story-7-5-test-secret';

const TEST_USER_ACCOUNT = 'story-7-5-user';
const TEST_USER_PASSWORD = 'story-7-5-password';
const TEST_USER_ORG = 'story-7-5-org';

const JAVA_BACKEND_PORT = 8080;
const JAVA_BACKEND_URL = `http://127.0.0.1:${JAVA_BACKEND_PORT}`;

let port;
let baseUrl;
let serverProcess;
let backendProcess;
let accountAuthAvailable = false;

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, 600_000, 32, 'sha256');
  return `pbkdf2:${salt.toString('base64')}:${derived.toString('base64')}`;
}

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

async function tcpReachable(portToCheck) {
  return await new Promise((resolve) => {
    const socket = netns.createConnection({ port: portToCheck, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
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

async function waitForBackendReady(processHandle) {
  const start = Date.now();

  while (Date.now() - start < 120_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Java backend exited early with code ${processHandle.exitCode}.`,
      );
    }

    try {
      const response = await fetch(`${JAVA_BACKEND_URL}/api/auth/config`, {
        redirect: 'manual',
      });

      if (response.status > 0) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error('Java backend did not become ready in time.');
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
      },
    },
  );

  return JSON.parse(stdout.trim());
}

async function provisionTestAccount() {
  const hash = hashPassword(TEST_USER_PASSWORD);
  await runTsSnippet(`
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(
        'INSERT INTO identity.accounts ' +
        '(account, password_hash, display_name, organization_id, source, status, roles, failed_attempts) ' +
        "VALUES ($1, $2, 'Story7.5 测试', $3, 'local', 'active', '[]'::jsonb, 0) " +
        'ON CONFLICT (account) DO UPDATE ' +
        'SET password_hash = EXCLUDED.password_hash, ' +
        "status = 'active', failed_attempts = 0, locked_until = NULL",
        [${JSON.stringify(TEST_USER_ACCOUNT)}, ${JSON.stringify(hash)}, ${JSON.stringify(TEST_USER_ORG)}]
      );
      await pool.query(
        'INSERT INTO identity.role_grants (account_id, role_code) ' +
        "SELECT id, 'EASYV_ANALYST' FROM identity.accounts WHERE account = $1 " +
        'ON CONFLICT (account_id, role_code) DO NOTHING',
        [${JSON.stringify(TEST_USER_ACCOUNT)}]
      );
      console.log(JSON.stringify({ ok: true }));
    } finally { await pool.end(); }
  `);
}

async function loginWithAccount({ account, password }) {
  const formData = new FormData();
  formData.set('account', account);
  formData.set('password', password);

  return await fetch(`${baseUrl}/api/auth/login`, {
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

function skipUnlessReady(t) {
  if (!accountAuthAvailable) {
    t.skip('需要本地 DATABASE_URL / REDIS_URL 可达且 mvn 可用才能运行此测试。');
    return true;
  }
  return false;
}

test.before(async () => {
  const databasePort = Number(parsedDatabaseUrl.port || 5432);
  const redisPort = Number(new URL(TEST_REDIS_URL).port || 6379);
  if (!(await tcpReachable(databasePort)) || !(await tcpReachable(redisPort))) {
    return;
  }

  await execFileAsync('mise', [
    'exec',
    'java@temurin-21.0.12+8.0.LTS',
    '--',
    'mvn',
    '-f',
    'backend-java/pom.xml',
    '-q',
    'spring-boot:run',
    '-Dspring-boot.run.profiles=migrate',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ...TEST_JAVA_DATABASE_ENV },
  });

  backendProcess = spawn(
    'mise',
    [
      'exec',
      'java@temurin-21.0.12+8.0.LTS',
      '--',
      'mvn',
      '-f',
      'backend-java/pom.xml',
      '-q',
      'spring-boot:run',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...TEST_JAVA_DATABASE_ENV,
        REDIS_URL: TEST_REDIS_URL,
        REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
        SESSION_SECRET: TEST_SESSION_SECRET,
        ENABLE_URL_BRIDGE: 'true',
        DIP3_PROPERTY_ENABLED: 'false',
        CUBE_API_URL: 'http://127.0.0.1:9/cubejs-api/v1',
        CUBE_API_SECRET: 'story-7-5-cube-secret',
        CUBE_QUERY_TIMEOUT_MS: '1000',
        NEO4J_URI: 'bolt://127.0.0.1:9',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'story-7-5-neo4j',
        LLM_ANALYSIS_PROVIDER: 'openai',
        LLM_ANALYSIS_BASE_URL: 'http://127.0.0.1:9',
        LLM_ANALYSIS_API_KEY: 'story-7-5-llm-key',
        LLM_ANALYSIS_MODEL: 'test-model',
        LLM_SUMMARY_PROVIDER: 'openai',
        LLM_SUMMARY_BASE_URL: 'http://127.0.0.1:9',
        LLM_SUMMARY_API_KEY: 'story-7-5-llm-key',
        LLM_SUMMARY_MODEL: 'test-model',
        LLM_ANALYSIS_TIMEOUT_MS: '1000',
        LLM_SUMMARY_TIMEOUT_MS: '1000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  await waitForBackendReady(backendProcess);
  await provisionTestAccount();

  port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;

  await ensureNextBuildReady({
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: TEST_SESSION_SECRET,
      JAVA_BACKEND_URL,
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
        JAVA_BACKEND_URL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  await waitForServerReady(serverProcess);
  accountAuthAvailable = true;
});

test.after(async () => {
  if (serverProcess) {
    await stopProcessTree(serverProcess);
  }
  if (backendProcess) {
    await stopProcessTree(backendProcess);
  }
});

test('Story 7.5 账号密码登录成功并跳转工作台', async (t) => {
  if (skipUnlessReady(t)) {
    return;
  }

  const response = await loginWithAccount({
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
  if (skipUnlessReady(t)) {
    return;
  }

  const response = await loginWithAccount({
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
  if (skipUnlessReady(t)) {
    return;
  }

  const response = await loginWithAccount({
    account: 'account-that-does-not-exist-7x5z',
    password: 'anypassword',
  });

  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.ok(location.includes('/login'), `账号不存在应回到登录页，实际: ${location}`);
  assert.ok(location.includes('error='), '应带 error 参数');
});

test('Story 7.5 用户停用登录失败', async (t) => {
  if (skipUnlessReady(t)) {
    return;
  }

  await runTsSnippet(`
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(
        "UPDATE identity.accounts SET status = 'disabled' WHERE account = $1",
        [${JSON.stringify(TEST_USER_ACCOUNT)}]
      );
      console.log(JSON.stringify({ ok: true }));
    } finally { await pool.end(); }
  `);

  try {
    const response = await loginWithAccount({
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
          "UPDATE identity.accounts SET status = 'active' WHERE account = $1",
          [${JSON.stringify(TEST_USER_ACCOUNT)}]
        );
        console.log(JSON.stringify({ ok: true }));
      } finally { await pool.end(); }
    `);
  }
});

test('Story 7.5 URL 桥接可直接按已供给 account 进入工作台', async (t) => {
  if (skipUnlessReady(t)) {
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
  if (skipUnlessReady(t)) {
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

test('Story 7.5 直接登录与 URL 桥接得到的 scope 来源一致', async (t) => {
  if (skipUnlessReady(t)) {
    return;
  }

  // 直接登录获取 scope
  const directResponse = await loginWithAccount({
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

  assert.equal(
    directMe.scope?.organizationId,
    TEST_USER_ORG,
    'scope.organizationId 应来自平台身份表',
  );
  assert.ok(
    Array.isArray(directMe.scope?.areaIds) && directMe.scope.areaIds.length === 0,
    'scope.areaIds 应为空数组，不再作为权限链路',
  );
  assert.ok(
    Array.isArray(directMe.scope?.projectIds) &&
      directMe.scope.projectIds.length === 0,
    '平台身份模型下 projectIds 由 domain pack 运行时解析，会话内为空',
  );
  assert.ok(
    directMe.scope?.roles?.includes('EASYV_ANALYST'),
    'scope.roles 应包含授予的 EASYV_ANALYST',
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
});
