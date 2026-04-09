import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { promisify } from 'node:util';

import { ensureAnalysisExecutionSnapshotsTable } from './helpers/ensure-analysis-execution-snapshots-table.mjs';
import { ensureNextBuildReady } from './helpers/ensure-next-build-ready.mjs';

const execFileAsync = promisify(execFile);

let port;
let baseUrl;
let serverProcess;
const TEST_SESSION_SECRET = 'story-6-2-test-secret';
const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const TEST_REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? 'dip3';

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
  employeeId,
  displayName,
  organizationId = 'org-follow-up-adjustment',
  projectIds = 'project-follow-up-adjustment',
  areaIds = 'area-follow-up-adjustment',
} = {}) {
  return await runTsSnippet(`
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
  `).then((result) => result.cookie);
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
  return response.headers.get('location')?.split('/').pop();
}

async function seedCompletedConclusion({
  sessionId,
  ownerUserId,
  conclusionTitle = '物业服务',
  conclusionSummary = '物业服务是当前主因。',
}) {
  return await runTsSnippet(`
    import snapshotStoreModule from './src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store.ts';
    import persistenceUseCasesModule from './src/application/analysis-execution/persistence-use-cases.ts';

    const { createPostgresAnalysisExecutionSnapshotStore } = snapshotStoreModule;
    const { createAnalysisExecutionPersistenceUseCases } = persistenceUseCasesModule;

    const persistenceUseCases = createAnalysisExecutionPersistenceUseCases({
      snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
    });
    const executionId = 'follow-up-adjustment-' + crypto.randomUUID();
    const timestamp = new Date().toISOString();

    await persistenceUseCases.saveExecutionSnapshot({
      executionId,
      sessionId: ${JSON.stringify(sessionId)},
      ownerUserId: ${JSON.stringify(ownerUserId)},
      status: 'completed',
      planSnapshot: {
        mode: 'multi-step',
        steps: [
          {
            id: 'confirm-analysis-scope',
            order: 1,
            title: '确认分析口径',
            objective: '确认上下文',
            dependencyIds: [],
          },
          {
            id: 'synthesize-attribution',
            order: 2,
            title: '汇总归因判断',
            objective: '形成归因结论',
            dependencyIds: ['confirm-analysis-scope'],
          },
        ],
      },
      events: [
        {
          id: 'event-1',
          sessionId: ${JSON.stringify(sessionId)},
          executionId,
          sequence: 1,
          kind: 'stage-result',
          timestamp,
          message: '已完成主要归因判断。',
          step: {
            id: 'synthesize-attribution',
            order: 2,
            title: '汇总归因判断',
            status: 'completed',
          },
          renderBlocks: [],
          metadata: {
            conclusionText: ${JSON.stringify(conclusionTitle)},
            conclusionSummary: ${JSON.stringify(conclusionSummary)},
            conclusionConfidence: 0.82,
            conclusionEvidence: [
              {
                label: '指标',
                summary: '收费回款率波动明显。',
              },
            ],
          },
        },
      ],
      conclusionReadModel: {
        causes: [
          {
            id: 'cause-1',
            rank: 1,
            title: ${JSON.stringify(conclusionTitle)},
            summary: ${JSON.stringify(conclusionSummary)},
            confidence: 0.82,
            evidence: [
              {
                label: '指标',
                summary: '收费回款率波动明显。',
              },
            ],
          },
        ],
        renderBlocks: [],
      },
    });

    console.log(JSON.stringify({ executionId }));
  `);
}

async function createFollowUp({ cookie, sessionId, question }) {
  const formData = new FormData();
  formData.set('question', question);

  const response = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: formData,
      redirect: 'manual',
    },
  );

  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  const followUpId = new URL(location).searchParams.get('followUpId');
  assert.ok(followUpId);
  return { location, followUpId };
}

async function readFollowUpState(followUpId) {
  return await runTsSnippet(`
    import pg from 'pg';

    const pool = new pg.Pool({
      connectionString: ${JSON.stringify(TEST_DATABASE_URL)},
    });

    try {
      const followUpRows = await pool.query(
        \`
          select
            id,
            session_id,
            owner_user_id,
            merged_context,
            inherited_context
          from platform.analysis_session_follow_ups
          where id = $1
        \`,
        [${JSON.stringify(followUpId)}],
      );

      console.log(JSON.stringify({
        followUp: followUpRows.rows[0] ?? null,
      }));
    } finally {
      await pool.end();
    }
  `);
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

  await ensureNextBuildReady({
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
});

test.after(async () => {
  if (!serverProcess) {
    return;
  }

  serverProcess.kill('SIGINT');
  await once(serverProcess, 'exit');
});

test('follow-up 可补充因素与比较条件，并在界面上标识新增条件', async () => {
  const cookie = await login({
    employeeId: 'follow-up-adjust-owner',
    displayName: '范围调整拥有者',
  });
  const sessionId = await createSession(
    cookie,
    '为什么近三个月丰和园小区项目的收费回款率下降了？',
  );

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

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-adjust-owner',
  });

  const { followUpId } = await createFollowUp({
    cookie,
    sessionId,
    question: '那物业服务为什么波动？',
  });

  const pageResponse = await fetch(
    `${baseUrl}/workspace/analysis/${sessionId}?followUpId=${followUpId}`,
    {
      headers: {
        Cookie: cookie,
      },
    },
  );
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, /补充因素或缩小范围/);

  const formData = new FormData();
  formData.set('comparison', '同比去年同期');
  formData.set('factor', '物业服务');

  const response = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/context`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: formData,
      redirect: 'manual',
    },
  );

  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, new RegExp(`followUpId=${followUpId}`));

  const afterPage = await fetch(location, {
    headers: {
      Cookie: cookie,
    },
  });
  const afterHtml = await afterPage.text();
  assert.match(afterHtml, /新增条件/);
  assert.match(afterHtml, /同比去年同期/);
  assert.match(afterHtml, /候选因素/);
  assert.match(afterHtml, /物业服务/);

  const state = await readFollowUpState(followUpId);
  assert.equal(state.followUp.merged_context.comparison.value, '同比去年同期');
  assert.ok(
    state.followUp.merged_context.constraints.some(
      (constraint) =>
        constraint.label === '候选因素' && constraint.value === '物业服务',
    ),
  );
});

test('冲突条件未确认前不会静默覆盖，确认后才会生效', async () => {
  const cookie = await login({
    employeeId: 'follow-up-conflict-owner',
    displayName: '冲突确认拥有者',
  });
  const sessionId = await createSession(
    cookie,
    '为什么近三个月访客模式的投诉量上升了？',
  );

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

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-conflict-owner',
  });

  const { followUpId } = await createFollowUp({
    cookie,
    sessionId,
    question: '继续看一下满意度呢？',
  });

  const conflictForm = new FormData();
  conflictForm.set('timeRange', '本月');

  const conflictResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/context`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: conflictForm,
      redirect: 'manual',
    },
  );

  assert.equal(conflictResponse.status, 303);
  const conflictLocation = conflictResponse.headers.get('location') ?? '';
  assert.match(conflictLocation, /followUpConflict=/);

  const conflictPage = await fetch(conflictLocation, {
    headers: {
      Cookie: cookie,
    },
  });
  const conflictHtml = await conflictPage.text();
  assert.match(conflictHtml, /发现冲突条件，确认后才会覆盖当前轮次上下文/);
  assert.match(conflictHtml, /当前值/);
  assert.match(conflictHtml, /近六个月/);
  assert.match(conflictHtml, /拟更新为/);
  assert.match(conflictHtml, /本月/);

  const stateBeforeConfirm = await readFollowUpState(followUpId);
  assert.equal(stateBeforeConfirm.followUp.merged_context.timeRange.value, '近六个月');

  const confirmForm = new FormData();
  confirmForm.set('timeRange', '本月');
  confirmForm.set('confirmConflicts', 'true');

  const confirmedResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/context`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: confirmForm,
      redirect: 'manual',
    },
  );

  assert.equal(confirmedResponse.status, 303);
  const confirmedPage = await fetch(confirmedResponse.headers.get('location') ?? '', {
    headers: {
      Cookie: cookie,
    },
  });
  const confirmedHtml = await confirmedPage.text();
  assert.match(confirmedHtml, /冲突条件已确认并更新到当前轮次上下文/);
  assert.match(confirmedHtml, /本月/);

  const stateAfterConfirm = await readFollowUpState(followUpId);
  assert.equal(stateAfterConfirm.followUp.merged_context.timeRange.value, '本月');
});

test('重新打开会话时，follow-up 面板使用 active follow-up 自身的承接结论和合并上下文', async () => {
  const cookie = await login({
    employeeId: 'follow-up-display-owner',
    displayName: '追问展示拥有者',
  });
  const sessionId = await createSession(
    cookie,
    '为什么近三个月访客模式的投诉量上升了？',
  );

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

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-display-owner',
    conclusionTitle: '物业服务',
    conclusionSummary: '物业服务是当前主因。',
  });

  const { followUpId } = await createFollowUp({
    cookie,
    sessionId,
    question: '继续看一下收费项结构',
  });

  const confirmForm = new FormData();
  confirmForm.set('timeRange', '本月');
  confirmForm.set('confirmConflicts', 'true');

  const confirmResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/context`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: confirmForm,
      redirect: 'manual',
    },
  );
  assert.equal(confirmResponse.status, 303);

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-display-owner',
    conclusionTitle: '满意度评价',
    conclusionSummary: '满意度评价是最新一次执行的主因。',
  });

  const pageResponse = await fetch(
    `${baseUrl}/workspace/analysis/${sessionId}?followUpId=${followUpId}`,
    {
      headers: {
        Cookie: cookie,
      },
    },
  );
  assert.equal(pageResponse.status, 200);
  const pageHtml = await pageResponse.text();
  assert.match(
    pageHtml,
    /满意度评价/,
  );
  assert.match(
    pageHtml,
    new RegExp(`name="parentFollowUpId"[^>]*value="${followUpId}"`),
  );
  assert.match(
    pageHtml,
    /当前承接结论[\s\S]*?物业服务[\s\S]*?name="parentFollowUpId"/,
  );
  assert.match(
    pageHtml,
    /默认沿用上下文[\s\S]*?本月[\s\S]*?name="parentFollowUpId"/,
  );
});

test('非 owner 不能修改他人 follow-up 的范围条件', async () => {
  const ownerCookie = await login({
    employeeId: 'follow-up-adjust-owner-2',
    displayName: '范围调整拥有者 2',
  });
  const intruderCookie = await login({
    employeeId: 'follow-up-adjust-intruder',
    displayName: '越权范围调整用户',
  });
  const sessionId = await createSession(
    ownerCookie,
    '为什么近三个月石油大厦物业服务项目的回款表现异常？',
  );

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-adjust-owner-2',
  });

  const { followUpId } = await createFollowUp({
    cookie: ownerCookie,
    sessionId,
    question: '继续看一下收费项结构',
  });

  const formData = new FormData();
  formData.set('comparison', '环比');

  const response = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/context`,
    {
      method: 'POST',
      headers: {
        Cookie: intruderCookie,
      },
      body: formData,
    },
  );

  assert.equal(response.status, 404);
  const data = await response.json();
  assert.equal(data.error, '会话不存在、追问不存在或无权访问。');
});
