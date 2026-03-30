import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 3103;
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
  formData.set('employeeId', overrides.employeeId ?? 'u-4001');
  formData.set('displayName', overrides.displayName ?? '陈分析');
  formData.set('organizationId', overrides.organizationId ?? 'org-sh-020');
  formData.set('projectIds', overrides.projectIds ?? 'project-moon');
  formData.set('areaIds', overrides.areaIds ?? 'area-river');
  formData.set('roleCodes', overrides.roleCodes ?? 'PROPERTY_ANALYST');
  formData.set('next', overrides.next ?? '/workspace');

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
      SESSION_SECRET: 'story-1-4-test-secret',
      ENABLE_DEV_ERP_AUTH: '1',
      FAIL_ANALYSIS_INTENT_FOR_TEST: '故障注入',
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

test('创建分析会话成功后跳转到会话页并保留原问题', async () => {
  const cookie = await login();
  const formData = new FormData();
  formData.set('question', '为什么本月项目 moon 的收费回款率下降了？');

  const response = await fetch(`${BASE_URL}/api/analysis/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  assert.match(
    response.headers.get('location') ?? '',
    /\/workspace\/analysis\/[a-z0-9-]+$/,
  );

  const sessionPage = await fetch(response.headers.get('location'), {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(sessionPage.status, 200);

  const html = await sessionPage.text();
  assert.match(html, /为什么本月项目 moon 的收费回款率下降了/);
  assert.match(html, /待分析/);
  assert.match(html, /主分析区/);
  assert.match(html, /证据辅助区/);
});

test('空问题会创建失败并回到工作台首页显示错误', async () => {
  const cookie = await login();
  const formData = new FormData();
  formData.set('question', '   ');

  const response = await fetch(`${BASE_URL}/api/analysis/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  assert.match(
    response.headers.get('location') ?? '',
    /\/workspace\?error=/,
  );

  const homePage = await fetch(response.headers.get('location'), {
    headers: {
      Cookie: cookie,
    },
  });

  const html = await homePage.text();
  assert.match(html, /请输入要分析的问题/);
});

test('未登录时无法创建分析会话', async () => {
  const formData = new FormData();
  formData.set('question', '为什么投诉量上升了？');

  const response = await fetch(`${BASE_URL}/api/analysis/sessions`, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  assert.match(
    response.headers.get('location') ?? '',
    /\/login\?next=\/workspace$/,
  );
});

test('明显超出物业分析范围的问题会被拦截', async () => {
  const cookie = await login();
  const formData = new FormData();
  formData.set('question', '请帮我分析客服系统通话质检和 CRM 转化率');

  const response = await fetch(`${BASE_URL}/api/analysis/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);

  const homePage = await fetch(response.headers.get('location'), {
    headers: {
      Cookie: cookie,
    },
  });

  const html = await homePage.text();
  assert.match(html, /当前版本仅支持物业分析场景/);
});

test('无项目和区域范围的账号不能创建分析会话', async () => {
  const cookie = await login({
    employeeId: 'u-4002',
    displayName: '范围受限用户',
    projectIds: '',
    areaIds: '',
  });
  const formData = new FormData();
  formData.set('question', '为什么本月项目 moon 的收费回款率下降了？');

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
  assert.match(html, /还没有可直接发起分析的项目或区域范围/);
});

test('越界领域关键词的空格或全角变体同样会被拦截', async () => {
  const cookie = await login({
    employeeId: 'u-4003',
    displayName: '边界绕过测试',
  });
  const formData = new FormData();
  formData.set('question', '请帮我分析 C R M 转化率和 客 服 系统 质检');

  const response = await fetch(`${BASE_URL}/api/analysis/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);

  const homePage = await fetch(response.headers.get('location'), {
    headers: {
      Cookie: cookie,
    },
  });

  const html = await homePage.text();
  assert.match(html, /当前版本仅支持物业分析场景/);
});

test('意图识别下游失败时不会留下幽灵会话', async () => {
  const cookie = await login({
    employeeId: 'u-4004',
    displayName: '故障注入测试',
  });
  const uniqueQuestion = `故障注入：为什么本月项目 moon 的收费回款率下降了？-${Date.now()}`;
  const formData = new FormData();
  formData.set('question', uniqueQuestion);

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

  const homePage = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: cookie,
    },
  });

  const html = await homePage.text();
  assert.doesNotMatch(html, new RegExp(uniqueQuestion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
