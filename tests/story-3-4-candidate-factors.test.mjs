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

async function login(employeeId = 'factor-tester') {
  const formData = new FormData();
  formData.set('employeeId', employeeId);
  formData.set('displayName', '因素测试员');
  formData.set('organizationId', 'org-factor');
  formData.set('projectIds', 'project-factor');
  formData.set('areaIds', 'area-factor');
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
      SESSION_SECRET: 'story-3-4-test-secret',
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

test('归因类问题展示候选影响因素与可解释依据', async () => {
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

  assert.match(html, /候选影响因素/);
  assert.match(html, /这些因素不是最终结论/);
  assert.match(html, /收费政策触达/);
  assert.match(html, /工单响应时效/);
  assert.match(html, /与当前指标或实体的相关依据/);
});

test('简单查询类问题跳过候选因素扩展，不强行展示因素列表', async () => {
  const cookie = await login('factor-query');
  const sessionId = await createSession(cookie, '工单完工率是多少？');

  const response = await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /已跳过候选因素扩展/);
  assert.doesNotMatch(html, /收费政策触达/);
  assert.doesNotMatch(html, /工单响应时效/);
});
