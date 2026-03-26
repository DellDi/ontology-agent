import type { Job, JobSubmission } from '@/domain/job-contract/models';

export interface JobQueue {
  submit(submission: JobSubmission): Promise<Job>;
  consume(): Promise<Job | null>;
  updateStatus(
    jobId: string,
    update: Pick<Job, 'status' | 'updatedAt'> &
      Partial<Pick<Job, 'result' | 'error'>>,
  ): Promise<void>;
  getById(jobId: string): Promise<Job | null>;
}
