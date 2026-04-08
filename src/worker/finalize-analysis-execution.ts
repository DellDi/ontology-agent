import { buildAnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { Job } from '@/domain/job-contract/models';

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
    events: import('@/domain/analysis-execution/stream-models').AnalysisExecutionStreamEvent[];
    conclusionReadModel: import('@/domain/analysis-result/models').AnalysisConclusionReadModel;
  }) => Promise<unknown>;
};

export async function finalizeSuccessfulAnalysisExecution({
  job,
  result,
  jobUseCases,
  analysisExecutionStreamUseCases,
  analysisExecutionPersistenceUseCases,
}: {
  job: Job;
  result: Record<string, unknown>;
  jobUseCases: CompletionJobUseCases;
  analysisExecutionStreamUseCases: CompletionStreamUseCases;
  analysisExecutionPersistenceUseCases: CompletionPersistenceUseCases;
}) {
  await jobUseCases.completeJob(job.id, result);

  try {
    await analysisExecutionStreamUseCases.publishExecutionStatus({
      sessionId: String(job.data.sessionId ?? ''),
      executionId: job.id,
      status: 'completed',
      message: '分析执行已完成，阶段结果已全部回传。',
      metadata: result,
    });

    const events = await analysisExecutionStreamUseCases.listExecutionEvents({
      sessionId: String(job.data.sessionId ?? ''),
      executionId: job.id,
    });
    const conclusionReadModel = buildAnalysisConclusionReadModel(events);

    await analysisExecutionPersistenceUseCases.saveExecutionSnapshot({
      executionId: job.id,
      sessionId: String(job.data.sessionId ?? ''),
      ownerUserId: String(job.data.ownerUserId ?? ''),
      status: 'completed',
      planSnapshot: job.data.plan as {
        mode: 'minimal' | 'multi-step';
        summary: string;
        steps: {
          id: string;
          order: number;
          title: string;
          objective: string;
          dependencyIds: string[];
        }[];
      },
      events,
      conclusionReadModel,
    });

    return {
      postCompletionError: null,
    };
  } catch (error) {
    return {
      postCompletionError:
        error instanceof Error ? error.message : '完成态副作用执行失败。',
    };
  }
}

const finalizeAnalysisExecutionModule = {
  finalizeSuccessfulAnalysisExecution,
};

export default finalizeAnalysisExecutionModule;
