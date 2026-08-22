import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import nextEnv from '@next/env';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const { Pool } = pg;
const { loadEnvConfig } = nextEnv;

loadEnvConfig(repoRoot);

async function canUsePostgres() {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      reason: 'DATABASE_URL 未配置，跳过真实 Postgres ledger 测试。',
    };
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const result = await pool.query(
      "select to_regclass('platform.jobs') as jobs_table",
    );

    if (!result.rows[0]?.jobs_table) {
      return {
        ok: false,
        reason:
          'platform.jobs 表不存在；请先运行 pnpm db:migrate 后再执行真实 Postgres ledger 测试。',
      };
    }

    return { ok: true, reason: null };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? `Postgres 不可用：${error.message}`
          : 'Postgres 不可用。',
    };
  } finally {
    await pool.end();
  }
}

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      maxBuffer: 1024 * 1024,
    },
  );

  return JSON.parse(stdout.trim());
}

test('Postgres job ledger 持久化 job 状态、lease、terminal 幂等与 DLQ', async (t) => {
  const postgres = await canUsePostgres();

  if (!postgres.ok) {
    t.skip(postgres.reason);
    return;
  }

  const jobPrefix = `story-2-8-${randomUUID()}`;
  const result = await runTsSnippet(`
    const postgresClientModule = (await import('./src/infrastructure/postgres/client.ts')).default;
    const ledgerModule = (await import('./src/infrastructure/job/postgres-job-ledger.ts')).default;

    const { createPostgresDb } = postgresClientModule;
    const { createPostgresJobLedger } = ledgerModule;
    const { db, pool } = createPostgresDb();
    const ledger = createPostgresJobLedger(db, {
      maxAttempts: 2,
      leaseDurationMs: 20,
    });

    async function sleep(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function cleanup() {
      await pool.query('delete from platform.job_dispatch_outbox where job_id like $1', [${JSON.stringify(jobPrefix)} + '%']);
      await pool.query('delete from platform.job_events where job_id like $1', [${JSON.stringify(jobPrefix)} + '%']);
      await pool.query('delete from platform.jobs where id like $1', [${JSON.stringify(jobPrefix)} + '%']);
    }

    try {
      await cleanup();

      const submitted = await ledger.create({
        id: ${JSON.stringify(jobPrefix)} + '-happy',
        type: 'health-check',
        data: {
          ownerUserId: 'user-1',
          organizationId: 'org-1',
          sessionId: 'session-1',
          originCorrelationId: 'corr-1',
        },
      });
      const outboxBeforeDispatch = await ledger.listPublishableOutbox(10);
      await ledger.markDispatchPublished({
        outboxId: outboxBeforeDispatch[0].id,
        jobId: submitted.id,
        redisStreamEntryId: '1-0',
      });
      const queued = await ledger.getById(submitted.id);
      const firstClaim = await ledger.claimJob({
        jobId: submitted.id,
        workerId: 'worker-a',
        redisStreamEntryId: '1-0',
      });
      const lockedClaim = await ledger.claimJob({
        jobId: submitted.id,
        workerId: 'worker-b',
        redisStreamEntryId: '1-0',
      });
      await sleep(30);
      const reclaimed = await ledger.claimJob({
        jobId: submitted.id,
        workerId: 'worker-b',
        redisStreamEntryId: '1-0',
      });
      await ledger.markCompleted({
        jobId: submitted.id,
        result: { ok: true },
        workerId: 'worker-b',
      });
      const completed = await ledger.getById(submitted.id);
      const terminalClaim = await ledger.claimJob({
        jobId: submitted.id,
        workerId: 'worker-c',
        redisStreamEntryId: '1-0',
      });

      const recoverableJob = await ledger.create({
        id: ${JSON.stringify(jobPrefix)} + '-recoverable',
        type: 'health-check',
        data: {},
      });
      const recoverableOutbox = await ledger.listPublishableOutbox(10);
      const recoverableOutboxItem = recoverableOutbox.find(
        (item) => item.jobId === recoverableJob.id,
      );
      await ledger.markDispatchPublished({
        outboxId: recoverableOutboxItem.id,
        jobId: recoverableJob.id,
        redisStreamEntryId: '3-0',
      });
      await ledger.claimJob({
        jobId: recoverableJob.id,
        workerId: 'worker-a',
        redisStreamEntryId: '3-0',
      });
      await sleep(30);
      const recoveredJobs = await ledger.recoverExpiredLeases(10);
      const outboxAfterRecovery = await ledger.listPublishableOutbox(10);

      const dlqJob = await ledger.create({
        id: ${JSON.stringify(jobPrefix)} + '-dlq',
        type: 'health-check',
        data: {},
      });
      const dlqOutbox = await ledger.listPublishableOutbox(10);
      const dlqOutboxItem = dlqOutbox.find((item) => item.jobId === dlqJob.id);
      await ledger.markDispatchPublished({
        outboxId: dlqOutboxItem.id,
        jobId: dlqJob.id,
        redisStreamEntryId: '2-0',
      });
      await ledger.claimJob({
        jobId: dlqJob.id,
        workerId: 'worker-a',
        redisStreamEntryId: '2-0',
      });
      await sleep(30);
      const secondDlqClaim = await ledger.claimJob({
        jobId: dlqJob.id,
        workerId: 'worker-b',
        redisStreamEntryId: '2-0',
      });
      await sleep(30);
      const deadLettered = await ledger.claimJob({
        jobId: dlqJob.id,
        workerId: 'worker-c',
        redisStreamEntryId: '2-0',
      });
      const dlqStored = await ledger.getById(dlqJob.id);

      const eventCounts = await pool.query(
        'select event_type, count(*)::int as count from platform.job_events where job_id like $1 group by event_type',
        [${JSON.stringify(jobPrefix)} + '%'],
      );

      console.log(JSON.stringify({
        submitted,
        outboxBeforeDispatch,
        queued,
        firstClaim,
        lockedClaim,
        reclaimed,
        completed,
        terminalClaim,
        recoveredJobs,
        outboxAfterRecovery,
        secondDlqClaim,
        deadLettered,
        dlqStored,
        eventCounts: eventCounts.rows,
      }));
    } finally {
      await cleanup();
      await pool.end();
    }
  `);

  assert.equal(result.submitted.status, 'pending');
  assert.equal(result.outboxBeforeDispatch[0].jobId, result.submitted.id);
  assert.equal(result.queued.status, 'queued');
  assert.equal(result.firstClaim.kind, 'claimed');
  assert.equal(result.firstClaim.job.status, 'processing');
  assert.equal(result.lockedClaim.kind, 'locked');
  assert.equal(result.reclaimed.kind, 'claimed');
  assert.equal(result.completed.status, 'completed');
  assert.deepEqual(result.completed.result, { ok: true });
  assert.equal(result.terminalClaim.kind, 'terminal');
  assert.ok(
    result.recoveredJobs.some((job) => job.id.endsWith('-recoverable')),
    '过期 lease 应被 recovery 重新置为可调度',
  );
  assert.ok(
    result.outboxAfterRecovery.some((item) =>
      item.jobId.endsWith('-recoverable'),
    ),
    'recovery 应补写 outbox，防止 Redis signal 丢失后无法唤醒',
  );
  assert.equal(result.secondDlqClaim.kind, 'claimed');
  assert.equal(result.deadLettered.kind, 'dead_lettered');
  assert.equal(result.dlqStored.status, 'dead_letter');
  assert.ok(
    result.eventCounts.some((row) => row.event_type === 'claimed'),
    '应记录 claimed 事件',
  );
});

test('TS Worker 不领取、终结、恢复或派发 Java-owned contract job', async (t) => {
  const postgres = await canUsePostgres();

  if (!postgres.ok) {
    t.skip(postgres.reason);
    return;
  }

  const jobPrefix = `story-2-8-contract-${randomUUID()}`;
  const result = await runTsSnippet(`
    const postgresClientModule = (await import('./src/infrastructure/postgres/client.ts')).default;
    const ledgerModule = (await import('./src/infrastructure/job/postgres-job-ledger.ts')).default;

    const { createPostgresDb } = postgresClientModule;
    const { createPostgresJobLedger } = ledgerModule;
    const { db, pool } = createPostgresDb();
    const ledger = createPostgresJobLedger(db, {
      maxAttempts: 3,
      leaseDurationMs: 60_000,
    });

    async function cleanup() {
      await pool.query('delete from platform.job_dispatch_outbox where job_id like $1', [${JSON.stringify(jobPrefix)} + '%']);
      await pool.query('delete from platform.job_events where job_id like $1', [${JSON.stringify(jobPrefix)} + '%']);
      await pool.query('delete from platform.jobs where id like $1', [${JSON.stringify(jobPrefix)} + '%']);
    }

    try {
      await cleanup();

      const javaContracts = ['java-initial-v1', 'java-follow-up-v1'];
      const javaClaimResults = [];
      for (const executionContract of javaContracts) {
        const contractSlug = executionContract.replaceAll('-', '_');
        const javaClaimJob = await ledger.create({
          id: ${JSON.stringify(jobPrefix)} + '-java-' + contractSlug + '-claim',
          type: 'analysis-execution',
          data: { executionContract },
        });
        const javaClaim = await ledger.claimJob({
          jobId: javaClaimJob.id,
          workerId: 'ts-worker',
        });
        const javaClaimState = await pool.query(
          'select status, attempt_count, locked_by from platform.jobs where id=$1',
          [javaClaimJob.id],
        );
        const terminalResults = [];
        const terminalCases = [
          {
            name: 'completed',
            mutate: (jobId) => ledger.markCompleted({ jobId, result: { invalid: true }, workerId: 'ts-worker' }),
          },
          {
            name: 'failed',
            mutate: (jobId) => ledger.markFailed({ jobId, error: 'invalid', workerId: 'ts-worker' }),
          },
          {
            name: 'dead-letter',
            mutate: (jobId) => ledger.markDeadLetter({ jobId, error: 'invalid', workerId: 'ts-worker' }),
          },
        ];
        for (const terminalCase of terminalCases) {
          const terminalJob = await ledger.create({
            id: ${JSON.stringify(jobPrefix)} + '-java-' + contractSlug + '-' + terminalCase.name,
            type: 'analysis-execution',
            data: { executionContract },
          });
          await pool.query(
            "update platform.jobs set status='processing', attempt_count=1, locked_by='ts-worker', locked_until=now() + interval '1 minute' where id=$1",
            [terminalJob.id],
          );
          let terminalError = null;
          try {
            await terminalCase.mutate(terminalJob.id);
          } catch (error) {
            terminalError = error instanceof Error ? error.message : String(error);
          }
          const terminalState = await pool.query(
            'select status, attempt_count, locked_by from platform.jobs where id=$1',
            [terminalJob.id],
          );
          const terminalEvents = await pool.query(
            "select event_type from platform.job_events where job_id=$1 and event_type in ('completed', 'failed', 'dead_lettered')",
            [terminalJob.id],
          );
          terminalResults.push({
            name: terminalCase.name,
            error: terminalError,
            state: terminalState.rows[0],
            events: terminalEvents.rows,
          });
        }
        const javaOutbox = await pool.query(
          'select count(*)::int as count from platform.job_dispatch_outbox where job_id=$1',
          [javaClaimJob.id],
        );
        javaClaimResults.push({
          executionContract,
          javaClaim,
          javaClaimState: javaClaimState.rows[0],
          terminalResults,
          javaOutboxCount: javaOutbox.rows[0].count,
        });
      }

      const tsClaimJob = await ledger.create({
        id: ${JSON.stringify(jobPrefix)} + '-ts-claim',
        type: 'health-check',
        data: {},
      });
      const tsClaim = await ledger.claimJob({
        jobId: tsClaimJob.id,
        workerId: 'ts-worker',
      });

      const javaExpiredJobs = [];
      for (const executionContract of javaContracts) {
        const javaExpiredJob = await ledger.create({
          id: ${JSON.stringify(jobPrefix)} + '-java-' + executionContract.replaceAll('-', '_') + '-expired',
          type: 'analysis-execution',
          data: { executionContract },
        });
        javaExpiredJobs.push(javaExpiredJob);
      }
      const tsExpiredJob = await ledger.create({
        id: ${JSON.stringify(jobPrefix)} + '-ts-expired',
        type: 'health-check',
        data: {},
      });
      await pool.query(
        "update platform.jobs set status='processing', attempt_count=1, locked_by='expired-worker', locked_until=now() - interval '1 minute' where id=any($1::text[])",
        [[...javaExpiredJobs.map((job) => job.id), tsExpiredJob.id]],
      );

      const recoveredJobs = await ledger.recoverExpiredLeases(100);
      const recoveredStates = await pool.query(
        'select id, status, attempt_count, locked_by from platform.jobs where id=any($1::text[]) order by id',
        [[...javaExpiredJobs.map((job) => job.id), tsExpiredJob.id]],
      );
      const outboxCounts = await pool.query(
        'select job_id, count(*)::int as count from platform.job_dispatch_outbox where job_id=any($1::text[]) group by job_id order by job_id',
        [[...javaExpiredJobs.map((job) => job.id), tsExpiredJob.id]],
      );
      const isolationEvents = await pool.query(
        'select job_id, event_type from platform.job_events where job_id like $1 order by job_id, created_at',
        [${JSON.stringify(jobPrefix)} + '%'],
      );

      console.log(JSON.stringify({
        javaClaimResults,
        tsClaim,
        recoveredJobIds: recoveredJobs.map((job) => job.id),
        recoveredStates: recoveredStates.rows,
        outboxCounts: outboxCounts.rows,
        isolationEvents: isolationEvents.rows,
      }));
    } finally {
      await cleanup();
      await pool.end();
    }
  `);

  assert.deepEqual(
    result.javaClaimResults.map((item) => item.executionContract),
    ['java-initial-v1', 'java-follow-up-v1'],
  );
  for (const item of result.javaClaimResults) {
    assert.equal(item.javaClaim.kind, 'not_found', item.executionContract);
    assert.deepEqual(item.javaClaimState, {
      status: 'pending',
      attempt_count: 0,
      locked_by: null,
    });
    assert.deepEqual(
      item.terminalResults.map((terminal) => terminal.name),
      ['completed', 'failed', 'dead-letter'],
    );
    for (const terminal of item.terminalResults) {
      assert.match(terminal.error, /not owned by this TypeScript worker lease/);
      assert.deepEqual(terminal.state, {
        status: 'processing',
        attempt_count: 1,
        locked_by: 'ts-worker',
      });
      assert.deepEqual(terminal.events, []);
    }
    assert.equal(item.javaOutboxCount, 0, `${item.executionContract} 不应进入 TS dispatch outbox`);
  }
  assert.equal(result.tsClaim.kind, 'claimed');
  assert.ok(result.recoveredJobIds.some((id) => id.endsWith('-ts-expired')));
  assert.ok(!result.recoveredJobIds.some((id) => id.includes('-java-')));

  const javaExpiredStates = result.recoveredStates.filter((row) => row.id.includes('-java-'));
  const tsExpiredState = result.recoveredStates.find((row) =>
    row.id.endsWith('-ts-expired'),
  );
  assert.equal(javaExpiredStates.length, 2);
  for (const state of javaExpiredStates) {
    assert.equal(state.status, 'processing');
    assert.equal(state.locked_by, 'expired-worker');
  }
  assert.equal(tsExpiredState.status, 'queued');
  assert.equal(tsExpiredState.locked_by, null);

  const javaOutboxes = result.outboxCounts.filter((row) => row.job_id.includes('-java-'));
  const tsOutbox = result.outboxCounts.find((row) =>
    row.job_id.endsWith('-ts-expired'),
  );
  assert.deepEqual(javaOutboxes, [], 'Java job 不应进入 TS dispatch outbox');
  assert.equal(tsOutbox.count, 2, 'TS job recovery 应补写 outbox');
  assert.ok(
    !result.isolationEvents.some(
      (event) =>
        event.job_id.includes('-java-') &&
        ['claimed', 'lease_expired'].includes(event.event_type),
    ),
    'Java contract job 不应产生 TS claim/recovery 事件',
  );
});
