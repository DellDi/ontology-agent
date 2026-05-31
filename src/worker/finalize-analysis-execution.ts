import { buildAnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { Job } from '@/domain/job-contract/models';
import { getValidatedAnalysisExecutionJobData } from './analysis-execution-job';

type CompletionJobUseCases = {
  completeJob: (
    jobId: string,
    result: Record<string, unknown>,
  ) => Promise<void>;
};

type CompletionStreamUseCases = {
  publishExecutionStatus: (input: {
    sessionId: string;
    executionId: string;
    status: 'completed';
    message: string;
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>;
  listExecutionEvents: (input: {
    sessionId: string;
    executionId: string;
  }) => Promise<
    import('@/domain/analysis-execution/stream-models').AnalysisExecutionStreamEvent[]
  >;
};

type CompletionPersistenceUseCases = {
  saveExecutionSnapshot: (input: {
    executionId: string;
    sessionId: string;
    ownerUserId: string;
    followUpId?: string | null;
    ontologyVersionId?: string | null;
    status: 'completed';
    planSnapshot: {
      mode: 'minimal' | 'multi-step';
      summary: string;
      steps: {
        id: string;
        order: number;
        title: string;
        objective: string;
        dependencyIds: string[];
      }[];
    };
    groundedContext?: import('@/domain/ontology/grounding').OntologyGroundedContext;
    events: import('@/domain/analysis-execution/stream-models').AnalysisExecutionStreamEvent[];
    conclusionReadModel: import('@/domain/analysis-result/models').AnalysisConclusionReadModel;
  }) => Promise<unknown>;
};

type CompletionFollowUpUseCases = {
  attachFollowUpExecution: (input: {
    followUpId: string;
    ownerUserId: string;
    executionId: string;
  }) => Promise<unknown>;
};

export async function finalizeSuccessfulAnalysisExecution({
  job,
  result,
  jobUseCases,
  analysisExecutionStreamUseCases,
  analysisExecutionPersistenceUseCases,
  analysisFollowUpUseCases,
}: {
  job: Job;
  result: Record<string, unknown>;
  jobUseCases: CompletionJobUseCases;
  analysisExecutionStreamUseCases: CompletionStreamUseCases;
  analysisExecutionPersistenceUseCases: CompletionPersistenceUseCases;
  analysisFollowUpUseCases: CompletionFollowUpUseCases;
}) {
  const jobData = getValidatedAnalysisExecutionJobData(job);

  // Story 12 fix: 先保存 snapshot + 发布完成事件，再标记 job 完成。
  // 如果 snapshot 保存失败，job 不应被标记为 completed，
  // 否则首页只读 snapshot 时会永久显示"待执行"。
  try {
    await analysisExecutionStreamUseCases.publishExecutionStatus({
      sessionId: jobData.sessionId,
      executionId: job.id,
      status: 'completed',
      message: '分析执行已完成，阶段结果已全部回传。',
      metadata: result,
    });

    const events = await analysisExecutionStreamUseCases.listExecutionEvents({
      sessionId: jobData.sessionId,
      executionId: job.id,
    });
    const conclusionReadModel = buildAnalysisConclusionReadModel(events);

    await analysisExecutionPersistenceUseCases.saveExecutionSnapshot({
      executionId: job.id,
      sessionId: jobData.sessionId,
      ownerUserId: jobData.ownerUserId,
      followUpId: jobData.followUpId,
      ontologyVersionId: jobData.ontologyVersionId ?? null,
      status: 'completed',
      planSnapshot: jobData.plan,
      groundedContext: jobData.groundedContext,
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
  } catch (error) {
    // snapshot 保存失败时不标记 job 完成，让错误向上冒泡由 main.ts 处理
    throw error;
  }

  await jobUseCases.completeJob(job.id, result);

  return {
    postCompletionError: null,
  };
}

const finalizeAnalysisExecutionModule = {
  finalizeSuccessfulAnalysisExecution,
};

export default finalizeAnalysisExecutionModule;
