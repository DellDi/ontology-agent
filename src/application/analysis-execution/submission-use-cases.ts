import type { AnalysisSession } from '@/domain/analysis-session/models';
import type { Job, JobStatus } from '@/domain/job-contract/models';
import {
  type AnalysisExecutionPlanSnapshot,
  validateAnalysisExecutionPlanSnapshot,
} from '@/domain/analysis-execution/models';

type JobUseCases = {
  submitJob: (submission: {
    type: 'analysis-execution';
    data: Record<string, unknown>;
  }) => Promise<Job>;
  getJob: (jobId: string) => Promise<Job | null>;
};

export type SubmittedAnalysisExecution = {
  executionId: string;
  sessionId: string;
  status: JobStatus;
  submittedAt: string;
  plan: AnalysisExecutionPlanSnapshot;
};

export function createAnalysisExecutionSubmissionUseCases({
  jobUseCases,
}: {
  jobUseCases: JobUseCases;
}) {
  return {
    async submitExecution({
      session,
      plan,
    }: {
      session: AnalysisSession;
      plan: AnalysisExecutionPlanSnapshot;
    }): Promise<SubmittedAnalysisExecution> {
      const executablePlan = validateAnalysisExecutionPlanSnapshot(plan);
      const submittedAt = new Date().toISOString();
      const job = await jobUseCases.submitJob({
        type: 'analysis-execution',
        data: {
          sessionId: session.id,
          ownerUserId: session.ownerUserId,
          organizationId: session.organizationId,
          projectIds: session.projectIds,
          areaIds: session.areaIds,
          questionText: session.questionText,
          submittedAt,
          plan: executablePlan,
        },
      });

      return {
        executionId: job.id,
        sessionId: session.id,
        status: job.status,
        submittedAt,
        plan: executablePlan,
      };
    },
  };
}

const analysisExecutionSubmissionUseCasesModule = {
  createAnalysisExecutionSubmissionUseCases,
};

export default analysisExecutionSubmissionUseCasesModule;
