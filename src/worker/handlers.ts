import { randomUUID } from 'node:crypto';

import type { AnalysisSessionStore } from '@/application/analysis-session/ports';
import { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import { buildToolInputs } from '@/application/analysis-execution/tool-input-builder';
import {
  recognizeIntentFromQuestion,
  type AnalysisIntentType,
} from '@/domain/analysis-intent/models';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { Job } from '@/domain/job-contract/models';
import type {
  AnalysisToolName,
  OrchestrationStepExecutionResult,
} from '@/domain/tooling/models';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';
import { checkRedisHealth } from '@/infrastructure/redis/health';
import type { RedisClientType } from 'redis';

import {
  buildStepResultEvent,
  buildStepRunningEvent,
} from './analysis-execution-renderer';
import { getValidatedAnalysisExecutionJobData } from './analysis-execution-job';

export type JobHandler = (
  job: Job,
  context: { redis: RedisClientType | null },
) => Promise<Record<string, unknown>>;

type AnalysisExecutionStreamPublisher = {
  publishEvent: (input: {
    sessionId: string;
    executionId: string;
    kind: AnalysisExecutionStreamEvent['kind'];
    status?: AnalysisExecutionStreamEvent['status'];
    message?: string;
    step?: AnalysisExecutionStreamEvent['step'];
    stage?: AnalysisExecutionStreamEvent['stage'];
    renderBlocks: AnalysisExecutionStreamEvent['renderBlocks'];
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>;
};

type AnalysisExecutionUseCases = {
  executeStep: (input: {
    stepId: string;
    stepTitle?: string;
    stepObjective?: string;
    questionText: string;
    planSummary?: string;
    selectionContext: {
      userId: string;
      organizationId: string;
      purpose: string;
      sessionId?: string;
    };
    intentType?: AnalysisIntentType;
    invocationContext: {
      correlationId: string;
      source: 'worker';
      sessionId?: string;
      userId?: string;
      organizationId?: string;
    };
    toolInputsByName: Partial<Record<AnalysisToolName, unknown>>;
    groundedContext?: import('@/domain/ontology/grounding').OntologyGroundedContext;
  }) => Promise<OrchestrationStepExecutionResult>;
};

type AnalysisExecutionHandlerDependencies = {
  analysisSessionStore: Pick<AnalysisSessionStore, 'getById'>;
  analysisExecutionUseCases: AnalysisExecutionUseCases;
  analysisExecutionStreamUseCases?: AnalysisExecutionStreamPublisher;
  createAnalysisExecutionStreamUseCases?: (
    context: {
      redis: RedisClientType | null;
    },
  ) => AnalysisExecutionStreamPublisher;
};

function resolveStreamUseCases(
  dependencies: AnalysisExecutionHandlerDependencies,
  context: { redis: RedisClientType | null },
) {
  if (dependencies.analysisExecutionStreamUseCases) {
    return dependencies.analysisExecutionStreamUseCases;
  }

  if (!dependencies.createAnalysisExecutionStreamUseCases) {
    throw new Error('缺少分析执行流式事件发布依赖。');
  }

  return dependencies.createAnalysisExecutionStreamUseCases(context);
}

export function createAnalysisExecutionJobHandler(
  dependencies: AnalysisExecutionHandlerDependencies,
): JobHandler {
  return async (job, context) => {
    const jobData = getValidatedAnalysisExecutionJobData(job);
    const analysisSession = await dependencies.analysisSessionStore.getById(
      jobData.sessionId,
    );

    if (!analysisSession || analysisSession.ownerUserId !== jobData.ownerUserId) {
      throw new Error('分析会话不存在，或当前执行任务已失去会话归属。');
    }

    const streamUseCases = resolveStreamUseCases(dependencies, context);
    let processedStepCount = 0;
    const inferredIntentType = recognizeIntentFromQuestion(jobData.questionText).type;

    for (const step of jobData.plan.steps) {
      await streamUseCases.publishEvent(
        buildStepRunningEvent({
          sessionId: jobData.sessionId,
          executionId: job.id,
          step,
        }),
      );

      const result = await dependencies.analysisExecutionUseCases.executeStep({
        stepId: step.id,
        stepTitle: step.title,
        stepObjective: step.objective,
        questionText: jobData.questionText,
        planSummary: jobData.plan.summary,
        selectionContext: {
          userId: jobData.ownerUserId,
          organizationId: jobData.organizationId,
          purpose: 'analysis-execution',
          sessionId: jobData.sessionId,
        },
        intentType: inferredIntentType,
        invocationContext: {
          correlationId: `${job.id}:${step.id}:${randomUUID()}`,
          source: 'worker',
          sessionId: jobData.sessionId,
          userId: jobData.ownerUserId,
          organizationId: jobData.organizationId,
        },
        toolInputsByName: buildToolInputs({
          sessionId: jobData.sessionId,
          ownerUserId: jobData.ownerUserId,
          organizationId: jobData.organizationId,
          projectIds: jobData.projectIds,
          areaIds: jobData.areaIds,
          questionText: jobData.questionText,
          context: jobData.context ?? analysisSession.savedContext,
          groundedContext: jobData.groundedContext,
          step,
          planSummary: jobData.plan.summary,
        }),
        groundedContext: jobData.groundedContext,
      });

      const nextProcessedCount =
        result.status === 'completed'
          ? processedStepCount + 1
          : processedStepCount;

      await streamUseCases.publishEvent(
        buildStepResultEvent({
          sessionId: jobData.sessionId,
          executionId: job.id,
          step,
          result,
          processedStepCount: nextProcessedCount,
          totalStepCount: jobData.plan.steps.length,
        }),
      );

      if (result.status === 'failed') {
        throw new Error(
          result.error?.message ?? `步骤 ${step.order} 执行失败。`,
        );
      }

      processedStepCount = nextProcessedCount;
    }

    return {
      executionId: job.id,
      sessionId: jobData.sessionId,
      processedStepCount,
      acceptedAt: new Date().toISOString(),
      stage: 'completed-with-real-tooling',
    };
  };
}

async function createDefaultAnalysisExecutionHandler(): Promise<JobHandler> {
  const [
    analysisAiModule,
    analysisAiContractModule,
    erpReadModule,
    llmModule,
    analysisSessionStoreModule,
    cubeModule,
    erpRepositoryModule,
    toolingModule,
    neo4jModule,
  ] = await Promise.all([
    import('@/application/analysis-ai/use-cases'),
    import('@/infrastructure/analysis-ai/contract-port'),
    import('@/application/erp-read/use-cases'),
    import('@/application/llm/use-cases'),
    import('@/infrastructure/analysis-session/postgres-analysis-session-store'),
    import('@/infrastructure/cube'),
    import('@/infrastructure/erp/postgres-erp-read-repository'),
    import('@/infrastructure/tooling'),
    import('@/infrastructure/neo4j'),
  ]);

  const analysisAiUseCases = await (async () => {
    try {
      const llmUseCases = llmModule.createLlmUseCases({
        provider: (await import('@/infrastructure/llm')).createOpenAiCompatibleLlmProvider(),
      });

      return analysisAiModule.createAnalysisAiUseCases({
        llmUseCases,
        contractPort: analysisAiContractModule.createAnalysisAiContractPort(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'LLM provider unavailable.';

      return {
        async runTask(request: {
          taskType: string;
        }) {
          return {
            taskType: request.taskType,
            ok: false,
            value:
              request.taskType === 'conclusion-summary'
                ? {
                    summary: 'LLM 当前不可用，暂不输出模型摘要。',
                    conclusion: '当前阶段仅保留真实工具结果，不追加模型判断。',
                    evidence: [],
                    confidence: 0,
                  }
                : {
                    strategy: 'LLM 当前不可用，已回退到步骤级保守映射。',
                    tools: [],
                  },
            issues: [
              {
                path: '$',
                message,
              },
            ],
            providerResult: {
              provider: 'unconfigured',
              model: 'unconfigured',
              finishReason: null,
            },
          };
        },
      };
    }
  })();
  const semanticQueryUseCases = (() => {
    try {
      return cubeModule.createCubeSemanticQueryServices().useCases;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Cube provider unavailable.';

      return {
        async runMetricQuery() {
          throw new Error(message);
        },
        async checkHealth() {
          return {
            ok: false,
            status: 503,
            latencyMs: 0,
            checkedAt: new Date().toISOString(),
            apiUrl: 'unconfigured',
          };
        },
      };
    }
  })();
  const erpReadUseCases = erpReadModule.createErpReadUseCases({
    erpReadPort: erpRepositoryModule.createPostgresErpReadRepository(),
  });
  const toolingServices = toolingModule.createAnalysisToolingServices({
    analysisAiUseCases,
    erpReadUseCases,
    semanticQueryUseCases: {
      async runMetricQuery(request) {
        return await semanticQueryUseCases.runMetricQuery(
          request as NonNullable<
            Parameters<typeof semanticQueryUseCases.runMetricQuery>[0]
          >,
        );
      },
      checkHealth: semanticQueryUseCases.checkHealth,
    },
    graphUseCases: {
      async expandCandidateFactors(request) {
        return await neo4jModule.graphUseCases.expandCandidateFactors(
          request as Parameters<
            typeof neo4jModule.graphUseCases.expandCandidateFactors
          >[0],
        );
      },
      checkHealth: neo4jModule.graphUseCases.checkHealth,
    },
  });

  return createAnalysisExecutionJobHandler({
    analysisSessionStore:
      analysisSessionStoreModule.createPostgresAnalysisSessionStore(),
    analysisExecutionUseCases: toolingServices.analysisExecutionUseCases,
    createAnalysisExecutionStreamUseCases(context) {
      if (!context.redis) {
        throw new Error('分析执行流式事件发布缺少 Redis 连接。');
      }

      const streamUseCases = createAnalysisExecutionStreamUseCases({
        eventStore: createRedisAnalysisExecutionEventStore(context.redis),
      });

      return {
        async publishEvent(input) {
          return await streamUseCases.publishEvent(input);
        },
      };
    },
  });
}

let defaultAnalysisExecutionHandlerPromise: Promise<JobHandler> | null = null;

const handlers: Record<string, JobHandler> = {
  'health-check': async (_job, { redis }) => {
    if (!redis) {
      throw new Error('health-check 任务缺少 Redis 连接。');
    }

    const health = await checkRedisHealth(redis);

    return {
      workerAlive: true,
      redisOk: health.ok,
      redisLatencyMs: health.latencyMs,
      timestamp: new Date().toISOString(),
    };
  },
  'analysis-execution': async (job, context) => {
    defaultAnalysisExecutionHandlerPromise ??=
      createDefaultAnalysisExecutionHandler();

    const handler = await defaultAnalysisExecutionHandlerPromise;

    return await handler(job, context);
  },
};

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers[type];
}

const handlersModule = {
  getJobHandler,
  createAnalysisExecutionJobHandler,
};

export default handlersModule;
