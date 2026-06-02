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

  // Story 12 fix + Issue #8: 先发布终态事件，再保存 snapshot
  // 1. 发布 completed 事件到 stream（确保后续 listEvents 包含终态事件）
  // 2. 收集事件列表（此时已包含 completed 事件）
  // 3. 保存 snapshot（events 包含 completed；snapshot.status='completed' 作为兜底）
  // 4. 绑定 follow-up（如果失败，throw，main.ts 会发布 failed）
  // 5. 最后标记 job 完成

  // 第一步：发布 completed 事件（确保 snapshot 的事件列表包含终态状态）
  await analysisExecutionStreamUseCases.publishExecutionStatus({
    sessionId: jobData.sessionId,
    executionId: job.id,
    status: 'completed',
    message: '分析执行已完成，阶段结果已全部回传。',
    metadata: result,
  });

  // 第二步：收集事件（此时 stream 已包含 completed 事件）
  const events = await analysisExecutionStreamUseCases.listExecutionEvents({
    sessionId: jobData.sessionId,
    executionId: job.id,
  });
  const conclusionReadModel = buildAnalysisConclusionReadModel(events);

  // 第三步：保存 snapshot（events 已包含 completed 事件；snapshot.status 作为兜底）
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

  // 第三步：绑定 follow-up（如果有）
  if (jobData.followUpId) {
    await analysisFollowUpUseCases.attachFollowUpExecution({
      followUpId: jobData.followUpId,
      ownerUserId: jobData.ownerUserId,
      executionId: job.id,
    });
  }

  // 第四步：标记 job 完成（所有持久化已完成）
  await jobUseCases.completeJob(job.id, result);

  return {
    postCompletionError: null,
  };
}

const finalizeAnalysisExecutionModule = {
  finalizeSuccessfulAnalysisExecution,
};

export default finalizeAnalysisExecutionModule;
