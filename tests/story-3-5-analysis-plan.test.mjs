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

async function login(employeeId = 'plan-tester') {
  const formData = new FormData();
  formData.set('employeeId', employeeId);
  formData.set('displayName', '计划测试员');
  formData.set('organizationId', 'org-plan');
  formData.set('projectIds', 'project-plan');
  formData.set('areaIds', 'area-plan');
  formData.set('roleCodes', 'PROPERTY_ANALYST');
  formData.set('next', '/workspace');

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  assert.match(response.headers.get('location') ?? '', /\/workspace$/);
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
  assert.match(location, /\/workspace\/analysis\/[a-z0-9-]+$/);

  return location.split('/').pop();
}

test.before(async () => {
  port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: 'story-3-5-test-secret',
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

test('复杂归因问题生成多步计划并清晰展示依赖关系', async () => {
  const cookie = await login();
  const sessionId = await createSession(
    cookie,
    '为什么本月项目 moon 的收费回款率下降了？',
  );

  const response = await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /分析计划/);
  assert.match(html, /计划骨架/);
  assert.match(html, /步骤 1/);
  assert.match(html, /步骤 2/);
  assert.match(html, /逐项验证候选因素/);
  assert.match(html, /依赖步骤/);
  assert.match(html, /汇总归因判断/);
});

test('简单查询问题生成极简计划，不强行扩展复杂依赖链', async () => {
  const cookie = await login('plan-query');
  const sessionId = await createSession(cookie, '工单完工率是多少？');

  const response = await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /分析计划/);
  assert.match(html, /极简计划/);
  assert.match(html, /返回指标结果/);
  assert.doesNotMatch(html, /逐项验证候选因素/);
  assert.doesNotMatch(html, /汇总归因判断/);
});
