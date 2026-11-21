import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { stopProcessTree } from './helpers/stop-process-tree.mjs';
import net from 'node:net';

let port;
let baseUrl;

let serverProcess;
let stubJavaServer;
let stubJavaBaseUrl;
let stubAccountLoginAvailable = true;
const stubLoginRequests = [];

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

async function startStubJavaBackend() {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (request.method === 'GET' && requestUrl.pathname === '/api/runtime/environment') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          name: 'auth-hardening-test',
          kind: 'local-dev',
          database: null,
          remoteDatabase: false,
        }),
      );
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/auth/config') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          accountLoginAvailable: stubAccountLoginAvailable,
          urlBridgeEnabled: false,
        }),
      );
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/auth/me') {
      response.statusCode = 401;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          error: '未登录',
          code: 'AUTH_REQUIRED',
          traceId: 'auth-hardening-me',
        }),
      );
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/auth/login') {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      stubLoginRequests.push(Buffer.concat(chunks).toString('utf8'));
      response.statusCode = 303;
      response.setHeader('Location', '/login?error=INVALID_CREDENTIALS');
      response.end();
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test.before(async () => {
  const stub = await startStubJavaBackend();
  stubJavaServer = stub.server;
  stubJavaBaseUrl = stub.url;

  port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: 'auth-hardening-test-secret',
      JAVA_BACKEND_URL: stubJavaBaseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServerReady(serverProcess);
});

test.after(async () => {
  if (serverProcess) {
    await stopProcessTree(serverProcess);
  }
  if (stubJavaServer) {
    await new Promise((resolve) => stubJavaServer.close(resolve));
  }
});

test('登录页不再暴露手填 scope 表单，仅保留账号密码入口', async () => {
  const response = await fetch(`${baseUrl}/login`);

  assert.equal(response.status, 200);
  const html = await response.text();

  // 仅保留账号+密码登录表单，手填 scope 的老表单不再出现
  assert.match(html, /action="\/api\/auth\/login"/);
  assert.match(html, /name="account"/);
  assert.match(html, /name="password"/);
  assert.doesNotMatch(html, /模拟 ERP 回调/);
  assert.doesNotMatch(html, /name="employeeId"/);
  assert.doesNotMatch(html, /name="organizationId"/);
  assert.doesNotMatch(html, /name="projectIds"/);
  assert.doesNotMatch(html, /name="areaIds"/);
  assert.doesNotMatch(html, /name="roleCodes"/);

  // 账号登录不可用时也不暴露任何登录表单或手填 scope 字段
  stubAccountLoginAvailable = false;
  try {
    const disabledResponse = await fetch(`${baseUrl}/login`);
    assert.equal(disabledResponse.status, 200);
    const disabledHtml = await disabledResponse.text();
    assert.match(disabledHtml, /账号登录当前不可用/);
    assert.doesNotMatch(disabledHtml, /action="\/api\/auth\/login"/);
    assert.doesNotMatch(disabledHtml, /name="organizationId"/);
  } finally {
    stubAccountLoginAvailable = true;
  }
});

test('伪造 scope 字段不能通过登录接口换取会话', async () => {
  const previousCount = stubLoginRequests.length;
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

  // 未提供有效 account/password：Java 拒绝并重定向回登录页，绝不会签发会话
  assert.equal(response.status, 303);
  assert.match(response.headers.get('location') ?? '', /\/login\?error=/);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(stubLoginRequests.length, previousCount + 1);
});

test('历史 callback 换取会话入口已移除', async () => {
  const response = await fetch(
    `${baseUrl}/api/auth/callback?employeeId=u-9999&organizationId=org-any&next=/workspace`,
    {
      redirect: 'manual',
    },
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('set-cookie'), null);
});
