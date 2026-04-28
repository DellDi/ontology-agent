import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createClient } from 'redis';
import nextEnv from '@next/env';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const { Pool } = pg;
const { loadEnvConfig } = nextEnv;

loadEnvConfig(repoRoot);

const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

async function canUsePostgres() {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      reason: 'DATABASE_URL 未配置，跳过真实 Postgres + Redis queue 测试。',
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
          'platform.jobs 表不存在；请先运行 pnpm db:migrate 后再执行真实 Postgres + Redis queue 测试。',
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

async function canUseRedis() {
  const redis = createClient({ url: TEST_REDIS_URL });

  try {
    await redis.connect();
    await redis.ping();
    return { ok: true, reason: null };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? `Redis 不可用：${error.message}`
          : 'Redis 不可用。',
    };
  } finally {
    if (redis.isOpen) {
      await redis.quit();
    }
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
        REDIS_URL: TEST_REDIS_URL,
      },
      maxBuffer: 1024 * 1024,
    },
  );

  return JSON.parse(stdout.trim());
}

test('Postgres-backed job queue 用 Redis 分发 jobId signal 且 terminal duplicate 不重复执行', async (t) => {
  const postgres = await canUsePostgres();
  if (!postgres.ok) {
    t.skip(postgres.reason);
    return;
  }

  const redisReady = await canUseRedis();
  if (!redisReady.ok) {
    t.skip(redisReady.reason);
    return;
  }

  const prefix = `oa-test-job-ledger-${randomUUID()}`;
  const jobId = `story-2-8-${randomUUID()}`;
  const result = await runTsSnippet(`
    process.env.REDIS_KEY_PREFIX = ${JSON.stringify(prefix)};

    const postgresClientModule = (await import('./src/infrastructure/postgres/client.ts')).default;
    const redisClientModule = (await import('./src/infrastructure/redis/client.ts')).default;
    const redisKeysModule = (await import('./src/infrastructure/redis/keys.ts')).default;
    const queueModule = (await import('./src/infrastructure/job/postgres-backed-job-queue.ts')).default;

    const { createPostgresDb } = postgresClientModule;
    const { createRedisClient } = redisClientModule;
    const { redisKeys } = redisKeysModule;
    const { createPostgresBackedJobQueue } = queueModule;

    const { db, pool } = createPostgresDb();
    const { redis } = createRedisClient(${JSON.stringify(TEST_REDIS_URL)});
    await redis.connect();

    async function deletePrefixedKeys() {
      let cursor = '0';
      do {
        const response = await redis.sendCommand([
          'SCAN',
          cursor,
          'MATCH',
          ${JSON.stringify(prefix)} + ':*',
          'COUNT',
          '100',
        ]);
        cursor = String(response[0]);
        const keys = response[1];
        if (Array.isArray(keys) && keys.length > 0) {
          await redis.del(keys);
        }
      } while (cursor !== '0');
    }

    async function cleanup() {
      await deletePrefixedKeys();
      await pool.query('delete from platform.job_dispatch_outbox where job_id = $1', [${JSON.stringify(jobId)}]);
      await pool.query('delete from platform.job_events where job_id = $1', [${JSON.stringify(jobId)}]);
      await pool.query('delete from platform.jobs where id = $1', [${JSON.stringify(jobId)}]);
    }

    try {
      await cleanup();

      const queue = createPostgresBackedJobQueue(
        { redis, db },
        {
          consumerGroup: 'story-2-8-dispatch',
          consumerName: 'worker-primary',
          visibilityTimeoutMs: 1,
          leaseDurationMs: 20,
        },
      );

      const submitted = await queue.submit({
        id: ${JSON.stringify(jobId)},
        type: 'health-check',
        data: { probe: 'postgres-backed-queue' },
      });
      const redisJobData = await redis.get(redisKeys.worker(${JSON.stringify(jobId)}, 'data'));
      const consumed = await queue.consume();
      await queue.updateStatus(${JSON.stringify(jobId)}, {
        status: 'completed',
        result: { ok: true },
        updatedAt: new Date().toISOString(),
      });
      const completed = await queue.getById(${JSON.stringify(jobId)});

      await redis.xAdd(redisKeys.jobQueue(), '*', { jobId: ${JSON.stringify(jobId)} });
      const duplicateConsume = await queue.consume();
      const pendingAfterDuplicate = await redis.sendCommand([
        'XPENDING',
        redisKeys.jobQueue(),
        'story-2-8-dispatch',
      ]);
      const eventCounts = await pool.query(
        'select event_type, count(*)::int as count from platform.job_events where job_id = $1 group by event_type',
        [${JSON.stringify(jobId)}],
      );

      console.log(JSON.stringify({
        submitted,
        redisJobData,
        consumed,
        completed,
        duplicateConsume,
        pendingAfterDuplicate,
        eventCounts: eventCounts.rows,
      }));
    } finally {
      await cleanup();
      await redis.quit();
      await pool.end();
    }
  `);

  assert.equal(result.submitted.status, 'queued');
  assert.equal(
    result.redisJobData,
    null,
    'Redis 不应保存 canonical job data',
  );
  assert.equal(result.consumed.id, jobId);
  assert.equal(result.consumed.status, 'processing');
  assert.equal(result.completed.status, 'completed');
  assert.deepEqual(result.completed.result, { ok: true });
  assert.equal(result.duplicateConsume, null);
  assert.equal(
    Number(result.pendingAfterDuplicate[0]),
    0,
    'terminal duplicate signal 应被 ack，不应留在 Redis pending list',
  );
  assert.equal(
    result.eventCounts.find((row) => row.event_type === 'completed')?.count,
    1,
    'completed event 应只记录一次',
  );
});
