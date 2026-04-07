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
const TEST_SESSION_SECRET = 'story-5-3-test-secret';
const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const TEST_REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? 'dip3-story-5-3';

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
  employeeId = 'conclusion-u-1',
  displayName = '结论测试员',
  organizationId = 'org-conclusion',
  projectIds = 'project-conclusion',
  areaIds = 'area-conclusion',
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

test('归因结果模型会稳定生成排序原因、证据摘要和表格类结果块', async () => {
  const result = await runTsSnippet(`
    import resultModelsModule from './src/domain/analysis-result/models.ts';

    const { buildAnalysisConclusionReadModel } = resultModelsModule;

    const events = [
      {
        id: 'evt-1',
        sessionId: 'session-1',
        executionId: 'exec-1',
        sequence: 1,
        kind: 'stage-result',
        timestamp: '2026-04-07T00:00:00.000Z',
        step: { id: 'inspect-metric-change', order: 1, title: '检查指标变化', status: 'completed' },
        stage: { key: 'inspect-metric-change', label: '步骤 1', status: 'completed' },
        message: '步骤 1 已完成，阶段结果已生成。',
        renderBlocks: [
          { type: 'status', title: '阶段状态', value: '已完成', tone: 'success' },
          { type: 'kv-list', title: '阶段结果', items: [{ label: '当前步骤', value: '检查指标变化' }, { label: '进度', value: '1/3' }] },
          { type: 'tool-list', title: '工具调用', items: [{ toolName: 'cube.semantic-query', objective: '读取语义层指标对比结果', status: 'completed' }] },
          { type: 'markdown', title: '阶段说明', content: '步骤 1 已完成，阶段结果已生成。' },
        ],
      },
      {
        id: 'evt-2',
        sessionId: 'session-1',
        executionId: 'exec-1',
        sequence: 2,
        kind: 'stage-result',
        timestamp: '2026-04-07T00:00:01.000Z',
        step: { id: 'validate-candidate-factors', order: 2, title: '验证候选因素', status: 'completed' },
        stage: { key: 'validate-candidate-factors', label: '步骤 2', status: 'completed' },
        message: '步骤 2 已完成，阶段结果已生成。',
        renderBlocks: [
          { type: 'status', title: '阶段状态', value: '已完成', tone: 'success' },
          { type: 'kv-list', title: '阶段结果', items: [{ label: '当前步骤', value: '验证候选因素' }, { label: '进度', value: '2/3' }] },
          { type: 'tool-list', title: '工具调用', items: [{ toolName: 'neo4j.graph-query', objective: '扩展候选因素关系', status: 'completed' }] },
          { type: 'markdown', title: '阶段说明', content: '步骤 2 已完成，阶段结果已生成。' },
        ],
      },
    ];

    const readModel = buildAnalysisConclusionReadModel(events);

    console.log(JSON.stringify({
      causeCount: readModel.causes.length,
      firstCauseTitle: readModel.causes[0]?.title,
      everyCauseHasEvidence: readModel.causes.every((cause) => cause.evidence.length > 0),
      tableBlockTypes: readModel.renderBlocks.map((block) => block.type),
      stableOrder: readModel.causes.map((cause) => cause.rank),
    }));
  `);

  assert.equal(result.causeCount, 2);
  assert.match(result.firstCauseTitle, /检查指标变化/);
  assert.equal(result.everyCauseHasEvidence, true);
  assert.deepEqual(result.stableOrder, [1, 2]);
  assert.ok(result.tableBlockTypes.includes('table'));
});

test('分析会话页会展示排序后的原因列表、关键证据和表格类结论块', async () => {
  const cookie = await login();
  const sessionId = await createSession(
    cookie,
    '为什么今年各项目的收缴率排名发生变化了？',
  );
  const { executionId, location } = await submitExecution(cookie, sessionId);

  await readSseEvents(
    `${baseUrl}/api/analysis/sessions/${sessionId}/stream?executionId=${executionId}`,
    cookie,
    8,
  );

  const response = await fetch(location, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /归因结论/);
  assert.match(html, /原因排序/);
  assert.match(html, /关键证据/);
  assert.match(html, /检查指标变化|验证候选因素/);
});
