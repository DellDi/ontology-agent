import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 3101;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess;

function getCookieHeader(setCookieHeader) {
  return setCookieHeader.split(';', 1)[0];
}

async function waitForServerReady(processHandle) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Next dev server did not become ready in time.'));
      }
    }, 30_000);

    function finalize(error) {
      clearTimeout(timeout);
      processHandle.stdout?.off('data', onData);
      processHandle.stderr?.off('data', onData);
      processHandle.off('exit', onExit);

      if (settled) {
        return;
      }

      settled = true;

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    function onData(chunk) {
      const output = chunk.toString();

      if (output.includes('Ready in')) {
        finalize();
      }
    }

    function onExit(code) {
      finalize(new Error(`Next dev server exited early with code ${code ?? 'unknown'}.`));
    }

    processHandle.stdout?.on('data', onData);
    processHandle.stderr?.on('data', onData);
    processHandle.on('exit', onExit);
  });
}

test.before(async () => {
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: 'story-1-2-test-secret',
      ENABLE_DEV_ERP_AUTH: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServerReady(serverProcess);
});

test.after(async () => {
  if (!serverProcess) {
    return;
  }

  serverProcess.kill('SIGINT');
  await once(serverProcess, 'exit');
});

test('未登录访问受保护工作台会跳转到登录页', async () => {
  const response = await fetch(`${BASE_URL}/workspace`, {
    redirect: 'manual',
  });

  assert.equal(response.status, 307);
  assert.match(
    response.headers.get('location') ?? '',
    /\/login\?next=%2Fworkspace/,
  );
});

test('登录成功后创建会话并可访问受保护工作台', async () => {
  const formData = new FormData();
  formData.set('employeeId', 'u-1001');
  formData.set('displayName', '王分析');
  formData.set('organizationId', 'org-hz-001');
  formData.set('projectIds', 'project-a,project-b');
  formData.set('areaIds', 'area-east');
  formData.set('roleCodes', 'PROPERTY_ANALYST');
  formData.set('next', '/workspace');

  const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });

  assert.equal(loginResponse.status, 303);
  assert.match(
    loginResponse.headers.get('location') ?? '',
    /\/workspace$/,
  );

  const cookie = getCookieHeader(loginResponse.headers.get('set-cookie') ?? '');
  assert.match(cookie, /^dip3_session=/);

  const workspaceResponse = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(workspaceResponse.status, 200);

  const html = await workspaceResponse.text();
  assert.match(html, /王分析/);
  assert.match(html, /org-hz-001/);
  assert.match(html, /project-a/);
});

test('退出登录后旧会话 cookie 会失效', async () => {
  const formData = new FormData();
  formData.set('employeeId', 'u-2002');
  formData.set('displayName', '赵运营');
  formData.set('organizationId', 'org-sh-009');
  formData.set('projectIds', 'project-z');
  formData.set('areaIds', 'area-north');
  formData.set('roleCodes', 'PROPERTY_MANAGER');

  const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });

  const cookie = getCookieHeader(loginResponse.headers.get('set-cookie') ?? '');

  const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    redirect: 'manual',
  });

  assert.equal(logoutResponse.status, 303);
  assert.match(
    logoutResponse.headers.get('location') ?? '',
    /\/login\?loggedOut=1$/,
  );
  assert.match(logoutResponse.headers.get('set-cookie') ?? '', /Max-Age=0/);

  const workspaceResponse = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: cookie,
    },
    redirect: 'manual',
  });

  assert.equal(workspaceResponse.status, 307);
  assert.match(
    workspaceResponse.headers.get('location') ?? '',
    /\/login\?next=%2Fworkspace/,
  );
});

test('登录成功后只允许跳转到工作台白名单路径', async () => {
  const formData = new FormData();
  formData.set('employeeId', 'u-3001');
  formData.set('displayName', '白名单测试');
  formData.set('organizationId', 'org-hz-002');
  formData.set('projectIds', 'project-safe');
  formData.set('areaIds', 'area-safe');
  formData.set('roleCodes', 'PROPERTY_ANALYST');
  formData.set('next', '/api/auth/logout');

  const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });

  assert.equal(loginResponse.status, 303);
  assert.match(
    loginResponse.headers.get('location') ?? '',
    /\/workspace$/,
  );
});
