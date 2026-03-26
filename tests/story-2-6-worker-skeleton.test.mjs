import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let redis;

test.before(async () => {
  redis = createClient({ url: REDIS_URL });
  await redis.connect();
});

test.after(async () => {
  if (redis) {
    await redis.disconnect();
  }
});

test('worker 入口文件存在', async () => {
  const { stat } = await import('node:fs/promises');
  const workerEntry = new URL(
    '../src/worker/main.ts',
    import.meta.url,
  );
  const fileStat = await stat(workerEntry);
  assert.ok(fileStat.isFile(), 'src/worker/main.ts 应该存在');
});

test('worker handlers 文件存在', async () => {
  const { stat } = await import('node:fs/promises');
  const handlersFile = new URL(
    '../src/worker/handlers.ts',
    import.meta.url,
  );
  const fileStat = await stat(handlersFile);
  assert.ok(fileStat.isFile(), 'src/worker/handlers.ts 应该存在');
});

test('job contract 模型定义了支持的任务类型', async () => {
  const { readFile } = await import('node:fs/promises');
  const modelPath = new URL(
    '../src/domain/job-contract/models.ts',
    import.meta.url,
  );
  const content = await readFile(modelPath, 'utf-8');

  assert.match(content, /health-check/, '应该包含 health-check 任务类型');
  assert.match(content, /JobType/, '应该导出 JobType 类型');
  assert.match(content, /JobStatus/, '应该导出 JobStatus 类型');
  assert.match(content, /JobPayload/, '应该导出 JobPayload 类型');
  assert.match(content, /validateJobPayload/, '应该导出 validateJobPayload 函数');
});

test('合法 job payload 通过 Redis 队列提交和消费', async () => {
  const { createRedisJobQueue } = await import(
    '../src/infrastructure/job/redis-job-queue.ts'
  );

  const queue = createRedisJobQueue(redis);

  const job = await queue.submit({
    type: 'health-check',
    data: { source: 'test' },
  });

  assert.ok(job.id, '应该生成 job ID');
  assert.equal(job.type, 'health-check');
  assert.equal(job.status, 'pending');
  assert.deepEqual(job.data, { source: 'test' });

  const consumed = await queue.consume();
  assert.ok(consumed, '应该消费到任务');
  assert.equal(consumed.id, job.id);
  assert.equal(consumed.status, 'processing');

  await queue.updateStatus(job.id, {
    status: 'completed',
    result: { ok: true },
    updatedAt: new Date().toISOString(),
  });

  const completed = await queue.getById(job.id);
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.result, { ok: true });
});

test('空队列消费返回 null', async () => {
  const { createRedisJobQueue } = await import(
    '../src/infrastructure/job/redis-job-queue.ts'
  );

  const queue = createRedisJobQueue(redis);

  await redis.del('oa:job:queue');

  const result = await queue.consume();
  assert.equal(result, null, '空队列应该返回 null');
});

test('非法 payload 类型被拒绝', async () => {
  const { readFile } = await import('node:fs/promises');
  const modelContent = await readFile(
    new URL('../src/domain/job-contract/models.ts', import.meta.url),
    'utf-8',
  );

  assert.match(modelContent, /InvalidJobPayloadError/, '应该定义非法载荷错误类');

  const { createJobUseCases } = await import(
    '../src/application/job/use-cases.ts'
  );
  const { createRedisJobQueue } = await import(
    '../src/infrastructure/job/redis-job-queue.ts'
  );

  const queue = createRedisJobQueue(redis);
  const useCases = createJobUseCases({ jobQueue: queue });

  await assert.rejects(
    () => useCases.submitJob({ type: 'invalid-type' }),
    (err) => {
      assert.match(err.message, /不支持的任务类型/);
      return true;
    },
    '不支持的任务类型应该被拒绝',
  );
});

test('任务失败后状态和错误信息被正确记录', async () => {
  const { createRedisJobQueue } = await import(
    '../src/infrastructure/job/redis-job-queue.ts'
  );
  const { createJobUseCases } = await import(
    '../src/application/job/use-cases.ts'
  );

  const queue = createRedisJobQueue(redis);
  const useCases = createJobUseCases({ jobQueue: queue });

  const job = await useCases.submitJob({
    type: 'health-check',
    data: {},
  });

  await useCases.failJob(job.id, '模拟执行失败');

  const failed = await useCases.getJob(job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, '模拟执行失败');
});

test('compose.yaml 包含 worker 服务定义', async () => {
  const { readFile } = await import('node:fs/promises');
  const composePath = new URL('../compose.yaml', import.meta.url);
  const content = await readFile(composePath, 'utf-8');

  assert.match(content, /worker:/, 'compose.yaml 应该包含 worker 服务');
  assert.match(content, /worker:dev/, 'worker 应该使用 worker:dev 命令');
});

test('package.json 包含 worker:dev 脚本', async () => {
  const { readFile } = await import('node:fs/promises');
  const pkgPath = new URL('../package.json', import.meta.url);
  const content = await readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(content);

  assert.ok(pkg.scripts['worker:dev'], 'package.json 应该包含 worker:dev 脚本');
});
