import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { promisify } from 'node:util';

import { ensureNextBuildReady } from './helpers/ensure-next-build-ready.mjs';

const execFileAsync = promisify(execFile);

let port;
let baseUrl;
let serverProcess;
const TEST_SESSION_SECRET = 'story-7-1-test-secret';
const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const TEST_REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? 'dip3';

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
      const response = await fetch(`${baseUrl}/`, {
        redirect: 'manual',
      });

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
      },
    },
  );

  return JSON.parse(stdout.trim());
}

async function login({
  employeeId,
  displayName,
  organizationId,
  projectIds,
  areaIds,
  roleCodes = ['PROPERTY_ANALYST'],
}) {
  const result = await runTsSnippet(`
    import sessionStoreModule from './src/infrastructure/session/postgres-session-store.ts';
    import sessionCookieModule from './src/infrastructure/session/session-cookie.ts';

    const { createPostgresSessionStore } = sessionStoreModule;
    const {
      createSessionCookieValue,
      getSessionCookieName,
    } = sessionCookieModule;

    const sessionStore = createPostgresSessionStore();
    const session = await sessionStore.createSession({
      userId: ${JSON.stringify(employeeId)},
      displayName: ${JSON.stringify(displayName)},
      scope: {
        organizationId: ${JSON.stringify(organizationId)},
        projectIds: ${JSON.stringify(projectIds)},
        areaIds: ${JSON.stringify(areaIds)},
        roleCodes: ${JSON.stringify(roleCodes)},
      },
    });

    console.log(JSON.stringify({
      cookie: \`\${getSessionCookieName()}=\${createSessionCookieValue(session.sessionId)}\`,
    }));
  `);

  return result.cookie;
}

async function createSession(cookie, questionText, extraFields = {}) {
  const formData = new FormData();
  formData.set('question', questionText);

  for (const [key, value] of Object.entries(extraFields)) {
    formData.set(key, String(value));
  }

  const response = await fetch(`${baseUrl}/api/analysis/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace\/analysis\/[a-z0-9-]+$/);
  return location.split('/').pop();
}

test.before(async () => {
  port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;

  await ensureNextBuildReady({
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
      ENABLE_DEV_ERP_AUTH: '1',
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
        ENABLE_DEV_ERP_AUTH: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  await waitForServerReady(serverProcess);
});

test.after(async () => {
  if (!serverProcess) {
    return;
  }

  serverProcess.kill('SIGINT');
  await once(serverProcess, 'exit');
});

test('Story 7.1 统一权限策略会在服务端显式约束 owner 与 scope', async () => {
  const result = await runTsSnippet(`
    import scopePolicyModule from './src/domain/scope-boundary/policy.ts';

    const {
      AnalysisAuthorizationError,
      assertCanAccessAnalysisScope,
      canAccessAnalysisScope,
      getAnalysisAccessDeniedMessage,
    } = scopePolicyModule;

    const resource = {
      ownerUserId: 'u-1',
      organizationId: 'org-a',
      projectIds: ['project-a'],
      areaIds: ['area-a'],
    };

    const allowed = canAccessAnalysisScope(resource, {
      userId: 'u-1',
      scope: {
        organizationId: 'org-a',
        projectIds: ['project-a', 'project-b'],
        areaIds: ['area-a', 'area-b'],
        roleCodes: ['PROPERTY_ANALYST'],
      },
    });

    const legacyAllowed = canAccessAnalysisScope(
      {
        ownerUserId: 'u-1',
        organizationId: '',
        projectIds: [],
        areaIds: [],
      },
      {
        userId: 'u-1',
        scope: {
          organizationId: 'org-a',
          projectIds: ['project-a'],
          areaIds: ['area-a'],
          roleCodes: ['PROPERTY_ANALYST'],
        },
      },
    );

    let deniedMessage = '';
    try {
      assertCanAccessAnalysisScope(resource, {
        userId: 'u-1',
        scope: {
          organizationId: 'org-b',
          projectIds: ['project-x'],
          areaIds: ['area-x'],
          roleCodes: ['PROPERTY_ANALYST'],
        },
      });
    } catch (error) {
      deniedMessage =
        error instanceof AnalysisAuthorizationError
          ? error.message
          : String(error);
    }

    console.log(JSON.stringify({
      allowed,
      legacyAllowed,
      deniedMessage,
      genericMessage: getAnalysisAccessDeniedMessage(),
    }));
  `);

  assert.deepEqual(result, {
    allowed: true,
    legacyAllowed: true,
    deniedMessage: '会话不存在或无权访问。',
    genericMessage: '会话不存在或无权访问。',
  });
});

test('Story 7.1 创建分析时不会信任浏览器伪造的范围字段', async () => {
  const cookie = await login({
    employeeId: 'auth-owner-create',
    displayName: '创建测试',
    organizationId: 'org-create-real',
    projectIds: ['project-real'],
    areaIds: ['area-real'],
  });

  const sessionId = await createSession(cookie, '为什么项目 real 的收费率下降了？', {
    ownerUserId: 'spoof-user',
    organizationId: 'org-fake',
    projectIds: 'project-fake',
    areaIds: 'area-fake',
  });

  const persisted = await runTsSnippet(`
    import storeModule from './src/infrastructure/analysis-session/postgres-analysis-session-store.ts';

    const { createPostgresAnalysisSessionStore } = storeModule;
    const store = createPostgresAnalysisSessionStore();
    const session = await store.getById(${JSON.stringify(sessionId)});

    console.log(JSON.stringify({
      ownerUserId: session?.ownerUserId ?? null,
      organizationId: session?.organizationId ?? null,
      projectIds: session?.projectIds ?? [],
      areaIds: session?.areaIds ?? [],
    }));
  `);

  assert.deepEqual(persisted, {
    ownerUserId: 'auth-owner-create',
    organizationId: 'org-create-real',
    projectIds: ['project-real'],
    areaIds: ['area-real'],
  });
});

test('Story 7.1 同工号切换到其他组织后不能回看、执行或继续追问旧组织会话', async () => {
  const ownerCookie = await login({
    employeeId: 'shared-employee-auth',
    displayName: '共享工号',
    organizationId: 'org-alpha',
    projectIds: ['project-alpha'],
    areaIds: ['area-alpha'],
  });

  const sessionId = await createSession(
    ownerCookie,
    '为什么项目 alpha 的收费回款率下降了？',
  );

  const intruderCookie = await login({
    employeeId: 'shared-employee-auth',
    displayName: '共享工号',
    organizationId: 'org-beta',
    projectIds: ['project-beta'],
    areaIds: ['area-beta'],
  });

  const pageResponse = await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: intruderCookie,
    },
    redirect: 'manual',
  });
  assert.equal(pageResponse.status, 404);

  const contextResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/context`,
    {
      headers: {
        Cookie: intruderCookie,
      },
    },
  );
  assert.equal(contextResponse.status, 404);
  assert.deepEqual(await contextResponse.json(), {
    error: '会话不存在或无权访问。',
  });

  const executeResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/execute`,
    {
      method: 'POST',
      headers: {
        Cookie: intruderCookie,
      },
      redirect: 'manual',
    },
  );
  assert.equal(executeResponse.status, 404);
  assert.deepEqual(await executeResponse.json(), {
    error: '会话不存在或无权访问。',
  });

  const followUpForm = new FormData();
  followUpForm.set('question', '继续说明 project alpha 的变化。');
  const followUpResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups`,
    {
      method: 'POST',
      headers: {
        Cookie: intruderCookie,
      },
      body: followUpForm,
      redirect: 'manual',
    },
  );
  assert.equal(followUpResponse.status, 404);
  assert.deepEqual(await followUpResponse.json(), {
    error: '会话不存在或无权访问。',
  });

  const streamResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/stream?executionId=fake-execution`,
    {
      headers: {
        Cookie: intruderCookie,
      },
    },
  );
  assert.equal(streamResponse.status, 404);
  assert.deepEqual(await streamResponse.json(), {
    error: '会话不存在或无权访问。',
  });
});

test('Story 7.1 同组织但项目范围不再覆盖时，旧会话详情与分析入口都必须拒绝访问', async () => {
  const ownerCookie = await login({
    employeeId: 'same-org-scope-user',
    displayName: '范围切换用户',
    organizationId: 'org-shared',
    projectIds: ['project-a'],
    areaIds: ['area-a'],
  });

  const sessionId = await createSession(
    ownerCookie,
    '为什么项目 alpha 的投诉量上升了？',
  );

  const reducedScopeCookie = await login({
    employeeId: 'same-org-scope-user',
    displayName: '范围切换用户',
    organizationId: 'org-shared',
    projectIds: ['project-b'],
    areaIds: ['area-b'],
  });

  const detailResponse = await fetch(
    `${baseUrl}/workspace/analysis/${sessionId}`,
    {
      headers: {
        Cookie: reducedScopeCookie,
      },
      redirect: 'manual',
    },
  );
  assert.equal(detailResponse.status, 404);

  const contextResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/context`,
    {
      headers: {
        Cookie: reducedScopeCookie,
      },
    },
  );
  assert.equal(contextResponse.status, 404);
  assert.deepEqual(await contextResponse.json(), {
    error: '会话不存在或无权访问。',
  });

  const executeResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/execute`,
    {
      method: 'POST',
      headers: {
        Cookie: reducedScopeCookie,
      },
      redirect: 'manual',
    },
  );
  assert.equal(executeResponse.status, 404);
  assert.deepEqual(await executeResponse.json(), {
    error: '会话不存在或无权访问。',
  });
});

test('Story 7.1 跨用户访问分析上下文时必须返回去敏后的统一拒绝结果', async () => {
  const ownerCookie = await login({
    employeeId: 'cross-user-owner',
    displayName: '所有者',
    organizationId: 'org-cross',
    projectIds: ['project-cross'],
    areaIds: ['area-cross'],
  });

  const intruderCookie = await login({
    employeeId: 'cross-user-intruder',
    displayName: '闯入者',
    organizationId: 'org-cross',
    projectIds: ['project-cross'],
    areaIds: ['area-cross'],
  });

  const sessionId = await createSession(
    ownerCookie,
    '为什么项目 cross 的工单超时率上升了？',
  );

  const contextResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/context`,
    {
      headers: {
        Cookie: intruderCookie,
      },
    },
  );

  assert.equal(contextResponse.status, 404);
  const body = await contextResponse.json();
  assert.deepEqual(body, {
    error: '会话不存在或无权访问。',
  });
  assert.equal(JSON.stringify(body).includes(sessionId), false);
  assert.equal(JSON.stringify(body).includes('cross-user-owner'), false);
});
