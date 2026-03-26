import {
  type Job,
  type JobSubmission,
  validateJobPayload,
} from '@/domain/job-contract/models';

import type { JobQueue } from './ports';

type JobUseCasesDependencies = {
  jobQueue: JobQueue;
};

export function createJobUseCases({ jobQueue }: JobUseCasesDependencies) {
  return {
    async submitJob(submission: JobSubmission): Promise<Job> {
      validateJobPayload({ type: submission.type, data: submission.data });
      return await jobQueue.submit(submission);
    },

    async consumeNextJob(): Promise<Job | null> {
      return await jobQueue.consume();
    },

    async completeJob(
      jobId: string,
      result: Record<string, unknown>,
    ): Promise<void> {
      await jobQueue.updateStatus(jobId, {
        status: 'completed',
        result,
        updatedAt: new Date().toISOString(),
      });
    },

    async failJob(jobId: string, error: string): Promise<void> {
      await jobQueue.updateStatus(jobId, {
        status: 'failed',
        error,
        updatedAt: new Date().toISOString(),
      });
    },

    async getJob(jobId: string): Promise<Job | null> {
      return await jobQueue.getById(jobId);
    },
  };
}
