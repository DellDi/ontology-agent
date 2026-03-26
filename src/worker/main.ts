import { createRedisClient } from '@/infrastructure/redis/client';
import { createRedisJobQueue } from '@/infrastructure/job/redis-job-queue';
import { createJobUseCases } from '@/application/job/use-cases';
import { getJobHandler } from './handlers';

const POLL_INTERVAL_MS = 1000;

async function main() {
  console.log('[worker] 启动中...');

  const { redis } = createRedisClient();
  await redis.connect();
  console.log('[worker] Redis 连接成功');

  const jobQueue = createRedisJobQueue(redis);
  const jobUseCases = createJobUseCases({ jobQueue });

  let running = true;

  process.on('SIGINT', () => {
    console.log('[worker] 收到 SIGINT，准备退出...');
    running = false;
  });

  process.on('SIGTERM', () => {
    console.log('[worker] 收到 SIGTERM，准备退出...');
    running = false;
  });

  console.log('[worker] 开始轮询任务队列...');

  while (running) {
    try {
      const job = await jobUseCases.consumeNextJob();

      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      console.log(`[worker] 开始处理任务 ${job.id} (${job.type})`);

      const handler = getJobHandler(job.type);

      if (!handler) {
        console.error(`[worker] 未知任务类型: ${job.type}`);
        await jobUseCases.failJob(job.id, `未知任务类型: ${job.type}`);
        continue;
      }

      try {
        const result = await handler(job, { redis });
        await jobUseCases.completeJob(job.id, result);
        console.log(`[worker] 任务 ${job.id} 完成`);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : '未知错误';
        await jobUseCases.failJob(job.id, errorMessage);
        console.error(`[worker] 任务 ${job.id} 失败: ${errorMessage}`);
      }
    } catch (err) {
      console.error('[worker] 轮询异常:', err);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  console.log('[worker] 断开 Redis 连接...');
  await redis.disconnect();
  console.log('[worker] 已退出');
}

main().catch((err) => {
  console.error('[worker] 启动失败:', err);
  process.exit(1);
});
