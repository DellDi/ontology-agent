import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

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

test('Redis job queue 具备真实 at-least-once 重投递和 DLQ 语义', async () => {
  const prefix = `oa-test-job-${randomUUID()}`;
  const result = await runTsSnippet(`
    process.env.REDIS_KEY_PREFIX = ${JSON.stringify(prefix)};

    const redisClientModule = (await import('./src/infrastructure/redis/client.ts')).default;
    const redisKeysModule = (await import('./src/infrastructure/redis/keys.ts')).default;
    const redisJobQueueModule = (await import('./src/infrastructure/job/redis-job-queue.ts')).default;

    const { createRedisClient } = redisClientModule;
    const { redisKeys } = redisKeysModule;
    const { createRedisJobQueue } = redisJobQueueModule;

    const { redis } = createRedisClient(${JSON.stringify(TEST_REDIS_URL)});
    await redis.connect();

    async function sleep(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }

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

    try {
      await deletePrefixedKeys();

      const consumerGroup = 'story-2-6-real';
      const firstConsumer = createRedisJobQueue(redis, {
        consumerGroup,
        consumerName: 'consumer-crashes-before-ack',
        visibilityTimeoutMs: 1,
        maxAttempts: 3,
      });
      const secondConsumer = createRedisJobQueue(redis, {
        consumerGroup,
        consumerName: 'consumer-reclaims-pending',
        visibilityTimeoutMs: 1,
        maxAttempts: 3,
      });

      const submitted = await firstConsumer.submit({
        id: 'job-redelivery',
        type: 'health-check',
        data: { probe: 'redelivery' },
      });
      const firstDelivery = await firstConsumer.consume();
      await sleep(20);
      const redelivered = await secondConsumer.consume();
      await secondConsumer.updateStatus('job-redelivery', {
        status: 'completed',
        result: { ok: true },
        updatedAt: new Date().toISOString(),
      });
      const completed = await secondConsumer.getById('job-redelivery');
      const pendingAfterAck = await redis.sendCommand([
        'XPENDING',
        redisKeys.jobQueue(),
        consumerGroup,
      ]);

      await deletePrefixedKeys();

      const dlqFirst = createRedisJobQueue(redis, {
        consumerGroup: 'story-2-6-dlq',
        consumerName: 'dlq-first',
        visibilityTimeoutMs: 1,
        maxAttempts: 1,
      });
      const dlqSecond = createRedisJobQueue(redis, {
        consumerGroup: 'story-2-6-dlq',
        consumerName: 'dlq-second',
        visibilityTimeoutMs: 1,
        maxAttempts: 1,
      });

      await dlqFirst.submit({
        id: 'job-dlq',
        type: 'health-check',
        data: { probe: 'dlq' },
      });
      const firstDlqDelivery = await dlqFirst.consume();
      await sleep(20);
      const secondDlqDelivery = await dlqSecond.consume();
      const failedDlqJob = await dlqSecond.getById('job-dlq');
      const dlqEntries = await redis.xRange(redisKeys.jobDeadLetterQueue(), '-', '+');

      console.log(JSON.stringify({
        submitted,
        firstDelivery,
        redelivered,
        completed,
        firstDlqDelivery,
        secondDlqDelivery,
        failedDlqJob,
        dlqEntries,
        pendingAfterAck,
      }));
    } finally {
      await deletePrefixedKeys();
      await redis.quit();
    }
  `);

  assert.equal(result.submitted.id, 'job-redelivery');
  assert.equal(result.firstDelivery.id, 'job-redelivery');
  assert.equal(result.redelivered.id, 'job-redelivery');
  assert.equal(result.redelivered.status, 'processing');
  assert.equal(result.completed.status, 'completed');
  assert.deepEqual(result.completed.result, { ok: true });
  assert.equal(
    Number(result.pendingAfterAck[0]),
    0,
    'completed job 应 XACK，不应继续留在 pending list',
  );

  assert.equal(result.firstDlqDelivery.id, 'job-dlq');
  assert.equal(result.secondDlqDelivery, null);
  assert.equal(result.failedDlqJob.status, 'failed');
  assert.match(result.failedDlqJob.error, /最大重试次数 1/);
  assert.equal(result.dlqEntries.length, 1);
  assert.equal(result.dlqEntries[0].message.jobId, 'job-dlq');
});
