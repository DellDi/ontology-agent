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

  // Story 12 fix: 严格的完成顺序，确保状态一致性
  // 1. 先收集事件和构建结论模型（纯计算，不会失败）
  // 2. 保存 snapshot（如果失败，throw，不发布 completed 事件）
  // 3. 发布 completed 事件（如果失败，throw，main.ts 会发布 failed）
  // 4. 绑定 follow-up（如果失败，throw，main.ts 会发布 failed）
  // 5. 最后标记 job 完成
  //
  // 这样如果 snapshot 保存失败，stream 里不会有 completed 事件，
  // main.ts 发布 failed 事件时不会出现 completed → failed 的矛盾序列。

  const events = await analysisExecutionStreamUseCases.listExecutionEvents({
    sessionId: jobData.sessionId,
    executionId: job.id,
  });
  const conclusionReadModel = buildAnalysisConclusionReadModel(events);

  // 第一步：保存 snapshot（最可能失败的操作）
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

  // 第二步：发布 completed 事件（snapshot 已成功保存）
  await analysisExecutionStreamUseCases.publishExecutionStatus({
    sessionId: jobData.sessionId,
    executionId: job.id,
    status: 'completed',
    message: '分析执行已完成，阶段结果已全部回传。',
    metadata: result,
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
