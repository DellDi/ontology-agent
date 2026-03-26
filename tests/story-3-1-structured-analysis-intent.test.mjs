import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 3131;
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
  formData.set('employeeId', 'intent-tester');
  formData.set('displayName', '意图测试员');
  formData.set('organizationId', 'org-test');
  formData.set('projectIds', 'project-test');
  formData.set('areaIds', 'area-test');
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

async function createSessionAndGetPage(cookie, questionText) {
  const formData = new FormData();
  formData.set('question', questionText);

  const startTime = Date.now();

  const response = await fetch(`${BASE_URL}/api/analysis/sessions`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  const sessionUrl = response.headers.get('location');
  assert.match(sessionUrl ?? '', /\/workspace\/analysis\/[a-z0-9-]+$/);

  const sessionPage = await fetch(sessionUrl, {
    headers: { Cookie: cookie },
  });

  const elapsed = Date.now() - startTime;

  assert.equal(sessionPage.status, 200);
  const html = await sessionPage.text();

  return { html, elapsed, sessionUrl };
}

test.before(async () => {
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: 'story-3-1-test-secret',
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

test('收费类问题生成收费分析意图，包含分析类型和核心目标', async () => {
  const cookie = await login();
  const { html } = await createSessionAndGetPage(
    cookie,
    '为什么本月项目 moon 的收费回款率下降了？',
  );

  assert.match(html, /意图识别结果/);
  assert.match(html, /收费分析/);
  assert.match(html, /分析类型/);
  assert.match(html, /核心目标/);
  assert.match(html, /收费/);
});

test('投诉类问题生成投诉分析意图', async () => {
  const cookie = await login();
  const { html } = await createSessionAndGetPage(
    cookie,
    '近三个月投诉量为什么突然上升了？',
  );

  assert.match(html, /意图识别结果/);
  assert.match(html, /投诉分析/);
  assert.match(html, /核心目标/);
});

test('工单类问题生成工单分析意图', async () => {
  const cookie = await login();
  const { html } = await createSessionAndGetPage(
    cookie,
    '本季度维修工单的完工率是多少？',
  );

  assert.match(html, /意图识别结果/);
  assert.match(html, /工单分析/);
});

test('满意度类问题生成满意度分析意图', async () => {
  const cookie = await login();
  const { html } = await createSessionAndGetPage(
    cookie,
    '业主满意度评分和去年相比有什么变化？',
  );

  assert.match(html, /意图识别结果/);
  assert.match(html, /满意度分析/);
});

test('通用问题生成综合分析意图', async () => {
  const cookie = await login();
  const { html } = await createSessionAndGetPage(
    cookie,
    '项目整体运营情况如何？',
  );

  assert.match(html, /意图识别结果/);
  assert.match(html, /综合分析/);
});

test('首个反馈在 5 秒内可见（AC3 时效要求）', async () => {
  const cookie = await login();
  const { elapsed } = await createSessionAndGetPage(
    cookie,
    '最近三个月收费回款率趋势如何？',
  );

  assert.ok(
    elapsed < 5000,
    `首个反馈耗时 ${elapsed}ms，超过 5 秒时效要求`,
  );
});

test('意图结果与会话关联，owner 绑定不丢失', async () => {
  const cookie = await login();
  const { html } = await createSessionAndGetPage(
    cookie,
    '为什么本月投诉量急剧上升？',
  );

  assert.match(html, /为什么本月投诉量急剧上升/);
  assert.match(html, /意图识别结果/);
  assert.match(html, /投诉分析/);
  assert.match(html, /会话 ID/);
  assert.match(html, /[a-f0-9-]{36}/);
});
