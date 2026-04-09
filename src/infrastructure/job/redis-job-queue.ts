import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';

import type { JobQueue } from '../../application/job/ports';
import type { Job, JobSubmission } from '../../domain/job-contract/models';
import { redisKeys } from '../redis/keys';

function jobStorageKey(jobId: string) {
  return redisKeys.worker(jobId, 'data');
}

export function createRedisJobQueue(redis: RedisClientType): JobQueue {
  const queueKey = redisKeys.jobQueue();

  return {
    async submit(submission: JobSubmission): Promise<Job> {
      const job: Job = {
        id: submission.id ?? randomUUID(),
        type: submission.type,
        status: 'pending',
        data: submission.data ?? {},
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await redis.set(jobStorageKey(job.id), JSON.stringify(job));
      await redis.lPush(queueKey, job.id);

      return job;
    },

    async consume(): Promise<Job | null> {
      const jobId = await redis.rPop(queueKey);

      if (!jobId) {
        return null;
      }

      const raw = await redis.get(jobStorageKey(jobId));

      if (!raw) {
        return null;
      }

      const job: Job = JSON.parse(raw);
      job.status = 'processing';
      job.updatedAt = new Date().toISOString();

      await redis.set(jobStorageKey(job.id), JSON.stringify(job));

      return job;
    },

    async updateStatus(jobId, update): Promise<void> {
      const raw = await redis.get(jobStorageKey(jobId));

      if (!raw) {
        return;
      }

      const job: Job = JSON.parse(raw);
      job.status = update.status;
      job.updatedAt = update.updatedAt;

      if (update.result !== undefined) {
        job.result = update.result;
      }

      if (update.error !== undefined) {
        job.error = update.error;
      }

      await redis.set(jobStorageKey(job.id), JSON.stringify(job));
    },

    async getById(jobId): Promise<Job | null> {
      const raw = await redis.get(jobStorageKey(jobId));

      if (!raw) {
        return null;
      }

      return JSON.parse(raw);
    },
  };
}
