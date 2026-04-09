import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { promisify } from 'node:util';

import { ensureAnalysisExecutionSnapshotsTable } from './helpers/ensure-analysis-execution-snapshots-table.mjs';
import { ensureFollowUpHistoryColumns } from './helpers/ensure-follow-up-history-columns.mjs';
import { ensureNextBuildReady } from './helpers/ensure-next-build-ready.mjs';

const execFileAsync = promisify(execFile);

let port;
let baseUrl;
let serverProcess;
const TEST_SESSION_SECRET = 'story-6-4-test-secret';
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
  organizationId = 'org-follow-up-history',
  projectIds = 'project-follow-up-history',
  areaIds = 'area-follow-up-history',
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

  return followUpId;
}

async function seedExecutionSnapshot({
  sessionId,
  ownerUserId,
  followUpId = null,
  planSummary,
  stepTitle,
  conclusionTitle,
  conclusionSummary,
  evidenceLabel,
  evidenceSummary,
}) {
  return await runTsSnippet(`
    import snapshotStoreModule from './src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store.ts';
    import persistenceUseCasesModule from './src/application/analysis-execution/persistence-use-cases.ts';
    import followUpStoreModule from './src/infrastructure/analysis-session/postgres-analysis-session-follow-up-store.ts';
    import followUpUseCasesModule from './src/application/follow-up/use-cases.ts';

    const { createPostgresAnalysisExecutionSnapshotStore } = snapshotStoreModule;
    const { createAnalysisExecutionPersistenceUseCases } = persistenceUseCasesModule;
    const { createPostgresAnalysisSessionFollowUpStore } = followUpStoreModule;
    const { createAnalysisFollowUpUseCases } = followUpUseCasesModule;

    const persistenceUseCases = createAnalysisExecutionPersistenceUseCases({
      snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
    });
    const followUpUseCases = createAnalysisFollowUpUseCases({
      followUpStore: createPostgresAnalysisSessionFollowUpStore(),
    });
    const executionId = 'history-execution-' + crypto.randomUUID();
    const timestamp = new Date().toISOString();

    await persistenceUseCases.saveExecutionSnapshot({
      executionId,
      sessionId: ${JSON.stringify(sessionId)},
      ownerUserId: ${JSON.stringify(ownerUserId)},
      followUpId: ${JSON.stringify(followUpId)},
      status: 'completed',
      planSnapshot: {
        mode: 'multi-step',
        summary: ${JSON.stringify(planSummary)},
        steps: [
          {
            id: 'step-1',
            order: 1,
            title: ${JSON.stringify(stepTitle)},
            objective: ${JSON.stringify(`${stepTitle} 的执行目标`)},
            dependencyIds: [],
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
          message: ${JSON.stringify(conclusionSummary)},
          step: {
            id: 'step-1',
            order: 1,
            title: ${JSON.stringify(stepTitle)},
            status: 'completed',
          },
          renderBlocks: [
            {
              type: 'markdown',
              title: '结构化分析摘要',
              content: ${JSON.stringify(conclusionSummary)},
            },
          ],
          metadata: {
            conclusionText: ${JSON.stringify(conclusionTitle)},
            conclusionSummary: ${JSON.stringify(conclusionSummary)},
            conclusionConfidence: 0.88,
            conclusionEvidence: [
              {
                label: ${JSON.stringify(evidenceLabel)},
                summary: ${JSON.stringify(evidenceSummary)},
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
            confidence: 0.88,
            evidence: [
              {
                label: ${JSON.stringify(evidenceLabel)},
                summary: ${JSON.stringify(evidenceSummary)},
              },
            ],
          },
        ],
        renderBlocks: [],
      },
    });

    if (${JSON.stringify(followUpId)}) {
      await followUpUseCases.attachFollowUpExecution({
        followUpId: ${JSON.stringify(followUpId)},
        ownerUserId: ${JSON.stringify(ownerUserId)},
        executionId,
      });
    }

    console.log(JSON.stringify({ executionId }));
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
  await ensureFollowUpHistoryColumns(TEST_DATABASE_URL);

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

test('Story 6.4 会展示多轮历史，并区分最新结论与历史结论', async () => {
  const cookie = await login({
    employeeId: 'follow-up-history-owner',
    displayName: '历史轮次拥有者',
  });
  const sessionId = await createSession(
    cookie,
    '为什么近三个月丰和园小区项目的收费回款率下降了？',
  );

  await seedExecutionSnapshot({
    sessionId,
    ownerUserId: 'follow-up-history-owner',
    planSummary: '初始轮计划摘要：先确认收费口径，再定位主因。',
    stepTitle: '初始轮校验收费口径',
    conclusionTitle: '物业服务',
    conclusionSummary: '初始轮结论：物业服务是首个可疑原因。',
    evidenceLabel: '初始轮证据',
    evidenceSummary: '收费回款率在近三个月持续偏离基线。',
  });

  const firstFollowUpId = await createFollowUp({
    cookie,
    sessionId,
    question: '继续看一下物业服务为什么波动',
  });
  await seedExecutionSnapshot({
    sessionId,
    ownerUserId: 'follow-up-history-owner',
    followUpId: firstFollowUpId,
    planSummary: '第一轮计划摘要：验证物业服务与工单响应的关系。',
    stepTitle: '第一轮验证物业服务波动',
    conclusionTitle: '物业服务响应下降',
    conclusionSummary: '第一轮结论：物业服务响应下降是本轮主因。',
    evidenceLabel: '第一轮证据',
    evidenceSummary: '近三个月工单积压与收费回款率下降同步出现。',
  });

  const secondFollowUpId = await createFollowUp({
    cookie,
    sessionId,
    parentFollowUpId: firstFollowUpId,
    question: '再看一下满意度评价与收费波动的关系',
  });
  await seedExecutionSnapshot({
    sessionId,
    ownerUserId: 'follow-up-history-owner',
    followUpId: secondFollowUpId,
    planSummary: '第二轮计划摘要：验证满意度评价与回款波动的关联。',
    stepTitle: '第二轮验证满意度评价',
    conclusionTitle: '满意度评价恶化',
    conclusionSummary: '第二轮结论：满意度评价恶化是最新主因。',
    evidenceLabel: '第二轮证据',
    evidenceSummary: '满意度低分与收费回款率下降时间窗口高度重合。',
  });

  const page = await fetch(
    `${baseUrl}/workspace/analysis/${sessionId}?followUpId=${secondFollowUpId}`,
    {
      headers: {
        Cookie: cookie,
      },
    },
  );

  const html = await page.text();

  assert.match(html, /data-testid="analysis-history-panel"/);
  assert.match(html, /轮次历史与结论演化/);
  assert.match(html, /初始分析/);
  assert.match(html, /第 1 轮追问/);
  assert.match(html, /第 2 轮追问/);
  assert.match(html, /最新结论/);
  assert.match(html, /历史结论/);
  assert.match(html, /第二轮结论：满意度评价恶化是最新主因。/);
  assert.match(html, /第二轮计划摘要：验证满意度评价与回款波动的关联。/);
});

test('Story 6.4 切到历史轮次时会展示该轮计划与证据，且不会被新一轮覆盖', async () => {
  const cookie = await login({
    employeeId: 'follow-up-history-owner-2',
    displayName: '历史轮次拥有者 2',
  });
  const sessionId = await createSession(
    cookie,
    '为什么近三个月访客模式的投诉量上升了？',
  );

  await seedExecutionSnapshot({
    sessionId,
    ownerUserId: 'follow-up-history-owner-2',
    planSummary: '初始轮计划摘要：确认投诉量变化口径。',
    stepTitle: '初始轮确认投诉口径',
    conclusionTitle: '服务响应压力',
    conclusionSummary: '初始轮结论：服务响应压力需要继续追问。',
    evidenceLabel: '初始轮证据',
    evidenceSummary: '投诉量和处理超时率同步上升。',
  });

  const firstFollowUpId = await createFollowUp({
    cookie,
    sessionId,
    question: '继续看一下工单处理超时',
  });
  await seedExecutionSnapshot({
    sessionId,
    ownerUserId: 'follow-up-history-owner-2',
    followUpId: firstFollowUpId,
    planSummary: '第一轮计划摘要：核对工单处理超时与投诉量关系。',
    stepTitle: '第一轮核对工单超时',
    conclusionTitle: '工单处理超时',
    conclusionSummary: '第一轮结论：工单处理超时是本轮主要发现。',
    evidenceLabel: '第一轮证据',
    evidenceSummary: '超时工单占比在投诉高峰期明显抬升。',
  });

  const secondFollowUpId = await createFollowUp({
    cookie,
    sessionId,
    parentFollowUpId: firstFollowUpId,
    question: '再看一下满意度回访是否也有问题',
  });
  await seedExecutionSnapshot({
    sessionId,
    ownerUserId: 'follow-up-history-owner-2',
    followUpId: secondFollowUpId,
    planSummary: '第二轮计划摘要：核对满意度回访缺口。',
    stepTitle: '第二轮核对满意度回访',
    conclusionTitle: '满意度回访缺口',
    conclusionSummary: '第二轮结论：满意度回访缺口是最新发现。',
    evidenceLabel: '第二轮证据',
    evidenceSummary: '回访缺失集中出现在投诉高峰后的两周。',
  });

  const historyPage = await fetch(
    `${baseUrl}/workspace/analysis/${sessionId}?followUpId=${secondFollowUpId}&historyRoundId=${firstFollowUpId}`,
    {
      headers: {
        Cookie: cookie,
      },
    },
  );

  const html = await historyPage.text();

  assert.match(html, /当前查看轮次/);
  assert.match(html, /历史轮次/);
  assert.match(html, /第一轮计划摘要：核对工单处理超时与投诉量关系。/);
  assert.match(html, /第一轮证据/);
  assert.match(html, /超时工单占比在投诉高峰期明显抬升。/);
  assert.match(html, /第一轮结论：工单处理超时是本轮主要发现。/);

  const historyState = await runTsSnippet(`
    import sessionStoreModule from './src/infrastructure/analysis-session/postgres-analysis-session-store.ts';
    import followUpStoreModule from './src/infrastructure/analysis-session/postgres-analysis-session-follow-up-store.ts';
    import snapshotStoreModule from './src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store.ts';
    import analysisContextModule from './src/infrastructure/analysis-context/index.ts';
    import historyUseCasesModule from './src/application/analysis-history/use-cases.ts';

    const { createPostgresAnalysisSessionStore } = sessionStoreModule;
    const { createPostgresAnalysisSessionFollowUpStore } = followUpStoreModule;
    const { createPostgresAnalysisExecutionSnapshotStore } = snapshotStoreModule;
    const { analysisContextUseCases } = analysisContextModule;
    const { analysisHistoryUseCases } = historyUseCasesModule;

    const sessionStore = createPostgresAnalysisSessionStore();
    const followUpStore = createPostgresAnalysisSessionFollowUpStore();
    const snapshotStore = createPostgresAnalysisExecutionSnapshotStore();

    const session = await sessionStore.getById(${JSON.stringify(sessionId)});
    const followUps = await followUpStore.listBySessionId({
      sessionId: ${JSON.stringify(sessionId)},
      ownerUserId: 'follow-up-history-owner-2',
    });
    const snapshots = await snapshotStore.listBySessionId(${JSON.stringify(sessionId)});
    const contextReadModel = await analysisContextUseCases.getCurrentContext({
      sessionId: ${JSON.stringify(sessionId)},
      questionText: session.questionText,
      savedContext: session.savedContext,
    });
    const readModel = analysisHistoryUseCases.buildHistoryReadModel({
      session,
      sessionContext: contextReadModel.context,
      followUps,
      snapshots,
      selectedRoundId: ${JSON.stringify(firstFollowUpId)},
    });

    console.log(JSON.stringify({
      latestRoundId: readModel.latestRoundId,
      selectedRound: readModel.selectedRound,
      firstRound: readModel.rounds.find((round) => round.id === ${JSON.stringify(firstFollowUpId)}),
      secondRound: readModel.rounds.find((round) => round.id === ${JSON.stringify(secondFollowUpId)}),
    }));
  `);

  assert.equal(historyState.latestRoundId, secondFollowUpId);
  assert.equal(historyState.selectedRound.id, firstFollowUpId);
  assert.equal(
    historyState.firstRound.planSummary,
    '第一轮计划摘要：核对工单处理超时与投诉量关系。',
  );
  assert.equal(
    historyState.firstRound.evidence[0].summary,
    '超时工单占比在投诉高峰期明显抬升。',
  );
  assert.equal(
    historyState.secondRound.planSummary,
    '第二轮计划摘要：核对满意度回访缺口。',
  );
  assert.equal(
    historyState.secondRound.evidence[0].summary,
    '回访缺失集中出现在投诉高峰后的两周。',
  );
});
