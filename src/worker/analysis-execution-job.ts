import type { AnalysisExecutionJobData } from '@/domain/analysis-execution/models';
import { validateAnalysisExecutionJobData } from '@/domain/analysis-execution/models';
import type { Job } from '@/domain/job-contract/models';

export function getValidatedAnalysisExecutionJobData(
  job: Pick<Job, 'type' | 'data'>,
): AnalysisExecutionJobData {
  if (job.type !== 'analysis-execution') {
    throw new Error(`不支持的任务类型: ${job.type}`);
  }

  return validateAnalysisExecutionJobData(job.data);
}
