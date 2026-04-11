import { createRedisClient } from '@/infrastructure/redis/client';
import { createRedisJobQueue } from '@/infrastructure/job/redis-job-queue';
import { createJobUseCases } from '@/application/job/use-cases';
import { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import { createAnalysisExecutionPersistenceUseCases } from '@/application/analysis-execution/persistence-use-cases';
import { createAnalysisFollowUpUseCases } from '@/application/follow-up/use-cases';
import { buildAnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { createPostgresAnalysisSessionFollowUpStore } from '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';
import { getJobHandler } from './handlers';
import { getValidatedAnalysisExecutionJobData } from './analysis-execution-job';
import { finalizeSuccessfulAnalysisExecution } from './finalize-analysis-execution';

const POLL_INTERVAL_MS = 1000;

async function main() {
  console.log('[worker] 启动中...');

  const { redis } = createRedisClient();
  await redis.connect();
  console.log('[worker] Redis 连接成功');

  const jobQueue = createRedisJobQueue(redis);
  const jobUseCases = createJobUseCases({ jobQueue });
  const analysisExecutionStreamUseCases =
    createAnalysisExecutionStreamUseCases({
      eventStore: createRedisAnalysisExecutionEventStore(redis),
    });
  const analysisExecutionPersistenceUseCases =
    createAnalysisExecutionPersistenceUseCases({
      snapshotStore: createPostgresAnalysisExecutionSnapshotStore(),
    });
  const analysisFollowUpUseCases = createAnalysisFollowUpUseCases({
    followUpStore: createPostgresAnalysisSessionFollowUpStore(),
  });

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

      if (job.type === 'analysis-execution') {
        await analysisExecutionStreamUseCases.publishExecutionStatus({
          sessionId: String(job.data.sessionId ?? ''),
          executionId: job.id,
          status: 'processing',
          message: 'worker 已开始处理分析执行任务。',
          metadata: {
            jobType: job.type,
          },
        });
      }

      const handler = getJobHandler(job.type);

      if (!handler) {
        console.error(`[worker] 未知任务类型: ${job.type}`);
        await jobUseCases.failJob(job.id, `未知任务类型: ${job.type}`);
        continue;
      }

      try {
        const result = await handler(job, { redis });

        if (job.type === 'analysis-execution') {
          const completionOutcome =
            await finalizeSuccessfulAnalysisExecution({
              job,
              result,
              jobUseCases,
              analysisExecutionStreamUseCases,
              analysisExecutionPersistenceUseCases,
              analysisFollowUpUseCases,
            });

          if (completionOutcome.postCompletionError) {
            console.error(
              `[worker] 任务 ${job.id} 已完成，但完成态副作用失败: ${completionOutcome.postCompletionError}`,
            );
          }
        } else {
          await jobUseCases.completeJob(job.id, result);
        }
        console.log(`[worker] 任务 ${job.id} 完成`);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : '未知错误';
        await jobUseCases.failJob(job.id, errorMessage);
        if (job.type === 'analysis-execution') {
          const jobData = getValidatedAnalysisExecutionJobData(job);

          await analysisExecutionStreamUseCases.publishExecutionStatus({
            sessionId: jobData.sessionId,
            executionId: job.id,
            status: 'failed',
            message: errorMessage,
            metadata: {
              jobType: job.type,
            },
          });

          const events =
            await analysisExecutionStreamUseCases.listExecutionEvents({
              sessionId: jobData.sessionId,
              executionId: job.id,
            });
          const conclusionReadModel = buildAnalysisConclusionReadModel(events);

          await analysisExecutionPersistenceUseCases.saveExecutionSnapshot({
            executionId: job.id,
            sessionId: jobData.sessionId,
            ownerUserId: jobData.ownerUserId,
            followUpId: jobData.followUpId,
            status: 'failed',
            planSnapshot: jobData.plan,
            events,
            conclusionReadModel,
          });

          if (jobData.followUpId) {
            await analysisFollowUpUseCases.attachFollowUpExecution({
              followUpId: jobData.followUpId,
              ownerUserId: jobData.ownerUserId,
              executionId: job.id,
            });
          }
        }
        console.error(`[worker] 任务 ${job.id} 失败: ${errorMessage}`);
      }
    } catch (err) {
      console.error('[worker] 轮询异常:', err);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  console.log('[worker] 断开 Redis 连接...');
  await redis.destroy();
  console.log('[worker] 已退出');
}

main().catch((err) => {
  console.error('[worker] 启动失败:', err);
  process.exit(1);
});
