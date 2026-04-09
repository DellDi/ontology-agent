import type { AnalysisSession } from '@/domain/analysis-session/models';
import type { Job, JobStatus } from '@/domain/job-contract/models';
import {
  type AnalysisExecutionPlanSnapshot,
  validateAnalysisExecutionPlanSnapshot,
} from '@/domain/analysis-execution/models';
import type { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';

type JobUseCases = {
  submitJob: (submission: {
    id?: string;
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
  analysisExecutionStreamUseCases,
}: {
  jobUseCases: JobUseCases;
  analysisExecutionStreamUseCases?: ReturnType<
    typeof createAnalysisExecutionStreamUseCases
  >;
}) {
  return {
    async submitExecution({
      session,
      plan,
      executionId,
      followUpId,
      questionText,
    }: {
      session: AnalysisSession;
      plan: AnalysisExecutionPlanSnapshot;
      executionId?: string;
      followUpId?: string | null;
      questionText?: string;
    }): Promise<SubmittedAnalysisExecution> {
      const executablePlan = validateAnalysisExecutionPlanSnapshot(plan);
      const submittedAt = new Date().toISOString();
      const job = await jobUseCases.submitJob({
        id: executionId,
        type: 'analysis-execution',
        data: {
          sessionId: session.id,
          ownerUserId: session.ownerUserId,
          organizationId: session.organizationId,
          projectIds: session.projectIds,
          areaIds: session.areaIds,
          followUpId: followUpId ?? null,
          questionText: questionText ?? session.questionText,
          submittedAt,
          plan: executablePlan,
        },
      });

      try {
        await analysisExecutionStreamUseCases?.publishExecutionStatus({
          sessionId: session.id,
          executionId: job.id,
          status: job.status,
          message: '执行任务已进入后台队列，等待 worker 开始处理。',
          metadata: {
            planStepCount: executablePlan.steps.length,
          },
        });
      } catch {
        // Stream status is best-effort; once the job is queued we must not
        // surface a submission failure and encourage duplicate retries.
      }

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
