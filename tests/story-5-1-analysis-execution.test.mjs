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
const TEST_SESSION_SECRET = 'story-5-1-test-secret';
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
  employeeId = 'exec-u-1',
  displayName = '执行测试员',
  organizationId = 'org-exec',
  projectIds = 'project-exec',
  areaIds = 'area-exec',
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
});

test.after(async () => {
  if (!serverProcess) {
    return;
  }

  serverProcess.kill('SIGINT');
  await once(serverProcess, 'exit');
});

test('会话页在存在计划时提供开始执行分析入口', async () => {
  const cookie = await login();
  const sessionId = await createSession(
    cookie,
    '为什么本月所有项目的收缴率排名发生变化了？',
  );

  const response = await fetch(`${baseUrl}/workspace/analysis/${sessionId}`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /开始执行分析/);
  assert.match(html, /系统会将当前计划提交到后台执行/);
});

test('提交执行后会创建 execution record，并把用户带回会话页展示当前状态', async () => {
  const cookie = await login({
    employeeId: 'exec-u-owner',
    displayName: '执行拥有者',
  });
  const sessionId = await createSession(
    cookie,
    '为什么本月项目 moon 的收费回款率下降了？',
  );

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
  assert.match(
    location,
    new RegExp(`/workspace/analysis/${sessionId}\\?executionId=[a-z0-9-]+`),
  );

  const redirectUrl = new URL(location);
  const executionId = redirectUrl.searchParams.get('executionId');
  assert.ok(executionId, '重定向地址应包含 executionId');

  const pageResponse = await fetch(location, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(pageResponse.status, 200);
  const html = await pageResponse.text();

  assert.match(html, /已提交执行/);
  assert.match(html, /执行任务已进入后台队列/);
  assert.match(html, new RegExp(executionId));

  const executionRecord = await runTsSnippet(`
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

  assert.equal(executionRecord.type, 'analysis-execution');
  assert.equal(executionRecord.data.sessionId, sessionId);
  assert.equal(executionRecord.data.ownerUserId, 'exec-u-owner');
  assert.ok(Array.isArray(executionRecord.data.plan.steps));
  assert.deepEqual(
    executionRecord.data.plan.steps.map((step) => step.order),
    executionRecord.data.plan.steps.map((_, index) => index + 1),
  );
});

test('其他用户不能为不属于自己的会话提交执行', async () => {
  const ownerCookie = await login({
    employeeId: 'exec-owner',
    displayName: '执行拥有者',
  });
  const intruderCookie = await login({
    employeeId: 'exec-intruder',
    displayName: '执行闯入者',
  });
  const sessionId = await createSession(
    ownerCookie,
    '为什么本月项目 moon 的收费回款率下降了？',
  );

  const response = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/execute`,
    {
      method: 'POST',
      headers: {
        Cookie: intruderCookie,
      },
      redirect: 'manual',
    },
  );

  assert.equal(response.status, 404);
});

test('非法计划会被稳定拒绝，不会进入执行队列', async () => {
  const result = await runTsSnippet(`
    import submissionModule from './src/application/analysis-execution/submission-use-cases.ts';

    const { createAnalysisExecutionSubmissionUseCases } = submissionModule;

    const useCases = createAnalysisExecutionSubmissionUseCases({
      jobUseCases: {
        async submitJob() {
          throw new Error('不应为非法计划提交任务');
        },
        async getJob() {
          return null;
        },
      },
    });

    try {
      await useCases.submitExecution({
        session: {
          id: 'session-invalid',
          ownerUserId: 'owner-1',
          organizationId: 'org-1',
          projectIds: ['project-1'],
          areaIds: ['area-1'],
          questionText: '测试非法计划',
          savedContext: {},
          status: 'pending',
          createdAt: '2026-04-07T00:00:00.000Z',
          updatedAt: '2026-04-07T00:00:00.000Z',
        },
        plan: {
          mode: 'minimal',
          summary: '非法计划',
          steps: [],
        },
      });
    } catch (error) {
      console.log(JSON.stringify({
        name: error.name,
        message: error.message,
      }));
    }
  `);

  assert.equal(result.name, 'InvalidAnalysisExecutionPlanError');
  assert.match(result.message, /至少包含一个步骤/);
});

test('队列已提交后首条状态事件发布失败不会误报为执行提交失败', async () => {
  const result = await runTsSnippet(`
    import submissionModule from './src/application/analysis-execution/submission-use-cases.ts';

    const { createAnalysisExecutionSubmissionUseCases } = submissionModule;
    const callOrder = [];

    const useCases = createAnalysisExecutionSubmissionUseCases({
      jobUseCases: {
        async submitJob() {
          callOrder.push('submit-job');
          return {
            id: 'job-stream-failure',
            type: 'analysis-execution',
            status: 'pending',
            data: {},
            result: null,
            error: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            updatedAt: '2026-04-08T00:00:00.000Z',
          };
        },
        async getJob() {
          return null;
        },
      },
      analysisExecutionStreamUseCases: {
        async publishExecutionStatus() {
          callOrder.push('publish-status');
          throw new Error('stream unavailable');
        },
      },
    });

    const execution = await useCases.submitExecution({
      session: {
        id: 'session-stream-failure',
        ownerUserId: 'owner-1',
        organizationId: 'org-1',
        projectIds: ['project-1'],
        areaIds: ['area-1'],
        questionText: '测试已入队后状态发布失败',
        savedContext: {},
        status: 'pending',
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      plan: {
        mode: 'minimal',
        summary: '可执行计划',
        steps: [
          {
            id: 'step-1',
            order: 1,
            title: '步骤一',
            objective: '验证提交路径',
            dependencyIds: [],
          },
        ],
      },
    });

    console.log(JSON.stringify({
      executionId: execution.executionId,
      status: execution.status,
      callOrder,
    }));
  `);

  assert.equal(result.executionId, 'job-stream-failure');
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.callOrder, ['submit-job', 'publish-status']);
});

test('执行已完成后的流式副作用失败不会把成功路径重新标成失败', async () => {
  const result = await runTsSnippet(`
    import finalizationModule from './src/worker/finalize-analysis-execution.ts';

    const { finalizeSuccessfulAnalysisExecution } = finalizationModule;
    const callOrder = [];

    const outcome = await finalizeSuccessfulAnalysisExecution({
      job: {
        id: 'job-completed',
        type: 'analysis-execution',
        status: 'processing',
        data: {
          sessionId: 'session-1',
          ownerUserId: 'owner-1',
          organizationId: 'org-1',
          projectIds: ['project-1'],
          areaIds: ['area-1'],
          questionText: '测试完成态后处理',
          submittedAt: '2026-04-08T00:00:00.000Z',
          plan: {
            mode: 'minimal',
            summary: '完成态计划',
            steps: [
              {
                id: 'step-1',
                order: 1,
                title: '步骤一',
                objective: '验证完成态后处理',
                dependencyIds: [],
              },
            ],
          },
        },
        result: null,
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      result: {
        processedStepCount: 1,
      },
      jobUseCases: {
        async completeJob(jobId, completionResult) {
          callOrder.push(['complete-job', jobId, completionResult.processedStepCount]);
        },
      },
      analysisExecutionStreamUseCases: {
        async publishExecutionStatus() {
          callOrder.push(['publish-completed']);
          throw new Error('terminal stream publish failed');
        },
        async listExecutionEvents() {
          callOrder.push(['list-events']);
          return [];
        },
      },
      analysisExecutionPersistenceUseCases: {
        async saveExecutionSnapshot() {
          callOrder.push(['save-snapshot']);
        },
      },
    });

    console.log(JSON.stringify({
      callOrder,
      postCompletionError: outcome.postCompletionError,
    }));
  `);

  assert.deepEqual(result.callOrder, [
    ['complete-job', 'job-completed', 1],
    ['publish-completed'],
  ]);
  assert.match(result.postCompletionError, /terminal stream publish failed/);
});

test('execution 仍在执行时会使用任务里的计划快照作为页面计划来源', async () => {
  const result = await runTsSnippet(`
    import displayModule from './src/app/(workspace)/workspace/analysis/[sessionId]/analysis-execution-display.ts';

    const { getSessionScopedExecutionJob } = displayModule;

    const executionJob = getSessionScopedExecutionJob(
      {
        id: 'job-in-flight',
        type: 'analysis-execution',
        status: 'processing',
        data: {
          sessionId: 'session-1',
          ownerUserId: 'owner-1',
          organizationId: 'org-1',
          projectIds: ['project-1'],
          areaIds: ['area-1'],
          questionText: '为什么收缴率变化了？',
          submittedAt: '2026-04-08T00:00:00.000Z',
          plan: {
            mode: 'multi-step',
            summary: '提交时锁定的计划摘要',
            steps: [
              {
                id: 'submitted-step',
                order: 1,
                title: '提交时步骤',
                objective: '必须回放提交时的计划快照',
                dependencyIds: [],
              },
            ],
          },
        },
        result: null,
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        sessionId: 'session-1',
        ownerUserId: 'owner-1',
      },
    );

    console.log(JSON.stringify({
      executionId: executionJob?.executionId ?? null,
      summary: executionJob?.planSnapshot.summary ?? null,
      firstStepTitle: executionJob?.planSnapshot.steps[0]?.title ?? null,
    }));
  `);

  assert.equal(result.executionId, 'job-in-flight');
  assert.equal(result.summary, '提交时锁定的计划摘要');
  assert.equal(result.firstStepTitle, '提交时步骤');
});

test('analysis execution handler 会通过真实 orchestration bridge 执行步骤并回传真实工具结果', async () => {
  const result = await runTsSnippet(`
    import handlersModule from './src/worker/handlers.ts';

    const { createAnalysisExecutionJobHandler } = handlersModule;
    const publishedEvents = [];
    const executeCalls = [];

    const handler = createAnalysisExecutionJobHandler({
      analysisSessionStore: {
        async getById(sessionId) {
          return {
            id: sessionId,
            ownerUserId: 'owner-1',
            organizationId: 'org-1',
            projectIds: ['project-1'],
            areaIds: ['area-1'],
            questionText: '为什么本月收费回款率下降了？',
            savedContext: {
              targetMetric: { label: '目标指标', value: '收费回款率', state: 'confirmed' },
              entity: { label: '实体对象', value: '项目 moon', state: 'confirmed' },
              timeRange: { label: '时间范围', value: '本月', state: 'confirmed' },
              comparison: { label: '比较方式', value: '同比', state: 'confirmed' },
              constraints: [],
            },
            status: 'pending',
            createdAt: '2026-04-08T00:00:00.000Z',
            updatedAt: '2026-04-08T00:00:00.000Z',
          };
        },
      },
      analysisExecutionUseCases: {
        async executeStep(input) {
          executeCalls.push({
            stepId: input.stepId,
            metric: input.toolInputsByName['cube.semantic-query']?.metric ?? null,
            entity: input.toolInputsByName['neo4j.graph-query']?.entity ?? null,
            erpResource: input.toolInputsByName['erp.read-model']?.resource ?? null,
            llmTaskType: input.toolInputsByName['llm.structured-analysis']?.taskType ?? null,
          });

          return {
            status: 'completed',
            strategy: '真实 bridge 结果',
            tools: [
              {
                toolName: 'cube.semantic-query',
                objective: '验证核心指标波动',
                confidence: 0.93,
              },
            ],
            events: [
              {
                ok: true,
                toolName: 'cube.semantic-query',
                correlationId: 'corr-1',
                startedAt: '2026-04-08T00:00:00.000Z',
                finishedAt: '2026-04-08T00:00:01.000Z',
                output: {
                  metric: 'collection-rate',
                  rowCount: 1,
                  rows: [
                    {
                      value: 0.74,
                      time: '2026-04',
                      dimensions: {
                        'project-name': '项目 moon',
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      },
      analysisExecutionStreamUseCases: {
        async publishEvent(event) {
          publishedEvents.push(event);
          return event;
        },
      },
    });

    const outcome = await handler(
      {
        id: 'job-real-handler',
        type: 'analysis-execution',
        status: 'processing',
        data: {
          sessionId: 'session-real-handler',
          ownerUserId: 'owner-1',
          organizationId: 'org-1',
          projectIds: ['project-1'],
          areaIds: ['area-1'],
          questionText: '为什么本月收费回款率下降了？',
          submittedAt: '2026-04-08T00:00:00.000Z',
          plan: {
            mode: 'multi-step',
            summary: '先确认口径，再查指标。',
            steps: [
              {
                id: 'inspect-metric-change',
                order: 1,
                title: '校验核心指标波动',
                objective: '验证收费回款率是否真实下降',
                dependencyIds: [],
              },
            ],
          },
        },
        result: null,
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        redis: null,
      },
    );

    console.log(JSON.stringify({
      processedStepCount: outcome.processedStepCount,
      executeCalls,
      publishedKinds: publishedEvents.map((event) => event.kind),
      stageToolName:
        publishedEvents[1]?.renderBlocks.find((block) => block.type === 'tool-list')?.items[0]?.toolName ?? null,
      stageHasMetricTable:
        publishedEvents[1]?.renderBlocks.some((block) => block.type === 'table' && block.title === '指标结果') ?? false,
    }));
  `);

  assert.equal(result.processedStepCount, 1);
  assert.equal(result.executeCalls.length, 1);
  assert.equal(result.executeCalls[0].stepId, 'inspect-metric-change');
  assert.equal(result.executeCalls[0].metric, 'collection-rate');
  assert.equal(result.executeCalls[0].entity, '项目 moon');
  assert.equal(result.executeCalls[0].erpResource, 'receivables');
  assert.equal(result.executeCalls[0].llmTaskType, 'conclusion-summary');
  assert.deepEqual(result.publishedKinds, ['step-lifecycle', 'stage-result']);
  assert.equal(result.stageToolName, 'cube.semantic-query');
  assert.equal(result.stageHasMetricTable, true);
});

test('analysis execution handler 会在 worker 侧重新校验 job data，拒绝脏 planSnapshot', async () => {
  const result = await runTsSnippet(`
    import handlersModule from './src/worker/handlers.ts';

    const { createAnalysisExecutionJobHandler } = handlersModule;

    const handler = createAnalysisExecutionJobHandler({
      analysisSessionStore: {
        async getById(sessionId) {
          return {
            id: sessionId,
            ownerUserId: 'owner-1',
            organizationId: 'org-1',
            projectIds: ['project-1'],
            areaIds: ['area-1'],
            questionText: '为什么本月收费回款率下降了？',
            savedContext: {
              targetMetric: { label: '目标指标', value: '收费回款率', state: 'confirmed' },
              entity: { label: '实体对象', value: '项目 moon', state: 'confirmed' },
              timeRange: { label: '时间范围', value: '本月', state: 'confirmed' },
              comparison: { label: '比较方式', value: '同比', state: 'confirmed' },
              constraints: [],
            },
            status: 'pending',
            createdAt: '2026-04-08T00:00:00.000Z',
            updatedAt: '2026-04-08T00:00:00.000Z',
          };
        },
      },
      analysisExecutionUseCases: {
        async executeStep() {
          throw new Error('不应执行到 orchestration');
        },
      },
      analysisExecutionStreamUseCases: {
        async publishEvent() {
          throw new Error('不应发布事件');
        },
      },
    });

    try {
      await handler(
        {
          id: 'job-invalid-plan',
          type: 'analysis-execution',
          status: 'processing',
          data: {
            sessionId: 'session-invalid-plan',
            ownerUserId: 'owner-1',
            organizationId: 'org-1',
            projectIds: ['project-1'],
            areaIds: ['area-1'],
            questionText: '为什么本月收费回款率下降了？',
            submittedAt: '2026-04-08T00:00:00.000Z',
            plan: {
              mode: 'minimal',
              summary: '非法计划',
              steps: [],
            },
          },
          result: null,
          error: null,
          createdAt: '2026-04-08T00:00:00.000Z',
          updatedAt: '2026-04-08T00:00:00.000Z',
        },
        {
          redis: null,
        },
      );
    } catch (error) {
      console.log(JSON.stringify({
        name: error.name,
        message: error.message,
      }));
    }
  `);

  assert.equal(result.name, 'InvalidAnalysisExecutionPlanError');
  assert.match(result.message, /至少包含一个步骤/);
});
