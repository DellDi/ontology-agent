import { loadEnvConfig } from '@next/env';

// 加载 .env 文件（worker 独立运行时需要）
loadEnvConfig(process.cwd());

import {
  createLogger,
  metrics,
  rootLogger,
  generateCorrelationId,
  withCorrelationAsync,
} from '@/infrastructure/observability';
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
  // Story 7.4: worker 端独立命名服务，让日志平台的 `service` 字段能区分 web / worker。
  if (!process.env.OBSERVABILITY_SERVICE_NAME) {
    process.env.OBSERVABILITY_SERVICE_NAME = 'ontology-agent-worker';
  }
  const workerLogger = createLogger({ component: 'worker' });
  workerLogger.info('worker.starting');

  const { redis } = createRedisClient();
  await redis.connect();
  workerLogger.info('worker.redis_connected');

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
    workerLogger.info('worker.signal', { signal: 'SIGINT' });
    running = false;
  });

  process.on('SIGTERM', () => {
    workerLogger.info('worker.signal', { signal: 'SIGTERM' });
    running = false;
  });

  workerLogger.info('worker.poll_started');

  while (running) {
    try {
      const job = await jobUseCases.consumeNextJob();

      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      metrics.increment('worker.jobs.started');
      metrics.increment(`worker.jobs.by_type.${job.type}`);

      // Story 7.4 D2: 若 job payload 带有 originCorrelationId，
      // 复用同一条 trace；否则生成新的 id，保证 worker 日志永远可追踪。
      const rawOriginCorrelationId = (job.data as { originCorrelationId?: unknown })
        .originCorrelationId;
      const jobOriginCorrelationId =
        typeof rawOriginCorrelationId === 'string' &&
        rawOriginCorrelationId.trim().length > 0
          ? rawOriginCorrelationId.trim()
          : generateCorrelationId();
      const correlationOrigin: 'job-metadata' | 'generated' =
        typeof rawOriginCorrelationId === 'string' &&
        rawOriginCorrelationId.trim().length > 0
          ? 'job-metadata'
          : 'generated';
      const currentJob = job;

      await withCorrelationAsync(
        {
          correlationId: jobOriginCorrelationId,
          origin: correlationOrigin,
        },
        async () => {
      const jobLogger = workerLogger.child({
        jobId: currentJob.id,
        jobType: currentJob.type,
      });
      jobLogger.info('worker.job_started');

      if (currentJob.type === 'analysis-execution') {
        await analysisExecutionStreamUseCases.publishExecutionStatus({
          sessionId: String(currentJob.data.sessionId ?? ''),
          executionId: currentJob.id,
          status: 'processing',
          message: 'worker 已开始处理分析执行任务。',
          metadata: {
            jobType: currentJob.type,
          },
        });
      }

      const handler = getJobHandler(currentJob.type);

      if (!handler) {
        jobLogger.error('worker.job_unknown_type', {
          errorKind: 'worker.unknown_job_type',
        });
        metrics.increment('worker.jobs.failed');
        await jobUseCases.failJob(currentJob.id, `未知任务类型: ${currentJob.type}`);
        return;
      }

      try {
        const result = await handler(currentJob, { redis });

        if (currentJob.type === 'analysis-execution') {
          const completionOutcome =
            await finalizeSuccessfulAnalysisExecution({
              job: currentJob,
              result,
              jobUseCases,
              analysisExecutionStreamUseCases,
              analysisExecutionPersistenceUseCases,
              analysisFollowUpUseCases,
            });

          if (completionOutcome.postCompletionError) {
            jobLogger.error('worker.job_post_completion_failed', {
              errorKind: 'worker.post_completion',
              errorMessage: completionOutcome.postCompletionError,
            });
          }
        } else {
          await jobUseCases.completeJob(currentJob.id, result);
        }
        metrics.increment('worker.jobs.completed');
        jobLogger.info('worker.job_completed');
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : '未知错误';
        await jobUseCases.failJob(currentJob.id, errorMessage);
        if (currentJob.type === 'analysis-execution') {
          const jobData = getValidatedAnalysisExecutionJobData(currentJob);

          await analysisExecutionStreamUseCases.publishExecutionStatus({
            sessionId: jobData.sessionId,
            executionId: currentJob.id,
            status: 'failed',
            message: errorMessage,
            metadata: {
              jobType: currentJob.type,
            },
          });

          const events =
            await analysisExecutionStreamUseCases.listExecutionEvents({
              sessionId: jobData.sessionId,
              executionId: currentJob.id,
            });
          const conclusionReadModel = buildAnalysisConclusionReadModel(events);

          await analysisExecutionPersistenceUseCases.saveExecutionSnapshot({
            executionId: currentJob.id,
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
              executionId: currentJob.id,
            });
          }
        }
        metrics.increment('worker.jobs.failed');
        jobLogger.error('worker.job_failed', {
          errorKind: 'worker.job_failed',
          errorMessage,
        });
      }
        },
      );
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      metrics.increment('worker.poll_errors');
      workerLogger.error('worker.poll_error', {
        errorKind: 'worker.poll_error',
        errorMessage: errMessage,
      });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  workerLogger.info('worker.disconnecting');
  await redis.destroy();
  workerLogger.info('worker.exited');
}

main().catch((err) => {
  const errMessage = err instanceof Error ? err.message : String(err);
  rootLogger.error('worker.boot_failed', {
    errorKind: 'worker.boot',
    errorMessage: errMessage,
  });
  process.exit(1);
});
