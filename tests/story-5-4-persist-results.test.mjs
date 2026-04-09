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

async function saveSnapshot(snapshot) {
  const result = await runTsSnippet(`
    import snapshotStoreModule from './src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store.ts';

    const { createPostgresAnalysisExecutionSnapshotStore } = snapshotStoreModule;

    const snapshotStore = createPostgresAnalysisExecutionSnapshotStore();
    const snapshot = ${JSON.stringify(snapshot)};
    const savedSnapshot = await snapshotStore.save(snapshot);

    console.log(JSON.stringify({
      executionId: savedSnapshot.executionId,
      updatedAt: savedSnapshot.updatedAt,
    }));
  `);

  return result;
}

async function readSnapshot(executionId) {
  return await runTsSnippet(`
    import snapshotStoreModule from './src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store.ts';

    const { createPostgresAnalysisExecutionSnapshotStore } = snapshotStoreModule;

    const snapshotStore = createPostgresAnalysisExecutionSnapshotStore();
    const snapshot = await snapshotStore.getByExecutionId(${JSON.stringify(executionId)});

    console.log(JSON.stringify(snapshot));
  `);
}

async function waitFor(check, timeoutMs = 12_000, intervalMs = 250) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();

    if (result) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Condition did not become true in time.');
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

test('带 executionId 的会话页会优先回放对应 execution 的快照与结论', async () => {
  const cookie = await login({
    employeeId: 'persist-multi-owner',
    displayName: '多执行回放测试员',
  });
  const sessionId = await createSession(
    cookie,
    '为什么今年各项目的收缴率排名发生变化了？',
  );
  const oldExecutionId = `${sessionId}-exec-old-view`;
  const latestExecutionId = `${sessionId}-exec-latest-view`;

  await saveSnapshot({
    executionId: oldExecutionId,
    sessionId,
    ownerUserId: 'persist-multi-owner',
    status: 'completed',
    planSnapshot: {
      mode: 'multi-step',
      summary: '旧执行计划摘要',
      steps: [
        {
          id: 'historic-step',
          order: 1,
          title: '旧执行步骤',
          objective: '回放旧执行的计划骨架',
          dependencyIds: [],
        },
      ],
    },
    stepResults: [],
    conclusionState: {
      causes: [
        {
          id: 'historic-cause',
          rank: 1,
          title: '旧执行原因',
          summary: '旧执行结论摘要',
          confidence: 0.88,
          evidence: [
            {
              label: '历史证据',
              summary: '旧执行保留的关键证据',
            },
          ],
        },
      ],
      renderBlocks: [
        {
          type: 'table',
          title: '原因排序',
          columns: ['排序', '原因', '关键证据'],
          rows: [['1', '旧执行原因', '旧执行保留的关键证据']],
        },
      ],
    },
    resultBlocks: [],
    mobileProjection: {
      summary: '旧执行移动端摘要',
      status: 'completed',
      updatedAt: '2026-04-07T00:00:00.000Z',
    },
    failurePoint: null,
    createdAt: '2026-04-07T00:00:00.000Z',
    updatedAt: '2026-04-07T00:00:00.000Z',
  });

  await saveSnapshot({
    executionId: latestExecutionId,
    sessionId,
    ownerUserId: 'persist-multi-owner',
    status: 'completed',
    planSnapshot: {
      mode: 'multi-step',
      summary: '最新执行计划摘要',
      steps: [
        {
          id: 'latest-step',
          order: 1,
          title: '最新执行步骤',
          objective: '展示最新执行的计划骨架',
          dependencyIds: [],
        },
      ],
    },
    stepResults: [],
    conclusionState: {
      causes: [
        {
          id: 'latest-cause',
          rank: 1,
          title: '最新执行原因',
          summary: '最新执行结论摘要',
          confidence: 0.91,
          evidence: [
            {
              label: '最新证据',
              summary: '最新执行保留的关键证据',
            },
          ],
        },
      ],
      renderBlocks: [
        {
          type: 'table',
          title: '原因排序',
          columns: ['排序', '原因', '关键证据'],
          rows: [['1', '最新执行原因', '最新执行保留的关键证据']],
        },
      ],
    },
    resultBlocks: [],
    mobileProjection: {
      summary: '最新执行移动端摘要',
      status: 'completed',
      updatedAt: '2026-04-07T00:10:00.000Z',
    },
    failurePoint: null,
    createdAt: '2026-04-07T00:10:00.000Z',
    updatedAt: '2026-04-07T00:10:00.000Z',
  });

  const response = await fetch(
    `${baseUrl}/workspace/analysis/${sessionId}?executionId=${oldExecutionId}`,
    {
      headers: {
        Cookie: cookie,
      },
    },
  );

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /旧执行计划摘要/);
  assert.match(html, /旧执行原因/);
  assert.doesNotMatch(html, /最新执行计划摘要/);
  assert.match(html, new RegExp(`Execution ID：<!-- -->${oldExecutionId}`));
});

test('executionId 指向其他 session 的快照时不会串页回放 foreign execution', async () => {
  const cookie = await login({
    employeeId: 'persist-cross-session-owner',
    displayName: '跨会话回放测试员',
  });
  const sessionId = await createSession(
    cookie,
    '会话 A：为什么今年各项目的收缴率排名发生变化了？',
  );
  const foreignSessionId = await createSession(
    cookie,
    '会话 B：为什么今年各项目的投诉率排名发生变化了？',
  );
  const foreignExecutionId = `${foreignSessionId}-exec-foreign-session`;

  await saveSnapshot({
    executionId: foreignExecutionId,
    sessionId: foreignSessionId,
    ownerUserId: 'persist-cross-session-owner',
    status: 'completed',
    planSnapshot: {
      mode: 'multi-step',
      summary: '不应出现在会话 A 的外部计划摘要',
      steps: [
        {
          id: 'foreign-step',
          order: 1,
          title: '外部会话步骤',
          objective: '不应被错误回放到另一条会话',
          dependencyIds: [],
        },
      ],
    },
    stepResults: [],
    conclusionState: {
      causes: [
        {
          id: 'foreign-cause',
          rank: 1,
          title: '外部会话原因',
          summary: '不应出现在会话 A 的结论区',
          confidence: 0.77,
          evidence: [
            {
              label: '外部证据',
              summary: '这条证据不应串页显示',
            },
          ],
        },
      ],
      renderBlocks: [
        {
          type: 'table',
          title: '原因排序',
          columns: ['排序', '原因', '关键证据'],
          rows: [['1', '外部会话原因', '这条证据不应串页显示']],
        },
      ],
    },
    resultBlocks: [],
    mobileProjection: {
      summary: '外部会话移动端摘要',
      status: 'completed',
      updatedAt: '2026-04-08T00:00:00.000Z',
    },
    failurePoint: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
  });

  const response = await fetch(
    `${baseUrl}/workspace/analysis/${sessionId}?executionId=${foreignExecutionId}`,
    {
      headers: {
        Cookie: cookie,
      },
    },
  );

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /会话 A：为什么今年各项目的收缴率排名发生变化了？/);
  assert.doesNotMatch(html, /不应出现在会话 A 的外部计划摘要/);
  assert.doesNotMatch(html, /外部会话步骤/);
  assert.doesNotMatch(html, /外部会话原因/);
});

test('成功执行后保存的快照会包含 completed 终态事件', async () => {
  const cookie = await login({
    employeeId: 'persist-completed-owner',
    displayName: '终态快照测试员',
  });
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

  const snapshot = await waitFor(async () => {
    const nextSnapshot = await readSnapshot(executionId);

    if (
      nextSnapshot?.status === 'completed' &&
      Array.isArray(nextSnapshot.stepResults)
    ) {
      return nextSnapshot;
    }

    return null;
  });

  assert.ok(
    snapshot.stepResults.some(
      (event) =>
        event.kind === 'execution-status' && event.status === 'completed',
    ),
    '持久化快照应包含 completed 终态事件',
  );
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
