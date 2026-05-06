import type { AnalysisSession } from '@/domain/analysis-session/models';
import type { Job, JobStatus } from '@/domain/job-contract/models';
import type { AnalysisContext } from '@/domain/analysis-context/models';
import {
  type AnalysisExecutionPlanSnapshot,
  validateAnalysisExecutionPlanSnapshot,
} from '@/domain/analysis-execution/models';
import type { OntologyGroundedContext } from '@/domain/ontology/grounding';
import {
  assertOntologyVersionBindingIsPublished,
  getPlanOntologyVersionId,
} from '@/domain/ontology/version-binding';
import type { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import type { OntologyVersionStore } from '@/application/ontology/ports';

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
  ontologyVersionStore,
}: {
  jobUseCases: JobUseCases;
  analysisExecutionStreamUseCases?: ReturnType<
    typeof createAnalysisExecutionStreamUseCases
  >;
  ontologyVersionStore?: Pick<OntologyVersionStore, 'findById'>;
}) {
  async function assertPublishedOntologyVersion(ontologyVersionId?: string) {
    if (!ontologyVersionId || !ontologyVersionStore) {
      return;
    }

    const version = await ontologyVersionStore.findById(ontologyVersionId);
    assertOntologyVersionBindingIsPublished({ ontologyVersionId, version });
  }

  return {
    async submitExecution({
      session,
      plan,
      executionId,
      followUpId,
      questionText,
      context,
      groundedContext,
      originCorrelationId,
    }: {
      session: AnalysisSession;
      plan: AnalysisExecutionPlanSnapshot;
      executionId?: string;
      followUpId?: string | null;
      questionText?: string;
      context?: AnalysisContext;
      groundedContext?: OntologyGroundedContext;
      // Story 7.4 D2: web 发起执行时传入，worker 消费时恢复到同一条 trace。
      originCorrelationId?: string;
    }): Promise<SubmittedAnalysisExecution> {
      const executablePlan = validateAnalysisExecutionPlanSnapshot(plan);
      const submittedAt = new Date().toISOString();
      const ontologyVersionId =
        groundedContext?.ontologyVersionId ??
        getPlanOntologyVersionId(executablePlan) ??
        undefined;
      await assertPublishedOntologyVersion(ontologyVersionId);
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
          context,
          groundedContext,
          ontologyVersionId,
          submittedAt,
          plan: executablePlan,
          originCorrelationId,
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
