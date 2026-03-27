import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import nextEnv from '@next/env';
import { Pool } from 'pg';

const PORT = 3104;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess;
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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

async function login({
  employeeId,
  displayName,
  organizationId = 'org-sh-100',
  projectIds = 'project-river',
  areaIds = 'area-east',
  roleCodes = 'PROPERTY_ANALYST',
}) {
  const formData = new FormData();
  formData.set('employeeId', employeeId);
  formData.set('displayName', displayName);
  formData.set('organizationId', organizationId);
  formData.set('projectIds', projectIds);
  formData.set('areaIds', areaIds);
  formData.set('roleCodes', roleCodes);
  formData.set('next', '/workspace');

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  return getCookieHeader(response.headers.get('set-cookie') ?? '');
}

async function createSession(cookie, question) {
  const formData = new FormData();
  formData.set('question', question);

  const response = await fetch(`${BASE_URL}/api/analysis/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  const sessionId = location.split('/').at(-1);
  assert.ok(sessionId);
  return sessionId;
}

test.before(async () => {
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: 'story-1-5-test-secret',
      ENABLE_DEV_ERP_AUTH: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServerReady(serverProcess);
});

test.after(async () => {
  if (!serverProcess) {
    await pool.end();
    return;
  }

  serverProcess.kill('SIGINT');
  await once(serverProcess, 'exit');
  await pool.end();
});

test('历史会话按时间倒序展示，且可回看本人会话详情', async () => {
  const cookie = await login({
    employeeId: 'u-5001',
    displayName: '孙分析',
  });

  const olderId = await createSession(cookie, '为什么项目 river 的收费率下降了？');
  await createSession(cookie, '为什么项目 river 的投诉量上升了？');

  const workspaceResponse = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(workspaceResponse.status, 200);
  const html = await workspaceResponse.text();
  assert.match(html, /历史会话/);
  assert.match(html, /为什么项目 river 的收费率下降了/);
  assert.match(html, /为什么项目 river 的投诉量上升了/);
  assert.match(html, /待分析/);
  assert.match(html, /最近更新时间/);

  const newerIndex = html.indexOf('为什么项目 river 的投诉量上升了');
  const olderIndex = html.indexOf('为什么项目 river 的收费率下降了');
  assert.ok(newerIndex >= 0 && olderIndex >= 0 && newerIndex < olderIndex);

  const detailResponse = await fetch(`${BASE_URL}/workspace/analysis/${olderId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(detailResponse.status, 200);
  const detailHtml = await detailResponse.text();
  assert.match(detailHtml, /为什么项目 river 的收费率下降了/);
  assert.match(detailHtml, /待分析/);
});

test('不能看到或回看其他用户的会话', async () => {
  const ownerCookie = await login({
    employeeId: 'u-5002',
    displayName: '钱运营',
  });
  const intruderCookie = await login({
    employeeId: 'u-5003',
    displayName: '吴主管',
  });

  const foreignSessionId = await createSession(
    ownerCookie,
    '为什么项目 river 的工单超时率上升了？',
  );

  const intruderWorkspace = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: intruderCookie,
    },
  });

  const intruderHtml = await intruderWorkspace.text();
  assert.doesNotMatch(intruderHtml, /为什么项目 river 的工单超时率上升了/);

  const foreignDetail = await fetch(
    `${BASE_URL}/workspace/analysis/${foreignSessionId}`,
    {
      headers: {
        Cookie: intruderCookie,
      },
    },
  );

  assert.equal(foreignDetail.status, 404);
});

test('空历史列表会显示明确空状态', async () => {
  const cookie = await login({
    employeeId: 'u-5004',
    displayName: '郑新同学',
  });

  const response = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: cookie,
    },
  });

  const html = await response.text();
  assert.match(html, /还没有历史分析会话/);
  assert.match(html, /从上方的新建分析开始第一条问题/);
});

test('同一 employeeId 在不同组织下不能看到旧组织的历史会话', async () => {
  const orgACookie = await login({
    employeeId: 'shared-employee',
    displayName: '共享工号用户',
    organizationId: 'org-a',
    projectIds: 'project-a',
    areaIds: 'area-a',
  });

  await createSession(orgACookie, '为什么项目 alpha 的收费率下降了？');

  const orgBCookie = await login({
    employeeId: 'shared-employee',
    displayName: '共享工号用户',
    organizationId: 'org-b',
    projectIds: 'project-b',
    areaIds: 'area-b',
  });

  const workspaceResponse = await fetch(`${BASE_URL}/workspace`, {
    headers: {
      Cookie: orgBCookie,
    },
  });

  const html = await workspaceResponse.text();
  assert.doesNotMatch(html, /为什么项目 alpha 的收费率下降了/);
});

test('未登录访问详情页时会保留原深链作为回跳路径', async () => {
  const cookie = await login({
    employeeId: 'u-5005',
    displayName: '深链测试员',
  });

  const sessionId = await createSession(cookie, '为什么项目 river 的收费率下降了？');
  const response = await fetch(`${BASE_URL}/workspace/analysis/${sessionId}`, {
    redirect: 'manual',
  });

  assert.equal(response.status, 307);
  assert.match(
    response.headers.get('location') ?? '',
    new RegExp(`/login\\?next=%2Fworkspace%2Fanalysis%2F${sessionId}$`),
  );
});

test('详情页优先展示已保存的基础上下文快照', async () => {
  const cookie = await login({
    employeeId: 'u-5006',
    displayName: '上下文快照用户',
  });

  const sessionId = await createSession(
    cookie,
    '为什么项目 river 的收费率下降了？',
  );

  const savedContext = {
    targetMetric: {
      label: '目标指标',
      value: '快照收费指标',
      state: 'confirmed',
    },
    entity: {
      label: '实体对象',
      value: '项目 snapshot-river',
      state: 'confirmed',
    },
    timeRange: {
      label: '时间范围',
      value: '快照周期',
      state: 'confirmed',
    },
    comparison: {
      label: '比较方式',
      value: '快照对比基线',
      state: 'confirmed',
    },
    constraints: [],
  };

  await pool.query(
    'update platform.analysis_sessions set saved_context = $1::jsonb where id = $2',
    [JSON.stringify(savedContext), sessionId],
  );

  const detailResponse = await fetch(`${BASE_URL}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(detailResponse.status, 200);
  const html = await detailResponse.text();
  assert.match(html, /快照收费指标/);
  assert.match(html, /项目 snapshot-river/);
  assert.match(html, /快照周期/);
});
