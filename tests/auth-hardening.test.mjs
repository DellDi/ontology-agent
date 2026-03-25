import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';

let port;
let baseUrl;

let serverProcess;

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
      finalize(new Error(`Next dev server exited early with code ${code ?? 'unknown'}.`));
    }

    processHandle.stdout?.on('data', onData);
    processHandle.stderr?.on('data', onData);
    processHandle.on('exit', onExit);
  });
}

test.before(async () => {
  port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: 'auth-hardening-test-secret',
      ENABLE_DEV_ERP_AUTH: '0',
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

test('禁用开发 stub 时登录页不再暴露联调登录入口', async () => {
  const response = await fetch(`${baseUrl}/login`);

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.doesNotMatch(html, />开发联调登录入口</);
  assert.doesNotMatch(html, /action="\/api\/auth\/login"/);
  assert.doesNotMatch(html, /模拟 ERP 回调/);
  assert.match(html, /当前环境未开放开发联调登录入口/);
});

test('禁用开发 stub 时不能通过登录接口伪造任意身份', async () => {
  const formData = new FormData();
  formData.set('employeeId', 'u-9999');
  formData.set('displayName', '攻击者');
  formData.set('organizationId', 'org-any');
  formData.set('projectIds', 'project-any');
  formData.set('areaIds', 'area-any');
  formData.set('roleCodes', 'PROPERTY_ANALYST');

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  assert.match(response.headers.get('location') ?? '', /\/login\?error=/);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('禁用开发 stub 时不能通过 callback query 直接换取会话', async () => {
  const response = await fetch(
    `${baseUrl}/api/auth/callback?employeeId=u-9999&organizationId=org-any&next=/workspace`,
    {
      redirect: 'manual',
    },
  );

  assert.equal(response.status, 303);
  assert.match(response.headers.get('location') ?? '', /\/login\?error=/);
  assert.equal(response.headers.get('set-cookie'), null);
});
