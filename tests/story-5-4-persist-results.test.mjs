import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { promisify } from 'node:util';

import { ensureAnalysisExecutionSnapshotsTable } from './helpers/ensure-analysis-execution-snapshots-table.mjs';

const execFileAsync = promisify(execFile);

let port;
let baseUrl;
let serverProcess;
let workerProcess;
const TEST_SESSION_SECRET = 'story-5-4-test-secret';
const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const TEST_REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? 'dip3-story-5-4';

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
  const start = Date.now();

  while (Date.now() - start < 30_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Next server exited early with code ${processHandle.exitCode}.`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/`, {
        redirect: 'manual',
      });

      if (response.status > 0) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw new Error('Next server did not become ready in time.');
}

async function waitForWorkerReady(processHandle) {
  const start = Date.now();

  while (Date.now() - start < 2_500) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Worker exited early with code ${processHandle.exitCode}.`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        REDIS_URL: TEST_REDIS_URL,
        REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
        SESSION_SECRET: TEST_SESSION_SECRET,
      },
    },
  );

  return JSON.parse(stdout.trim());
}

async function login({
  employeeId = 'persist-u-1',
  displayName = '持久化测试员',
  organizationId = 'org-persist',
  projectIds = 'project-persist',
  areaIds = 'area-persist',
} = {}) {
  const result = await runTsSnippet(`
    import sessionStoreModule from './src/infrastructure/session/postgres-session-store.ts';
    import sessionCookieModule from './src/infrastructure/session/session-cookie.ts';

    const { createPostgresSessionStore } = sessionStoreModule;
    const {
      createSessionCookieValue,
      getSessionCookieName,
    } = sessionCookieModule;

    const sessionStore = createPostgresSessionStore();
    const session = await sessionStore.createSession({
      userId: ${JSON.stringify(employeeId)},
      displayName: ${JSON.stringify(displayName)},
      scope: {
        organizationId: ${JSON.stringify(organizationId)},
        projectIds: ${JSON.stringify(projectIds.split(',').filter(Boolean))},
        areaIds: ${JSON.stringify(areaIds.split(',').filter(Boolean))},
        roleCodes: ['PROPERTY_ANALYST'],
      },
    });

    console.log(JSON.stringify({
      cookie: \`\${getSessionCookieName()}=\${createSessionCookieValue(session.sessionId)}\`,
    }));
  `);

  return result.cookie;
}

async function createSession(cookie, questionText) {
  const formData = new FormData();
  formData.set('question', questionText);

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

async function submitExecution(cookie, sessionId) {
  const response = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/execute`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      redirect: 'manual',
    },
  );

  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  const redirectUrl = new URL(location, baseUrl);
  const executionId = redirectUrl.searchParams.get('executionId');
  assert.ok(executionId, '重定向地址应包含 executionId');

  return {
    executionId,
    location: redirectUrl.toString(),
  };
}

async function readSseEvents(url, cookie, maxEvents = 8) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  const timeoutAt = Date.now() + 12_000;

  while (Date.now() < timeoutAt && events.length < maxEvents) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes('\n\n')) {
      const separatorIndex = buffer.indexOf('\n\n');
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const dataLine = rawEvent
        .split('\n')
        .find((line) => line.startsWith('data: '));

      if (!dataLine) {
        continue;
      }

      events.push(JSON.parse(dataLine.slice('data: '.length)));
    }
  }

  await reader.cancel();

  return events;
}

test.before(async () => {
  port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.REDIS_KEY_PREFIX = TEST_REDIS_KEY_PREFIX;

  await execFileAsync('pnpm', ['db:migrate'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
    },
  });
  await ensureAnalysisExecutionSnapshotsTable(TEST_DATABASE_URL);

  await execFileAsync('pnpm', ['build'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
      ENABLE_DEV_ERP_AUTH: '1',
    },
  });

  serverProcess = spawn('pnpm', ['exec', 'next', 'start', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
      ENABLE_DEV_ERP_AUTH: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServerReady(serverProcess);

  workerProcess = spawn('pnpm', ['worker:dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
      ENABLE_DEV_ERP_AUTH: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForWorkerReady(workerProcess);
});

test.after(async () => {
  for (const processHandle of [workerProcess, serverProcess]) {
    if (!processHandle) {
      continue;
    }

    processHandle.kill('SIGINT');
    await once(processHandle, 'exit');
  }
});

test('重新打开会话时会从持久化层恢复计划、阶段结果和归因结论', async () => {
  const cookie = await login();
  const sessionId = await createSession(
    cookie,
    '为什么今年各项目的收缴率排名发生变化了？',
  );
  const { executionId } = await submitExecution(cookie, sessionId);

  await readSseEvents(
    `${baseUrl}/api/analysis/sessions/${sessionId}/stream?executionId=${executionId}`,
    cookie,
    8,
  );

  const response = await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /归因结论/);
  assert.match(html, /执行进度/);
  assert.match(html, /原因排序/);
});

test('失败或中断的执行快照会保留失败位置、结果块和移动端最小投影', async () => {
  const result = await runTsSnippet(`
    import persistenceModule from './src/application/analysis-execution/persistence-use-cases.ts';

    const { createAnalysisExecutionPersistenceUseCases } = persistenceModule;

    let savedSnapshot = null;

    const useCases = createAnalysisExecutionPersistenceUseCases({
      snapshotStore: {
        async save(snapshot) {
          savedSnapshot = snapshot;
          return snapshot;
        },
        async getLatestBySessionId() {
          return savedSnapshot;
        },
        async getByExecutionId() {
          return savedSnapshot;
        },
      },
    });

    await useCases.saveExecutionSnapshot({
      executionId: 'exec-failed',
      sessionId: 'session-failed',
      ownerUserId: 'owner-failed',
      status: 'failed',
      planSnapshot: {
        mode: 'multi-step',
        summary: '测试计划',
        steps: [
          { id: 's1', order: 1, title: '步骤一', objective: '目标一', dependencyIds: [] },
        ],
      },
      events: [
        {
          id: 'evt-failed',
          sessionId: 'session-failed',
          executionId: 'exec-failed',
          sequence: 1,
          kind: 'stage-result',
          timestamp: '2026-04-07T00:00:00.000Z',
          step: { id: 's1', order: 1, title: '步骤一', status: 'failed' },
          stage: { key: 's1', label: '步骤 1', status: 'failed' },
          message: '步骤一失败。',
          renderBlocks: [
            { type: 'status', title: '阶段状态', value: '已失败', tone: 'error' },
            { type: 'markdown', title: '阶段说明', content: '步骤一失败。' },
          ],
        },
      ],
      conclusionReadModel: {
        causes: [],
        renderBlocks: [],
      },
    });

    const snapshot = await useCases.getLatestSnapshotForSession({
      sessionId: 'session-failed',
      ownerUserId: 'owner-failed',
    });

    console.log(JSON.stringify({
      status: snapshot.status,
      failureStepTitle: snapshot.failurePoint?.title,
      hasResultBlocks: snapshot.resultBlocks.length > 0,
      hasMobileProjection: typeof snapshot.mobileProjection.summary === 'string',
    }));
  `);

  assert.equal(result.status, 'failed');
  assert.match(result.failureStepTitle, /步骤一/);
  assert.equal(result.hasResultBlocks, true);
  assert.equal(result.hasMobileProjection, true);
});
