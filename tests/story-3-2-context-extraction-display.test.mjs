import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 3132;
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
      finalize(
        new Error(`Next dev server exited early with code ${code ?? 'unknown'}.`),
      );
    }

    processHandle.stdout?.on('data', onData);
    processHandle.stderr?.on('data', onData);
    processHandle.on('exit', onExit);
  });
}

async function login({
  employeeId,
  displayName,
}) {
  const formData = new FormData();
  formData.set('employeeId', employeeId);
  formData.set('displayName', displayName);
  formData.set('organizationId', 'org-ctx-test');
  formData.set('projectIds', 'project-moon');
  formData.set('areaIds', 'area-east');
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

async function createSessionAndGetPage({
  cookie,
  questionText,
}) {
  const formData = new FormData();
  formData.set('question', questionText);

  const response = await fetch(`${BASE_URL}/api/analysis/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  const location = response.headers.get('location');
  assert.match(location ?? '', /\/workspace\/analysis\/[a-z0-9-]+$/);

  const pageResponse = await fetch(location, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(pageResponse.status, 200);

  return {
    sessionUrl: location,
    html: await pageResponse.text(),
  };
}

test.before(async () => {
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: 'story-3-2-test-secret',
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

test('会话页展示目标指标、实体、时间范围、比较方式和约束条件', async () => {
  const cookie = await login({
    employeeId: 'ctx-u-1',
    displayName: '上下文测试员1',
  });

  const { html } = await createSessionAndGetPage({
    cookie,
    questionText: '为什么近三个月项目 moon 在区域 east 的收费回款率相比去年同期下降了？',
  });

  assert.match(html, /分析上下文/);
  assert.match(html, /目标指标/);
  assert.match(html, /实体对象/);
  assert.match(html, /时间范围/);
  assert.match(html, /比较方式/);
  assert.match(html, /约束条件/);

  assert.match(html, /收费回款率/);
  assert.match(html, /项目 moon/);
  assert.match(html, /区域 east/);
  assert.match(html, /近三个月/);
  assert.match(html, /相比去年同期/);
});

test('缺失或不确定字段会明确标记为待补充/待确认', async () => {
  const cookie = await login({
    employeeId: 'ctx-u-2',
    displayName: '上下文测试员2',
  });

  const { html } = await createSessionAndGetPage({
    cookie,
    questionText: '项目 moon 的收费表现如何？',
  });

  assert.match(html, /分析上下文/);
  assert.match(html, /待补充/);
  assert.match(html, /待确认/);
});

test('多约束抽取结果与原问题语义一致，不凭空填入业务对象', async () => {
  const cookie = await login({
    employeeId: 'ctx-u-3',
    displayName: '上下文测试员3',
  });

  const { html } = await createSessionAndGetPage({
    cookie,
    questionText: '最近三个月收费率趋势如何？',
  });

  assert.match(html, /最近三个月/);
  assert.doesNotMatch(html, /项目 moon|区域 east/);
});

test('会话上下文读取保持 owner 隔离，其他用户访问返回 404', async () => {
  const ownerCookie = await login({
    employeeId: 'ctx-u-owner',
    displayName: '上下文拥有者',
  });
  const intruderCookie = await login({
    employeeId: 'ctx-u-intruder',
    displayName: '上下文入侵者',
  });

  const { sessionUrl } = await createSessionAndGetPage({
    cookie: ownerCookie,
    questionText: '为什么近三个月项目 moon 的收费率下降了？',
  });

  const foreignResponse = await fetch(sessionUrl, {
    headers: {
      Cookie: intruderCookie,
    },
  });

  assert.equal(foreignResponse.status, 404);
});
