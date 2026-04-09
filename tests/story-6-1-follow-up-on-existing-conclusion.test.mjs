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
const TEST_SESSION_SECRET = 'story-6-1-test-secret';
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
  organizationId = 'org-follow-up',
  projectIds = 'project-follow-up',
  areaIds = 'area-follow-up',
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
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace\/analysis\/[a-z0-9-]+$/);

  return location.split('/').pop();
}

async function seedCompletedConclusion({
  sessionId,
  ownerUserId,
  organizationId,
  projectIds,
  areaIds,
}) {
  return await runTsSnippet(`
    import snapshotStoreModule from './src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store.ts';
    import persistenceUseCasesModule from './src/application/analysis-execution/persistence-use-cases.ts';

    const { createPostgresAnalysisExecutionSnapshotStore } = snapshotStoreModule;
    const { createAnalysisExecutionPersistenceUseCases } = persistenceUseCasesModule;

    const snapshotStore = createPostgresAnalysisExecutionSnapshotStore();
    const persistenceUseCases = createAnalysisExecutionPersistenceUseCases({
      snapshotStore,
    });
    const executionId = 'follow-up-execution-' + crypto.randomUUID();
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
            objective: '复核当前项目、指标和时间范围。',
            dependencyIds: [],
          },
          {
            id: 'synthesize-attribution',
            order: 2,
            title: '汇总归因判断',
            objective: '形成当前主要原因的归因结论。',
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
          renderBlocks: [
            {
              type: 'markdown',
              title: '结构化分析摘要',
              content: '物业服务是当前最值得继续追问的原因。',
            },
          ],
          metadata: {
            conclusionText: '物业服务',
            conclusionSummary: '物业服务是当前最值得继续追问的原因。',
            conclusionConfidence: 0.82,
            conclusionEvidence: [
              {
                label: '指标',
                summary: '收费回款率与欠费压力在近三个月显著波动。',
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
            title: '物业服务',
            summary: '物业服务是当前最值得继续追问的原因。',
            confidence: 0.82,
            evidence: [
              {
                label: '指标',
                summary: '收费回款率与欠费压力在近三个月显著波动。',
              },
            ],
          },
        ],
        renderBlocks: [],
      },
    });

    console.log(JSON.stringify({
      executionId,
      ownerUserId: ${JSON.stringify(ownerUserId)},
      organizationId: ${JSON.stringify(organizationId)},
      projectIds: ${JSON.stringify(projectIds)},
      areaIds: ${JSON.stringify(areaIds)},
    }));
  `);
}

async function createFollowUp({ cookie, sessionId, question, parentFollowUpId }) {
  const formData = new FormData();
  formData.set('question', question);

  if (parentFollowUpId) {
    formData.set('parentFollowUpId', parentFollowUpId);
  }

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

async function readFollowUpState(sessionId, ownerUserId) {
  return await runTsSnippet(`
    import pg from 'pg';

    const pool = new pg.Pool({
      connectionString: ${JSON.stringify(TEST_DATABASE_URL)},
    });

    try {
      const sessionRows = await pool.query(
        'select id, question_text from platform.analysis_sessions where id = $1',
        [${JSON.stringify(sessionId)}],
      );
      const ownerSessionRows = await pool.query(
        'select id from platform.analysis_sessions where owner_user_id = $1 order by created_at asc',
        [${JSON.stringify(ownerUserId)}],
      );
      const followUpRows = await pool.query(
        \`
          select
            id,
            session_id,
            owner_user_id,
            question_text,
            referenced_execution_id,
            referenced_conclusion_title,
            inherited_context,
            merged_context
          from platform.analysis_session_follow_ups
          where session_id = $1
          order by created_at asc
        \`,
        [${JSON.stringify(sessionId)}],
      );

      console.log(JSON.stringify({
        sessions: sessionRows.rows,
        ownerSessionIds: ownerSessionRows.rows.map((row) => row.id),
        followUps: followUpRows.rows,
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

test('已有结论时，追问附着在原 session 上并默认复用上下文', async () => {
  const cookie = await login({
    employeeId: 'follow-up-owner',
    displayName: '追问拥有者',
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
        note: '追问前先修正时间范围',
      },
      targetMetric: {
        value: '收费回款率',
        note: '追问前先修正指标口径',
      },
    }),
  });

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-owner',
    organizationId: 'org-follow-up',
    projectIds: ['project-follow-up'],
    areaIds: ['area-follow-up'],
  });

  const pageResponse = await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(pageResponse.status, 200);
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, /继续追问/);
  assert.match(pageHtml, /默认沿用上一轮已确认的上下文/);
  assert.match(pageHtml, /物业服务/);

  const formData = new FormData();
  formData.set('question', '那物业服务为什么波动？');
  const stateBeforeFollowUp = await readFollowUpState(
    sessionId,
    'follow-up-owner',
  );

  const followUpResponse = await fetch(
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

  assert.equal(followUpResponse.status, 303);
  const location = followUpResponse.headers.get('location') ?? '';
  assert.match(
    location,
    new RegExp(`/workspace/analysis/${sessionId}\\?followUpId=[a-z0-9-]+`),
  );

  const followUpPage = await fetch(location, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(followUpPage.status, 200);
  const followUpHtml = await followUpPage.text();
  assert.match(followUpHtml, /追问已附着到当前会话/);
  assert.match(followUpHtml, /那物业服务为什么波动/);
  assert.match(followUpHtml, /近六个月/);

  const followUpState = await readFollowUpState(sessionId, 'follow-up-owner');
  assert.deepEqual(
    followUpState.ownerSessionIds,
    stateBeforeFollowUp.ownerSessionIds,
  );
  assert.equal(followUpState.followUps.length, 1);
  assert.equal(followUpState.followUps[0].session_id, sessionId);
  assert.equal(
    followUpState.followUps[0].question_text,
    '那物业服务为什么波动？',
  );
  assert.match(
    followUpState.followUps[0].referenced_execution_id,
    /^follow-up-execution-/,
  );
  assert.equal(
    followUpState.followUps[0].referenced_conclusion_title,
    '物业服务',
  );
  assert.equal(
    followUpState.followUps[0].inherited_context.timeRange.value,
    '近六个月',
  );
  assert.equal(
    followUpState.followUps[0].merged_context.targetMetric.value,
    '收费回款率',
  );
  assert.equal(
    followUpState.followUps[0].merged_context.timeRange.value,
    '近六个月',
  );
});

test('继续追问时会承接当前 active follow-up 的合并上下文，而不是回退到 session 基线', async () => {
  const cookie = await login({
    employeeId: 'follow-up-chain-owner',
    displayName: '多轮追问拥有者',
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
    ownerUserId: 'follow-up-chain-owner',
    organizationId: 'org-follow-up',
    projectIds: ['project-follow-up'],
    areaIds: ['area-follow-up'],
  });

  const initialFollowUp = await createFollowUp({
    cookie,
    sessionId,
    question: '那物业服务为什么波动？',
  });

  const adjustForm = new FormData();
  adjustForm.set('timeRange', '本月');
  adjustForm.set('factor', '物业服务');
  adjustForm.set('confirmConflicts', 'true');

  const adjustResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${initialFollowUp.followUpId}/context`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: adjustForm,
      redirect: 'manual',
    },
  );
  assert.equal(adjustResponse.status, 303);

  const chainedFollowUpForm = new FormData();
  chainedFollowUpForm.set('question', '继续看一下收费项结构');
  chainedFollowUpForm.set('parentFollowUpId', initialFollowUp.followUpId);

  const chainedResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: chainedFollowUpForm,
      redirect: 'manual',
    },
  );

  assert.equal(chainedResponse.status, 303);

  const followUpState = await readFollowUpState(sessionId, 'follow-up-chain-owner');
  assert.equal(followUpState.followUps.length, 2);
  assert.equal(
    followUpState.followUps[1].inherited_context.timeRange.value,
    '本月',
  );
  assert.ok(
    followUpState.followUps[1].inherited_context.constraints.some(
      (constraint) =>
        constraint.label === '候选因素' && constraint.value === '物业服务',
    ),
  );
  assert.equal(
    followUpState.followUps[1].referenced_execution_id,
    followUpState.followUps[0].referenced_execution_id,
  );
});

test('非 owner 不能向他人会话提交追问', async () => {
  const ownerCookie = await login({
    employeeId: 'follow-up-owner-2',
    displayName: '追问拥有者 2',
  });
  const intruderCookie = await login({
    employeeId: 'follow-up-intruder',
    displayName: '越权用户',
  });
  const sessionId = await createSession(
    ownerCookie,
    '为什么近三个月访客模式的投诉量上升了？',
  );

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-owner-2',
    organizationId: 'org-follow-up',
    projectIds: ['project-follow-up'],
    areaIds: ['area-follow-up'],
  });

  const formData = new FormData();
  formData.set('question', '继续看一下满意度呢？');

  const response = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups`,
    {
      method: 'POST',
      headers: {
        Cookie: intruderCookie,
      },
      body: formData,
      redirect: 'manual',
    },
  );

  assert.equal(response.status, 404);
  const data = await response.json();
  assert.equal(data.error, '会话不存在或无权访问。');

  const state = await readFollowUpState(sessionId, 'follow-up-owner-2');
  assert.equal(state.followUps.length, 0);
});

test('同一毫秒内创建的 follow-up 也会按稳定顺序返回，避免默认 active 分支漂移', async () => {
  const state = await runTsSnippet(`
    import followUpStoreModule from './src/infrastructure/analysis-session/postgres-analysis-session-follow-up-store.ts';

    const { createPostgresAnalysisSessionFollowUpStore } = followUpStoreModule;

    const store = createPostgresAnalysisSessionFollowUpStore();
    const sessionId = 'follow-up-order-session-' + crypto.randomUUID();
    const ownerUserId = 'follow-up-order-owner';
    const timestamp = '2026-04-09T00:00:00.000Z';
    const sharedContext = {
      targetMetric: { label: '目标指标', value: '收费回款率', state: 'confirmed' },
      entity: { label: '实体对象', value: '丰和园小区项目', state: 'confirmed' },
      timeRange: { label: '时间范围', value: '近三个月', state: 'confirmed' },
      comparison: { label: '比较方式', value: '待补充比较方式', state: 'missing' },
      constraints: [],
    };
    const firstId = 'follow-up-order-a-' + crypto.randomUUID();
    const secondId = 'follow-up-order-b-' + crypto.randomUUID();

    await store.create({
      id: firstId,
      sessionId,
      ownerUserId,
      questionText: '继续看物业服务',
      referencedExecutionId: 'execution-a',
      referencedConclusionTitle: '物业服务',
      referencedConclusionSummary: '物业服务是主因',
      inheritedContext: sharedContext,
      mergedContext: sharedContext,
      planVersion: null,
      currentPlanSnapshot: null,
      previousPlanSnapshot: null,
      currentPlanDiff: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await store.create({
      id: secondId,
      sessionId,
      ownerUserId,
      questionText: '继续看收费项结构',
      referencedExecutionId: 'execution-b',
      referencedConclusionTitle: '收费项结构',
      referencedConclusionSummary: '收费项结构需要继续分析',
      inheritedContext: sharedContext,
      mergedContext: sharedContext,
      planVersion: null,
      currentPlanSnapshot: null,
      previousPlanSnapshot: null,
      currentPlanDiff: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const listed = await store.listBySessionId({ sessionId, ownerUserId });
    const pgModule = await import('pg');
    const pool = new pgModule.Pool({
      connectionString: process.env.DATABASE_URL,
    });
    const rows = await pool.query(
      \`
        select id, created_order
        from platform.analysis_session_follow_ups
        where session_id = $1
        order by created_order asc
      \`,
      [sessionId],
    );
    await pool.end();

    console.log(JSON.stringify({
      listedIds: listed.map((followUp) => followUp.id),
      createdOrders: rows.rows.map((row) => Number(row.created_order)),
      insertedIds: [firstId, secondId],
    }));
  `);

  assert.deepEqual(state.listedIds, state.insertedIds);
  assert.equal(state.createdOrders.length, 2);
  assert.ok(state.createdOrders[0] < state.createdOrders[1]);
});
