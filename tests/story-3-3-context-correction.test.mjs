import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';

let port;
let baseUrl;
let serverProcess;

function getCookieHeader(setCookieHeader) {
  return setCookieHeader.split(';', 1)[0];
}

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Failed to resolve an available test port.'));
        });
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

async function login(employeeId = 'ctx-tester') {
  const formData = new FormData();
  formData.set('employeeId', employeeId);
  formData.set('displayName', '上下文测试员');
  formData.set('organizationId', 'org-test');
  formData.set('projectIds', 'project-test');
  formData.set('areaIds', 'area-test');
  formData.set('roleCodes', 'PROPERTY_ANALYST');
  formData.set('next', '/workspace');

  const response = await fetch(`${baseUrl}/api/auth/login`, {
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
  return location.split('/').pop();
}

test.before(async () => {
  port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: 'story-3-3-test-secret',
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

test('修正上下文后读取到最新版本', async () => {
  const cookie = await login();
  const sessionId = await createSession(
    cookie,
    '为什么本月项目 moon 的收费回款率下降了？',
  );

  const sessionPage = await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(sessionPage.status, 200);
  const sessionHtml = await sessionPage.text();
  assert.match(sessionHtml, /修正上下文/);
  assert.match(sessionHtml, /原始问题文本/);
  assert.match(sessionHtml, /保存上下文修正/);

  const initial = await fetch(`${baseUrl}/api/analysis/sessions/${sessionId}/context`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(initial.status, 200);
  const initialData = await initial.json();
  assert.ok(initialData.context.targetMetric);
  assert.equal(initialData.version, 1);

  const corrected = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/context`,
    {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetMetric: {
          value: '月度收费回款率（不含预缴）',
          note: '用户手动修正指标口径',
        },
      }),
    },
  );

  assert.equal(corrected.status, 200);
  const correctedData = await corrected.json();
  assert.equal(
    correctedData.context.targetMetric.value,
    '月度收费回款率（不含预缴）',
  );
  assert.equal(correctedData.context.targetMetric.state, 'confirmed');
  assert.equal(correctedData.version, 2);

  const latest = await fetch(`${baseUrl}/api/analysis/sessions/${sessionId}/context`, {
    headers: {
      Cookie: cookie,
    },
  });
  const latestData = await latest.json();
  assert.equal(
    latestData.context.targetMetric.value,
    '月度收费回款率（不含预缴）',
  );
  assert.equal(latestData.version, 2);
});

test('撤销修正恢复到上一个确认版本', async () => {
  const cookie = await login();
  const sessionId = await createSession(cookie, '近三个月投诉量为什么突然上升了？');

  await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  await fetch(`${baseUrl}/api/analysis/sessions/${sessionId}/context`, {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeRange: {
        value: '近六个月',
      },
    }),
  });

  const undone = await fetch(`${baseUrl}/api/analysis/sessions/${sessionId}/context`, {
    method: 'DELETE',
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(undone.status, 200);
  const undoneData = await undone.json();
  assert.notEqual(undoneData.context.timeRange.value, '近六个月');
  assert.equal(undoneData.version, 3);
});

test('初始版本无法撤销', async () => {
  const cookie = await login();
  const sessionId = await createSession(cookie, '工单完工率是多少？');

  await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  const undoAttempt = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/context`,
    {
      method: 'DELETE',
      headers: {
        Cookie: cookie,
      },
    },
  );

  assert.equal(undoAttempt.status, 400);
  const body = await undoAttempt.json();
  assert.match(body.error, /无法继续撤销/);
});

test('原始问题文本在修正后仍然保留', async () => {
  const cookie = await login();
  const question = '本季度满意度评分和去年相比有什么变化？';
  const sessionId = await createSession(cookie, question);

  await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  await fetch(`${baseUrl}/api/analysis/sessions/${sessionId}/context`, {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      comparison: {
        value: '与去年同季度同比',
      },
    }),
  });

  const latest = await fetch(`${baseUrl}/api/analysis/sessions/${sessionId}/context`, {
    headers: {
      Cookie: cookie,
    },
  });
  const data = await latest.json();
  assert.equal(data.originalQuestionText, question);
});

test('跨用户修改被拒绝', async () => {
  const ownerCookie = await login('owner-user');
  const sessionId = await createSession(ownerCookie, '为什么投诉量上升了？');

  await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: ownerCookie,
    },
  });

  const attackerCookie = await login('attacker-user');

  const attackResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/context`,
    {
      method: 'PUT',
      headers: {
        Cookie: attackerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetMetric: {
          value: '篡改指标',
        },
      }),
    },
  );

  assert.equal(attackResponse.status, 404);
});

test('非法修正载荷被拒绝', async () => {
  const cookie = await login();
  const sessionId = await createSession(cookie, '收费回款率如何？');

  await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  const emptyResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/context`,
    {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(emptyResponse.status, 400);

  const emptyValueResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/context`,
    {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetMetric: {
          value: '',
        },
      }),
    },
  );
  assert.equal(emptyValueResponse.status, 400);
});
