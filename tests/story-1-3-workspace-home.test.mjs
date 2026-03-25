import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 3102;
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
      if (chunk.toString().includes('Ready in')) {
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

async function login(overrides = {}) {
  const formData = new FormData();
  formData.set('employeeId', overrides.employeeId ?? 'u-3003');
  formData.set('displayName', overrides.displayName ?? '李分析');
  formData.set('organizationId', overrides.organizationId ?? 'org-sz-001');
  formData.set('projectIds', overrides.projectIds ?? 'project-alpha');
  formData.set('areaIds', overrides.areaIds ?? 'area-south');
  formData.set('roleCodes', overrides.roleCodes ?? 'PROPERTY_ANALYST');
  formData.set('next', '/workspace');

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  return getCookieHeader(response.headers.get('set-cookie') ?? '');
}

test.before(async () => {
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: 'story-1-3-test-secret',
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

test('已登录用户在工作台首页看到分析入口、最近分析和权限范围提示', async () => {
  const cookie = await login({
    projectIds: 'project-alpha,project-gamma',
    areaIds: 'area-south',
  });

  const response = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /新建分析/);
  assert.match(html, /最近分析/);
  assert.match(html, /当前权限范围/);
  assert.match(html, /当前版本仅支持物业分析/);
  assert.match(html, /project-alpha/);
  assert.match(html, /project-gamma/);
  assert.match(html, /area-south/);
  assert.match(html, /支持范围/);
  assert.match(html, /不支持范围/);
});

test('首页只展示当前会话可访问的项目或区域范围', async () => {
  const cookie = await login({
    employeeId: 'u-3004',
    displayName: '周调度',
    projectIds: 'project-east',
    areaIds: 'area-east',
  });

  const response = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: cookie,
    },
  });

  const html = await response.text();
  assert.match(html, /project-east/);
  assert.match(html, /area-east/);
  assert.doesNotMatch(html, /project-west/);
  assert.doesNotMatch(html, /area-west/);
});

test('无可用项目和区域范围的用户会看到空状态提示', async () => {
  const cookie = await login({
    employeeId: 'u-3005',
    displayName: '许主管',
    projectIds: '',
    areaIds: '',
    roleCodes: 'PROPERTY_MANAGER',
  });

  const response = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /当前会话还没有可直接发起分析的项目或区域范围/);
  assert.match(html, /请联系管理员补充分配项目或区域权限/);
});
