import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 3127;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess;

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

async function login(nextPath = '/workspace') {
  const formData = new FormData();
  formData.set('employeeId', 'auth-tester');
  formData.set('displayName', '安全测试员');
  formData.set('organizationId', 'org-test');
  formData.set('projectIds', 'project-test');
  formData.set('areaIds', 'area-test');
  formData.set('roleCodes', 'PROPERTY_ANALYST');
  formData.set('next', nextPath);

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: formData,
    redirect: 'manual',
  });

  return response;
}

test.before(async () => {
  serverProcess = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: 'story-2-7-test-secret',
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

test('正常站内 next=/workspace 回跳成功', async () => {
  const response = await login('/workspace');
  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace$/);
});

test('正常站内 next=/workspace/analysis/xxx 回跳成功', async () => {
  const response = await login('/workspace/analysis/test-session');
  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace\/analysis\/test-session$/);
});

test('外部 URL 被拒绝，降级到 /workspace', async () => {
  const response = await login('https://evil.com');
  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace$/);
  assert.doesNotMatch(location, /evil/);
});

test('协议相对路径 //evil.com 被拒绝', async () => {
  const response = await login('//evil.com');
  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace$/);
  assert.doesNotMatch(location, /evil/);
});

test('反斜杠 \\\\evil.com 被拒绝', async () => {
  const response = await login('\\evil.com');
  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace$/);
  assert.doesNotMatch(location, /evil/);
});

test('带空白前缀的路径被正确处理', async () => {
  const response = await login('  /workspace');
  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace$/);
});

test('非 workspace 路径 /admin 被拒绝', async () => {
  const response = await login('/admin');
  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace$/);
  assert.doesNotMatch(location, /admin/);
});

test('路径穿越 /workspace/../../etc/passwd 被规范化拒绝', async () => {
  const response = await login('/workspace/../../etc/passwd');
  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.doesNotMatch(location, /etc/);
  assert.doesNotMatch(location, /passwd/);
});

test('空 next 路径降级到 /workspace', async () => {
  const response = await login('');
  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace$/);
});

test('未登录访问 workspace 重定向到登录页', async () => {
  const response = await fetch(`${BASE_URL}/workspace`, {
    redirect: 'manual',
  });

  assert.equal(response.status, 307);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/login/);
});

test('dev stub 门禁：isDevErpAuthEnabled 代码包含 production 安全检查', async () => {
  const { readFile } = await import('node:fs/promises');
  const configPath = new URL(
    '../src/infrastructure/erp-auth/dev-auth-config.ts',
    import.meta.url,
  );
  const content = await readFile(configPath, 'utf-8');

  assert.match(content, /production/, 'isDevErpAuthEnabled 应包含 production 检查');
  assert.match(content, /NODE_ENV/, '应检查 NODE_ENV 环境变量');
});

test('sanitizeNextPath 代码包含反斜杠防护', async () => {
  const { readFile } = await import('node:fs/promises');
  const modelPath = new URL(
    '../src/domain/auth/models.ts',
    import.meta.url,
  );
  const content = await readFile(modelPath, 'utf-8');

  assert.match(content, /\\\\/, 'sanitizeNextPath 应包含反斜杠替换');
  assert.match(content, /trim/, '应对输入进行 trim 处理');
});
