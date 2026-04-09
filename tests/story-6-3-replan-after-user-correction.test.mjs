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
const TEST_SESSION_SECRET = 'story-6-3-test-secret';
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
        server.close(() => reject(new Error('Failed to resolve an available test port.')));
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
      throw new Error(`Next server exited early with code ${processHandle.exitCode}.`);
    }

    try {
      const response = await fetch(`${baseUrl}/`, { redirect: 'manual' });

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
  organizationId = 'org-follow-up-replan',
  projectIds = 'project-follow-up-replan',
  areaIds = 'area-follow-up-replan',
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

async function seedCompletedConclusion({ sessionId, ownerUserId }) {
  return await runTsSnippet(`
    import snapshotStoreModule from './src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store.ts';
    import persistenceUseCasesModule from './src/application/analysis-execution/persistence-use-cases.ts';

    const { createPostgresAnalysisExecutionSnapshotStore } = snapshotStoreModule;
    const { createAnalysisExecutionPersistenceUseCases } = persistenceUseCasesModule;

    const persistenceUseCases = createAnalysisExecutionPersistenceUseCases({
      snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
    });
    const executionId = 'follow-up-replan-' + crypto.randomUUID();
    const timestamp = new Date().toISOString();

    await persistenceUseCases.saveExecutionSnapshot({
      executionId,
      sessionId: ${JSON.stringify(sessionId)},
      ownerUserId: ${JSON.stringify(ownerUserId)},
      status: 'completed',
      planSnapshot: {
        mode: 'multi-step',
        summary: '这是本次复杂问题的计划骨架，系统会先确认口径，再逐步验证候选方向，最后汇总归因判断。',
        steps: [
          {
            id: 'confirm-analysis-scope',
            order: 1,
            title: '确认分析口径',
            objective: '确认收费回款率、丰和园小区项目和近三个月的分析边界，确保后续步骤基于同一口径推进。',
            dependencyIds: [],
          },
          {
            id: 'inspect-metric-change',
            order: 2,
            title: '校验核心指标波动',
            objective: '先验证收费回款率是否真实发生波动，并定位波动主要集中在哪些实体或时间切片。',
            dependencyIds: ['confirm-analysis-scope'],
          },
          {
            id: 'validate-candidate-factors',
            order: 3,
            title: '逐项验证候选因素',
            objective: '围绕收费政策触达、工单响应时效等候选方向逐项查证，识别哪些因素值得进入下一轮验证。',
            dependencyIds: ['confirm-analysis-scope', 'inspect-metric-change'],
          },
          {
            id: 'synthesize-attribution',
            order: 4,
            title: '汇总归因判断',
            objective: '汇总前序步骤形成的证据，整理出待验证的归因判断，并为后续执行与证据展示做好准备。',
            dependencyIds: ['inspect-metric-change', 'validate-candidate-factors'],
          },
        ],
      },
      events: [
        {
          id: 'event-1',
          sessionId: ${JSON.stringify(sessionId)},
          executionId,
          sequence: 1,
          kind: 'step-lifecycle',
          timestamp,
          step: {
            id: 'confirm-analysis-scope',
            order: 1,
            title: '确认分析口径',
            status: 'completed',
          },
          renderBlocks: [],
        },
        {
          id: 'event-2',
          sessionId: ${JSON.stringify(sessionId)},
          executionId,
          sequence: 2,
          kind: 'step-lifecycle',
          timestamp,
          step: {
            id: 'inspect-metric-change',
            order: 2,
            title: '校验核心指标波动',
            status: 'completed',
          },
          renderBlocks: [],
        },
        {
          id: 'event-3',
          sessionId: ${JSON.stringify(sessionId)},
          executionId,
          sequence: 3,
          kind: 'step-lifecycle',
          timestamp,
          step: {
            id: 'validate-candidate-factors',
            order: 3,
            title: '逐项验证候选因素',
            status: 'completed',
          },
          renderBlocks: [],
        },
      ],
      conclusionReadModel: {
        causes: [
          {
            id: 'cause-1',
            rank: 1,
            title: '物业服务',
            summary: '物业服务是当前主要原因。',
            confidence: 0.8,
            evidence: [],
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

async function updateFollowUpContext({
  cookie,
  sessionId,
  followUpId,
  factor,
}) {
  const formData = new FormData();
  formData.set('factor', factor);

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
}

async function readFollowUpPlanState(followUpId) {
  return await runTsSnippet(`
    import pg from 'pg';

    const pool = new pg.Pool({
      connectionString: ${JSON.stringify(TEST_DATABASE_URL)},
    });

    try {
      const rows = await pool.query(
        \`
          select
            id,
            plan_version,
            current_plan_snapshot,
            previous_plan_snapshot,
            current_plan_diff
          from platform.analysis_session_follow_ups
          where id = $1
        \`,
        [${JSON.stringify(followUpId)}],
      );

      console.log(JSON.stringify({
        followUp: rows.rows[0] ?? null,
      }));
    } finally {
      await pool.end();
    }
  `);
}

async function readExecutionJob(executionId) {
  return await runTsSnippet(`
    import redisClientModule from './src/infrastructure/redis/client.ts';
    import redisJobQueueModule from './src/infrastructure/job/redis-job-queue.ts';
    import jobUseCasesModule from './src/application/job/use-cases.ts';

    const { createRedisClient } = redisClientModule;
    const { createRedisJobQueue } = redisJobQueueModule;
    const { createJobUseCases } = jobUseCasesModule;

    const { redis } = createRedisClient();
    await redis.connect();

    try {
      const jobUseCases = createJobUseCases({
        jobQueue: createRedisJobQueue(redis),
      });
      const job = await jobUseCases.getJob(${JSON.stringify(executionId)});
      console.log(JSON.stringify(job));
    } finally {
      await redis.quit();
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

test('纠正 follow-up 上下文后可重生成新版本计划，并展示计划差异与可复用步骤', async () => {
  const cookie = await login({
    employeeId: 'follow-up-replan-owner',
    displayName: '重规划拥有者',
  });
  const sessionId = await createSession(
    cookie,
    '为什么近三个月丰和园小区项目的收费回款率下降了？',
  );

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-replan-owner',
  });

  const { followUpId } = await createFollowUp({
    cookie,
    sessionId,
    question: '继续看一下物业服务因素',
  });

  await updateFollowUpContext({
    cookie,
    sessionId,
    followUpId,
    factor: '物业服务',
  });

  const replanResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/replan`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      redirect: 'manual',
    },
  );

  assert.equal(replanResponse.status, 303);
  const location = replanResponse.headers.get('location') ?? '';
  assert.match(location, new RegExp(`followUpId=${followUpId}`));
  assert.match(location, /followUpReplanned=true/);

  const page = await fetch(location, {
    headers: {
      Cookie: cookie,
    },
  });
  const html = await page.text();
  assert.match(html, /重生成后续计划/);
  assert.match(html, /计划版本/);
  assert.match(html, /可复用步骤/);
  assert.match(html, /确认分析口径/);
  assert.match(html, /校验核心指标波动/);
  assert.match(html, /失效步骤/);
  assert.match(html, /逐项验证候选因素/);
  assert.match(html, /新增因素条件触发了计划重算/);

  const state = await readFollowUpPlanState(followUpId);
  assert.equal(state.followUp.plan_version, 2);
  assert.equal(state.followUp.current_plan_diff.reason, '新增因素条件触发了计划重算。');
  assert.ok(
    state.followUp.current_plan_diff.reusedSteps.some(
      (step) => step.stepId === 'confirm-analysis-scope',
    ),
  );
  assert.ok(
    state.followUp.current_plan_diff.invalidatedSteps.some(
      (step) => step.stepId === 'validate-candidate-factors',
    ),
  );
});

test('重规划后的执行入口会提交当前 follow-up 计划和 follow-up 问题', async () => {
  const cookie = await login({
    employeeId: 'follow-up-replan-exec-owner',
    displayName: '重规划执行拥有者',
  });
  const sessionId = await createSession(
    cookie,
    '为什么近三个月丰和园小区项目的收费回款率下降了？',
  );

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-replan-exec-owner',
  });

  const { followUpId } = await createFollowUp({
    cookie,
    sessionId,
    question: '继续看一下物业服务因素',
  });

  await updateFollowUpContext({
    cookie,
    sessionId,
    followUpId,
    factor: '物业服务',
  });

  const replanResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/replan`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      redirect: 'manual',
    },
  );
  assert.equal(replanResponse.status, 303);

  const executeForm = new FormData();
  executeForm.set('followUpId', followUpId);

  const executeResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/execute`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: executeForm,
      redirect: 'manual',
    },
  );

  assert.equal(executeResponse.status, 303);
  const location = executeResponse.headers.get('location') ?? '';
  const redirectUrl = new URL(location);
  const executionId = redirectUrl.searchParams.get('executionId');
  assert.ok(executionId);
  assert.equal(redirectUrl.searchParams.get('followUpId'), followUpId);

  const executionJob = await readExecutionJob(executionId);
  assert.equal(executionJob.data.questionText, '继续看一下物业服务因素');
  assert.match(
    executionJob.data.plan.steps[2].objective,
    /物业服务/,
  );

  const page = await fetch(location, {
    headers: {
      Cookie: cookie,
    },
  });
  const html = await page.text();
  assert.match(html, /已提交执行/);
  assert.match(html, /物业服务/);
});

test('同一 follow-up 第二次重规划仍保留原 execution 的可复用完成步骤', async () => {
  const cookie = await login({
    employeeId: 'follow-up-replan-repeat-owner',
    displayName: '重规划复用拥有者',
  });
  const sessionId = await createSession(
    cookie,
    '为什么近三个月丰和园小区项目的收费回款率下降了？',
  );

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-replan-repeat-owner',
  });

  const { followUpId } = await createFollowUp({
    cookie,
    sessionId,
    question: '继续看一下物业服务因素',
  });

  await updateFollowUpContext({
    cookie,
    sessionId,
    followUpId,
    factor: '物业服务',
  });

  const firstReplan = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/replan`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      redirect: 'manual',
    },
  );
  assert.equal(firstReplan.status, 303);

  await updateFollowUpContext({
    cookie,
    sessionId,
    followUpId,
    factor: '满意度评价',
  });

  const secondReplan = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/replan`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      redirect: 'manual',
    },
  );
  assert.equal(secondReplan.status, 303);

  const state = await readFollowUpPlanState(followUpId);
  assert.equal(state.followUp.plan_version, 3);
  assert.ok(
    state.followUp.current_plan_diff.reusedSteps.some(
      (step) => step.stepId === 'confirm-analysis-scope',
    ),
  );
  assert.ok(
    state.followUp.current_plan_diff.reusedSteps.some(
      (step) => step.stepId === 'inspect-metric-change',
    ),
  );
});

test('follow-up 上下文再次变化后会立即作废旧计划，并在下一次展示与执行时改用新条件', async () => {
  const cookie = await login({
    employeeId: 'follow-up-replan-stale-owner',
    displayName: '计划作废拥有者',
  });
  const sessionId = await createSession(
    cookie,
    '为什么近三个月丰和园小区项目的收费回款率下降了？',
  );

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-replan-stale-owner',
  });

  const { followUpId } = await createFollowUp({
    cookie,
    sessionId,
    question: '继续看一下物业服务因素',
  });

  await updateFollowUpContext({
    cookie,
    sessionId,
    followUpId,
    factor: '物业服务',
  });

  const firstReplan = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/replan`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      redirect: 'manual',
    },
  );
  assert.equal(firstReplan.status, 303);

  await updateFollowUpContext({
    cookie,
    sessionId,
    followUpId,
    factor: '满意度评价',
  });

  const invalidatedState = await readFollowUpPlanState(followUpId);
  assert.equal(invalidatedState.followUp.plan_version, 2);
  assert.equal(invalidatedState.followUp.current_plan_snapshot, null);
  assert.equal(invalidatedState.followUp.current_plan_diff, null);
  assert.ok(invalidatedState.followUp.previous_plan_snapshot);

  const page = await fetch(
    `${baseUrl}/workspace/analysis/${sessionId}?followUpId=${followUpId}`,
    {
      headers: {
        Cookie: cookie,
      },
    },
  );
  const html = await page.text();
  assert.match(html, /满意度评价/);
  assert.doesNotMatch(html, /计划版本 v2/);

  const executeForm = new FormData();
  executeForm.set('followUpId', followUpId);

  const executeResponse = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/execute`,
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: executeForm,
      redirect: 'manual',
    },
  );

  assert.equal(executeResponse.status, 303);
  const redirectUrl = new URL(executeResponse.headers.get('location') ?? '');
  const executionId = redirectUrl.searchParams.get('executionId');
  assert.ok(executionId);

  const executionJob = await readExecutionJob(executionId);
  assert.match(
    executionJob.data.plan.steps[2].objective,
    /满意度评价/,
  );
});

test('非 owner 不能触发他人 follow-up 的重规划', async () => {
  const ownerCookie = await login({
    employeeId: 'follow-up-replan-owner-2',
    displayName: '重规划拥有者 2',
  });
  const intruderCookie = await login({
    employeeId: 'follow-up-replan-intruder',
    displayName: '重规划越权用户',
  });
  const sessionId = await createSession(
    ownerCookie,
    '为什么近三个月访客模式的投诉量上升了？',
  );

  await seedCompletedConclusion({
    sessionId,
    ownerUserId: 'follow-up-replan-owner-2',
  });

  const { followUpId } = await createFollowUp({
    cookie: ownerCookie,
    sessionId,
    question: '继续看一下服务响应因素',
  });

  const response = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/follow-ups/${followUpId}/replan`,
    {
      method: 'POST',
      headers: {
        Cookie: intruderCookie,
      },
    },
  );

  assert.equal(response.status, 404);
  const data = await response.json();
  assert.equal(data.error, '会话不存在、追问不存在或无权访问。');
});
