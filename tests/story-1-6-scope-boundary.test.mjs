import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 3105;
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

async function login() {
  const formData = new FormData();
  formData.set('employeeId', 'u-6001');
  formData.set('displayName', '赵分析');
  formData.set('organizationId', 'org-sh-600');
  formData.set('projectIds', 'project-sky');
  formData.set('areaIds', 'area-lake');
  formData.set('roleCodes', 'PROPERTY_ANALYST');
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
      SESSION_SECRET: 'story-1-6-test-secret',
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

test('工作台会明确展示支持范围与不支持范围说明', async () => {
  const cookie = await login();

  const response = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /支持范围/);
  assert.match(html, /收费、工单、投诉、满意度/);
  assert.match(html, /不支持范围/);
  assert.match(html, /客服系统相关能力不在当前版本范围内/);
  assert.match(html, /CRM、营销、呼叫中心/);
});

test('支持范围内的问题仍可继续创建分析会话', async () => {
  const cookie = await login();
  const formData = new FormData();
  formData.set('question', '为什么项目 sky 的工单完成时长变长了？');

  const response = await fetch(`${BASE_URL}/api/analysis/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  assert.match(response.headers.get('location') ?? '', /\/workspace\/analysis\/[a-z0-9-]+$/);
});

test('不支持范围的问题会被阻止并展示明确边界文案', async () => {
  const cookie = await login();
  const formData = new FormData();
  formData.set('question', '帮我分析呼叫中心坐席接通率和营销转化');

  const response = await fetch(`${BASE_URL}/api/analysis/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  assert.match(response.headers.get('location') ?? '', /\/workspace\?error=/);

  const homePage = await fetch(response.headers.get('location'), {
    headers: {
      Cookie: cookie,
    },
  });

  const html = await homePage.text();
  assert.match(html, /当前版本仅支持物业分析场景/);
  assert.match(html, /客服系统、CRM、营销、呼叫中心/);
});
