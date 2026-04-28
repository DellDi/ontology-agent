import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('worker 入口文件存在', async () => {
  const workerEntry = path.join(repoRoot, 'src/worker/main.ts');
  const fileStat = await stat(workerEntry);
  assert.ok(fileStat.isFile(), 'src/worker/main.ts 应该存在');
});

test('worker handlers 文件存在', async () => {
  const handlersFile = path.join(repoRoot, 'src/worker/handlers.ts');
  const fileStat = await stat(handlersFile);
  assert.ok(fileStat.isFile(), 'src/worker/handlers.ts 应该存在');
});

test('job contract 模型定义了支持的任务类型', async () => {
  const content = await readRepoFile('src/domain/job-contract/models.ts');

  assert.match(content, /health-check/, '应该包含 health-check 任务类型');
  assert.match(content, /JobType/, '应该导出 JobType 类型');
  assert.match(content, /JobStatus/, '应该导出 JobStatus 类型');
  assert.match(content, /JobPayload/, '应该导出 JobPayload 类型');
  assert.match(content, /validateJobPayload/, '应该导出 validateJobPayload 函数');
});

test('redis-job-queue 实现 at-least-once 提交、消费、状态更新和按 ID 读取能力', async () => {
  const content = await readRepoFile(
    'src/infrastructure/job/redis-job-queue.ts',
  );

  assert.match(content, /createRedisJobQueue/);
  assert.match(content, /async submit\(/);
  assert.match(content, /async consume\(/);
  assert.match(content, /async updateStatus\(/);
  assert.match(content, /async getById\(/);

  assert.match(content, /XGROUP/, '应使用 Redis Streams consumer group');
  assert.match(content, /XREADGROUP/, '消费任务应通过 consumer group 读取');
  assert.match(content, /XAUTOCLAIM/, 'worker 崩溃后的 pending job 应可重新声明');
  assert.match(content, /XACK/, '完成或失败任务后应显式确认 stream entry');
  assert.match(content, /jobDeadLetterQueue/, '超过重试上限后应进入 dead-letter queue');
  assert.doesNotMatch(content, /rPop\(/, '不应在消费时直接弹出并丢失任务');
  assert.match(content, /status:\s*'pending'/, '提交后初始状态应为 pending');
  assert.match(content, /status\s*=\s*'processing'/, '消费后状态应更新为 processing');
  assert.match(
    content,
    /redisKeys\./,
    '队列 key 也应复用统一 redis key builder',
  );
  assert.doesNotMatch(
    content,
    /const QUEUE_KEY = 'oa:job:queue'/,
    '不应把队列 key 写死为固定 oa 前缀',
  );
});

test('web 请求路径复用 shared Redis client 且不关闭共享连接', async () => {
  const redisClient = await readRepoFile('src/infrastructure/redis/client.ts');
  const streamRoute = await readRepoFile(
    'src/app/api/analysis/sessions/[sessionId]/stream/route.ts',
  );
  const jobRuntime = await readRepoFile('src/infrastructure/job/runtime.ts');
  const healthRoute = await readRepoFile('src/app/api/health/route.ts');

  assert.match(redisClient, /getSharedRedisClient/);
  assert.match(streamRoute, /getSharedRedisClient/);
  assert.match(jobRuntime, /getSharedRedisClient/);
  assert.match(healthRoute, /getSharedRedisClient/);
  assert.doesNotMatch(streamRoute, /redis\.quit\(/);
  assert.doesNotMatch(jobRuntime, /redis\.quit\(/);
  assert.doesNotMatch(healthRoute, /redis\.quit\(/);
});

test('job use-cases 对 payload 做校验并提供任务状态流转接口', async () => {
  const content = await readRepoFile('src/application/job/use-cases.ts');

  assert.match(content, /validateJobPayload\(/, '提交任务前应做 payload 校验');
  assert.match(content, /submitJob/);
  assert.match(content, /consumeNextJob/);
  assert.match(content, /completeJob/);
  assert.match(content, /failJob/);
  assert.match(content, /getJob/);
});

test('compose.yaml 包含 worker 服务定义', async () => {
  const content = await readRepoFile('compose.yaml');

  assert.match(content, /worker:/, 'compose.yaml 应该包含 worker 服务');
  assert.match(content, /worker:dev/, 'worker 应该使用 worker:dev 命令');
});

test('package.json 包含 worker:dev 脚本', async () => {
  const content = await readRepoFile('package.json');
  const pkg = JSON.parse(content);

  assert.ok(pkg.scripts['worker:dev'], 'package.json 应该包含 worker:dev 脚本');
});
