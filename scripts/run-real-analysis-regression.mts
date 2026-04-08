import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { promisify } from 'node:util';

import nextEnvModule from '@next/env';
import { Pool } from 'pg';
import { createClient } from 'redis';

import * as snapshotStoreModule from '../src/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import * as sessionStoreModule from '../src/infrastructure/session/postgres-session-store';
import * as sessionCookieModule from '../src/infrastructure/session/session-cookie';

const { loadEnvConfig } = nextEnvModule;

function resolveModuleExport<T extends Record<string, unknown>>(
  moduleNamespace: T,
): T {
  const defaultExport = (moduleNamespace as T & { default?: T }).default;

  return defaultExport ?? moduleNamespace;
}

const { createPostgresAnalysisExecutionSnapshotStore } =
  resolveModuleExport(snapshotStoreModule);
const { createPostgresSessionStore } = resolveModuleExport(sessionStoreModule);
const { createSessionCookieValue, getSessionCookieName } =
  resolveModuleExport(sessionCookieModule);

loadEnvConfig(process.cwd());

const execFileAsync = promisify(execFile);

type RealCase = {
  caseId: string;
  direction: 'billing-pressure' | 'service-pressure' | 'healthy-collection';
  organizationId: string;
  projectId: string;
  projectName: string;
  areaId: string;
  areaName: string;
  questionText: string;
  evidence: Record<string, number | string | null>;
};

type ExecutionSummary = {
  caseId: string;
  direction: RealCase['direction'];
  projectId: string;
  projectName: string;
  questionText: string;
  executionId: string;
  sessionId: string;
  streamTerminalStatus: 'completed' | 'failed';
  jobStatus: string | null;
  snapshotStatus: string | null;
  publishedEventCount: number;
  persistedStepCount: number;
  topCauseSummary: string | null;
  failurePointTitle: string | null;
};

function ensureEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required to run the real analysis regression.`);
  }

  return value;
}

const DATABASE_URL = ensureEnv('DATABASE_URL');
const REDIS_URL = ensureEnv('REDIS_URL');
const SESSION_SECRET = ensureEnv('SESSION_SECRET');
const BASE_REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX?.trim() || 'dip3';

function getAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve a free port.')));
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

async function waitForHttpReady(baseUrl: string, processHandle: ReturnType<typeof spawn>) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30_000) {
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

async function waitForWorkerReady(processHandle: ReturnType<typeof spawn>) {
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';

  processHandle.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  processHandle.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  while (Date.now() - startedAt < 30_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Worker exited early with code ${processHandle.exitCode}.\n${stdout}\n${stderr}`,
      );
    }

    if (stdout.includes('开始轮询任务队列')) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Worker did not become ready in time.\n${stdout}\n${stderr}`);
}

function buildCaseQuestion(caseRecord: Omit<RealCase, 'questionText' | 'caseId'>) {
  switch (caseRecord.direction) {
    case 'billing-pressure':
      return `近三个月${caseRecord.projectName}的收缴率和欠费压力为什么异常？请结合应收、实收、欠费与相关服务信号分析原因。`;
    case 'service-pressure':
      return `近三个月${caseRecord.projectName}的投诉工单和满意度为什么异常？请结合工单量、投诉与满意度分析原因。`;
    case 'healthy-collection':
      return `近三个月${caseRecord.projectName}的回款表现有什么特点？请结合应收、实收与欠费分析。`;
    default:
      return `近三个月${caseRecord.projectName}的经营表现为什么变化？`;
  }
}

async function selectRealCases() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  try {
    const billingRes = await pool.query<{
      project_id: string;
      project_name: string;
      organization_id: string;
      area_id: string | null;
      area_name: string | null;
      charge_rows: string;
      receivable_sum: string;
      paid_sum: string;
      paid_ratio: string;
      service_rows: string;
      complaint_rows: string;
    }>(`
      with charge as (
        select
          c.precinct_id as project_id,
          max(c.precinct_name) as project_name,
          max(c.organization_id) as organization_id,
          count(*) as charge_rows,
          sum(coalesce(c.charge_sum, 0)) as receivable_sum,
          sum(coalesce(c.paid_charge_sum, 0)) as paid_sum,
          case
            when sum(coalesce(c.charge_sum, 0)) = 0 then 0
            else sum(coalesce(c.paid_charge_sum, 0)) / sum(coalesce(c.charge_sum, 0))
          end as paid_ratio
        from erp_staging.dw_datacenter_charge c
        where c.precinct_id is not null
        group by c.precinct_id
      ),
      service as (
        select
          s.precinct_id as project_id,
          count(*) as service_rows,
          count(*) filter (where coalesce(s.service_style_name, '') like '%投诉%') as complaint_rows
        from erp_staging.dw_datacenter_services s
        where s.precinct_id is not null
        group by s.precinct_id
      )
      select
        charge.project_id,
        charge.project_name,
        charge.organization_id,
        max(p.area_id) as area_id,
        max(p.area_name) as area_name,
        charge.charge_rows::text,
        round(charge.receivable_sum::numeric, 2)::text as receivable_sum,
        round(charge.paid_sum::numeric, 2)::text as paid_sum,
        round(charge.paid_ratio::numeric, 4)::text as paid_ratio,
        coalesce(service.service_rows, 0)::text as service_rows,
        coalesce(service.complaint_rows, 0)::text as complaint_rows
      from charge
      left join service on service.project_id = charge.project_id
      left join erp_staging.dw_datacenter_precinct p on p.precinct_id = charge.project_id
      where charge.charge_rows >= 100
      group by
        charge.project_id,
        charge.project_name,
        charge.organization_id,
        charge.charge_rows,
        charge.receivable_sum,
        charge.paid_sum,
        charge.paid_ratio,
        service.service_rows,
        service.complaint_rows
      order by charge.charge_rows desc
      limit 50;
    `);

    const serviceRes = await pool.query<{
      project_id: string;
      project_name: string;
      organization_id: string;
      area_id: string | null;
      area_name: string | null;
      service_rows: string;
      complaint_rows: string;
      low_satisfaction_rows: string;
    }>(`
      select
        s.precinct_id as project_id,
        max(s.precinct_name) as project_name,
        max(s.organization_id) as organization_id,
        max(p.area_id) as area_id,
        max(p.area_name) as area_name,
        count(*)::text as service_rows,
        count(*) filter (where coalesce(s.service_style_name, '') like '%投诉%')::text as complaint_rows,
        count(*) filter (where coalesce(s.satisfaction_eval, 0) <= 2)::text as low_satisfaction_rows
      from erp_staging.dw_datacenter_services s
      left join erp_staging.dw_datacenter_precinct p on p.precinct_id = s.precinct_id
      where s.precinct_id is not null
      group by s.precinct_id
      having count(*) >= 100
      order by
        count(*) filter (where coalesce(s.service_style_name, '') like '%投诉%') desc,
        count(*) desc
      limit 50;
    `);

    const usedProjects = new Set<string>();
    const cases: RealCase[] = [];

    const billingPressure = billingRes.rows.find((row) => {
      const paidRatio = Number(row.paid_ratio);
      return (
        row.project_id &&
        row.organization_id &&
        row.area_id &&
        !usedProjects.has(row.project_id) &&
        paidRatio <= 0.15
      );
    });

    if (!billingPressure) {
      throw new Error('Failed to select a billing-pressure real case from PG data.');
    }

    usedProjects.add(billingPressure.project_id);
    cases.push({
      caseId: 'billing-pressure',
      direction: 'billing-pressure',
      organizationId: billingPressure.organization_id,
      projectId: billingPressure.project_id,
      projectName: billingPressure.project_name,
      areaId: billingPressure.area_id ?? '',
      areaName: billingPressure.area_name ?? '未知区域',
      questionText: '',
      evidence: {
        chargeRows: Number(billingPressure.charge_rows),
        receivableSum: Number(billingPressure.receivable_sum),
        paidSum: Number(billingPressure.paid_sum),
        paidRatio: Number(billingPressure.paid_ratio),
        serviceRows: Number(billingPressure.service_rows),
        complaintRows: Number(billingPressure.complaint_rows),
      },
    });

    const servicePressure = serviceRes.rows.find((row) => {
      const complaintRows = Number(row.complaint_rows);
      return (
        row.project_id &&
        row.organization_id &&
        row.area_id &&
        !usedProjects.has(row.project_id) &&
        complaintRows > 0
      );
    });

    if (!servicePressure) {
      throw new Error('Failed to select a service-pressure real case from PG data.');
    }

    usedProjects.add(servicePressure.project_id);
    cases.push({
      caseId: 'service-pressure',
      direction: 'service-pressure',
      organizationId: servicePressure.organization_id,
      projectId: servicePressure.project_id,
      projectName: servicePressure.project_name,
      areaId: servicePressure.area_id ?? '',
      areaName: servicePressure.area_name ?? '未知区域',
      questionText: '',
      evidence: {
        serviceRows: Number(servicePressure.service_rows),
        complaintRows: Number(servicePressure.complaint_rows),
        lowSatisfactionRows: Number(servicePressure.low_satisfaction_rows),
      },
    });

    const healthyCollection = billingRes.rows.find((row) => {
      const paidRatio = Number(row.paid_ratio);
      return (
        row.project_id &&
        row.organization_id &&
        row.area_id &&
        !usedProjects.has(row.project_id) &&
        paidRatio >= 0.5
      );
    });

    if (!healthyCollection) {
      throw new Error('Failed to select a healthy-collection real case from PG data.');
    }

    cases.push({
      caseId: 'healthy-collection',
      direction: 'healthy-collection',
      organizationId: healthyCollection.organization_id,
      projectId: healthyCollection.project_id,
      projectName: healthyCollection.project_name,
      areaId: healthyCollection.area_id ?? '',
      areaName: healthyCollection.area_name ?? '未知区域',
      questionText: '',
      evidence: {
        chargeRows: Number(healthyCollection.charge_rows),
        receivableSum: Number(healthyCollection.receivable_sum),
        paidSum: Number(healthyCollection.paid_sum),
        paidRatio: Number(healthyCollection.paid_ratio),
      },
    });

    return cases.map((caseRecord) => ({
      ...caseRecord,
      questionText: buildCaseQuestion(caseRecord),
    }));
  } finally {
    await pool.end();
  }
}

async function createLoginCookie(scope: {
  employeeId: string;
  displayName: string;
  organizationId: string;
  projectId: string;
  areaId: string;
}) {
  const sessionStore = createPostgresSessionStore();
  const session = await sessionStore.createSession({
    userId: scope.employeeId,
    displayName: scope.displayName,
    scope: {
      organizationId: scope.organizationId,
      projectIds: [scope.projectId],
      areaIds: [scope.areaId],
      roleCodes: ['PROPERTY_ANALYST'],
    },
  });

  return `${getSessionCookieName()}=${createSessionCookieValue(session.sessionId)}`;
}

async function createAnalysisSession(baseUrl: string, cookie: string, questionText: string) {
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
  const sessionId = location.split('/').pop();

  if (!sessionId) {
    throw new Error('Failed to resolve sessionId from create-session redirect.');
  }

  return sessionId;
}

async function submitExecution(baseUrl: string, cookie: string, sessionId: string) {
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
  const redirectUrl = new URL(location);
  const executionId = redirectUrl.searchParams.get('executionId');

  if (!executionId) {
    throw new Error(`Execution redirect does not include executionId: ${location}`);
  }

  return { executionId, location };
}

async function readExecutionStream(baseUrl: string, cookie: string, input: {
  sessionId: string;
  executionId: string;
}) {
  const response = await fetch(
    `${baseUrl}/api/analysis/sessions/${input.sessionId}/stream?executionId=${input.executionId}`,
    {
      headers: {
        Cookie: cookie,
      },
    },
  );

  if (!response.ok || !response.body) {
    throw new Error(`Failed to open execution stream: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buffer = '';
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes('\n\n')) {
      const separatorIndex = buffer.indexOf('\n\n');
      const rawMessage = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const dataLine = rawMessage
        .split('\n')
        .find((line) => line.startsWith('data: '));

      if (!dataLine) {
        continue;
      }

      const event = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
      events.push(event);

      if (
        event.kind === 'execution-status' &&
        (event.status === 'completed' || event.status === 'failed')
      ) {
        await reader.cancel();
        return events;
      }
    }
  }

  await reader.cancel();
  throw new Error(`Execution stream timed out for ${input.executionId}.`);
}

async function waitForJobTerminalStatus(jobId: string, redisKeyPrefix: string) {
  const redis = createClient({
    url: REDIS_URL,
  });
  await redis.connect();

  try {
    const deadline = Date.now() + 30_000;
    const storageKey = `${redisKeyPrefix}:worker:${jobId}:data`;

    while (Date.now() < deadline) {
      const raw = await redis.get(storageKey);
      const job = raw ? (JSON.parse(raw) as { status?: string } & Record<string, unknown>) : null;

      if (job && (job.status === 'completed' || job.status === 'failed')) {
        return job;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Timed out waiting for job ${jobId} to reach a terminal state.`);
  } finally {
    await redis.quit();
  }
}

async function run() {
  const cases = await selectRealCases();
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runRedisKeyPrefix = `${BASE_REDIS_KEY_PREFIX}:real:${Date.now()}`;
  process.env.REDIS_KEY_PREFIX = runRedisKeyPrefix;
  const childEnv = {
    ...process.env,
    DATABASE_URL,
    REDIS_URL,
    REDIS_KEY_PREFIX: runRedisKeyPrefix,
    SESSION_SECRET,
    ENABLE_DEV_ERP_AUTH: '1',
  };

  console.log(`[real-regression] Redis key prefix: ${runRedisKeyPrefix}`);
  console.log('[real-regression] Selected real cases:');
  for (const caseRecord of cases) {
    console.log(
      JSON.stringify(
        {
          caseId: caseRecord.caseId,
          direction: caseRecord.direction,
          organizationId: caseRecord.organizationId,
          projectId: caseRecord.projectId,
          projectName: caseRecord.projectName,
          areaId: caseRecord.areaId,
          areaName: caseRecord.areaName,
          questionText: caseRecord.questionText,
          evidence: caseRecord.evidence,
        },
        null,
        2,
      ),
    );
  }

  await execFileAsync('pnpm', ['db:migrate'], {
    cwd: process.cwd(),
    env: childEnv,
  });
  await execFileAsync('pnpm', ['build'], {
    cwd: process.cwd(),
    env: childEnv,
  });

  const serverProcess = spawn(
    'pnpm',
    ['exec', 'next', 'start', '--port', String(port)],
    {
      cwd: process.cwd(),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const workerProcess = spawn('pnpm', ['worker:dev'], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (chunk) => {
    process.stdout.write(`[next] ${chunk}`);
  });
  serverProcess.stderr?.on('data', (chunk) => {
    process.stderr.write(`[next] ${chunk}`);
  });
  workerProcess.stdout?.on('data', (chunk) => {
    process.stdout.write(`[worker] ${chunk}`);
  });
  workerProcess.stderr?.on('data', (chunk) => {
    process.stderr.write(`[worker] ${chunk}`);
  });

  try {
    await Promise.all([
      waitForHttpReady(baseUrl, serverProcess),
      waitForWorkerReady(workerProcess),
    ]);

    const snapshotStore = createPostgresAnalysisExecutionSnapshotStore();
    const summaries: ExecutionSummary[] = [];

    for (const caseRecord of cases) {
      const cookie = await createLoginCookie({
        employeeId: `real-regression-${caseRecord.caseId}`,
        displayName: `真实回归-${caseRecord.projectName}`,
        organizationId: caseRecord.organizationId,
        projectId: caseRecord.projectId,
        areaId: caseRecord.areaId,
      });
      const sessionId = await createAnalysisSession(
        baseUrl,
        cookie,
        caseRecord.questionText,
      );
      const { executionId } = await submitExecution(baseUrl, cookie, sessionId);
      console.log(
        `[real-regression] Submitted ${caseRecord.caseId}: session=${sessionId} execution=${executionId}`,
      );
      const streamEvents = await readExecutionStream(baseUrl, cookie, {
        sessionId,
        executionId,
      });
      const terminalEvent = [...streamEvents]
        .reverse()
        .find(
          (event) =>
            event.kind === 'execution-status' &&
            (event.status === 'completed' || event.status === 'failed'),
        );

      if (!terminalEvent) {
        throw new Error(`Missing terminal execution status for ${executionId}.`);
      }

      const job = await waitForJobTerminalStatus(executionId, runRedisKeyPrefix);
      const snapshot = await snapshotStore.getByExecutionId(executionId);

      if (!snapshot) {
        throw new Error(`Missing persisted snapshot for execution ${executionId}.`);
      }

      assert.equal(
        snapshot.sessionId,
        sessionId,
        'Persisted snapshot should stay associated with the current session.',
      );
      assert.equal(
        snapshot.ownerUserId,
        `real-regression-${caseRecord.caseId}`,
        'Persisted snapshot owner should match the execution owner.',
      );
      assert.equal(
        snapshot.status,
        job?.status,
        'Snapshot status and job status should stay consistent.',
      );

      summaries.push({
        caseId: caseRecord.caseId,
        direction: caseRecord.direction,
        projectId: caseRecord.projectId,
        projectName: caseRecord.projectName,
        questionText: caseRecord.questionText,
        executionId,
        sessionId,
        streamTerminalStatus: terminalEvent.status as 'completed' | 'failed',
        jobStatus: job?.status ?? null,
        snapshotStatus: snapshot.status,
        publishedEventCount: streamEvents.length,
        persistedStepCount: snapshot.stepResults.length,
        topCauseSummary: snapshot.conclusionState.causes[0]?.summary ?? null,
        failurePointTitle: snapshot.failurePoint?.title ?? null,
      });
    }

    console.log('[real-regression] Execution summaries:');
    console.log(JSON.stringify(summaries, null, 2));
  } finally {
    serverProcess.kill('SIGINT');
    workerProcess.kill('SIGINT');
    await Promise.allSettled([once(serverProcess, 'exit'), once(workerProcess, 'exit')]);
  }
}

run().catch((error) => {
  console.error('[real-regression] Failed:', error);
  process.exit(1);
});
