import { randomUUID } from 'node:crypto';

import type { AnalysisSessionStore } from '@/application/analysis-session/ports';
import { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import { buildToolInputs } from '@/application/analysis-execution/tool-input-builder';
import { deriveCandidateFactorValidations } from '@/application/analysis-execution/candidate-factor-validation';
import type { ToolExecutionEventEmitter } from '@/application/analysis-execution/use-cases';
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
  buildStepCompletedEvent,
  buildStepResultEvent,
  buildStepRunningEvent,
  buildStepStartedEvent,
  buildToolCompletedEvent,
  buildToolFailedEvent,
  buildToolStartedEvent,
} from './analysis-execution-renderer';
import { translateToolName } from '@/application/analysis-message-projection/tool-name-translations';
import { createGraphUseCases } from '@/application/graph/use-cases';
import { getValidatedAnalysisExecutionJobData } from './analysis-execution-job';
import { callWithTimeout, LLMTimeoutError } from './timeout-utils';

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
    tool?: AnalysisExecutionStreamEvent['tool'];
    renderBlocks?: AnalysisExecutionStreamEvent['renderBlocks'];
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
    eventEmitter?: ToolExecutionEventEmitter;
    signal?: AbortSignal;
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
      // Story 12-5: 细粒度 step-started 事件（先于既有 step-lifecycle）
      await streamUseCases.publishEvent(
        buildStepStartedEvent({
          sessionId: jobData.sessionId,
          executionId: job.id,
          step,
        }),
      );

      await streamUseCases.publishEvent(
        buildStepRunningEvent({
          sessionId: jobData.sessionId,
          executionId: job.id,
          step,
        }),
      );

      const stepStartedAt = Date.now();

      // Story 12 fix: 创建实时事件发射器，在工具调用过程中发布事件
      //
      // 超时防护：当 callWithTimeout 触发 LLMTimeoutError 后，executeStep 内部的
      // 异步工具调用可能仍在运行。设置 emitterDisabled = true 可阻止这些 late events
      // 写入 Redis，避免 "step 已失败但工具又完成" 的混乱事件序列。
      let emitterDisabled = false;

      const eventEmitter = {
        async onToolStarted(input: {
          toolName: string;
          toolLabel: string;
          startedAt: number;
        }) {
          if (emitterDisabled) {
            return;
          }
          const toolLabel = translateToolName(input.toolName);
          await streamUseCases.publishEvent(
            buildToolStartedEvent({
              sessionId: jobData.sessionId,
              executionId: job.id,
              step,
              tool: { name: input.toolName, label: toolLabel },
            }),
          );
        },
        async onToolCompleted(input: {
          toolName: string;
          toolLabel: string;
          startedAt: number;
          finishedAt: number;
          output?: unknown;
        }) {
          if (emitterDisabled) {
            return;
          }
          const toolLabel = translateToolName(input.toolName);
          const durationMs = input.finishedAt - input.startedAt;
          await streamUseCases.publishEvent(
            buildToolCompletedEvent({
              sessionId: jobData.sessionId,
              executionId: job.id,
              step,
              tool: {
                name: input.toolName,
                label: toolLabel,
                output:
                  input.output &&
                  typeof input.output === 'object' &&
                  !Array.isArray(input.output)
                    ? (input.output as Record<string, unknown>)
                    : undefined,
                durationMs,
              },
            }),
          );
        },
        async onToolFailed(input: {
          toolName: string;
          toolLabel: string;
          startedAt: number;
          finishedAt: number;
          error: string;
        }) {
          if (emitterDisabled) {
            return;
          }
          const toolLabel = translateToolName(input.toolName);
          const durationMs = input.finishedAt - input.startedAt;
          await streamUseCases.publishEvent(
            buildToolFailedEvent({
              sessionId: jobData.sessionId,
              executionId: job.id,
              step,
              tool: {
                name: input.toolName,
                label: toolLabel,
                error: input.error,
                durationMs,
              },
            }),
          );
        },
      };

      let result: OrchestrationStepExecutionResult;
      try {
        result = await callWithTimeout(
          (signal) =>
            dependencies.analysisExecutionUseCases.executeStep({
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
              eventEmitter,
              signal,
            }),
        );
      } catch (error) {
        if (error instanceof LLMTimeoutError) {
          // 禁用事件发射器 — 超时后任何迟滞的工具完成事件都将被丢弃
          emitterDisabled = true;

          const stepDurationMs = Date.now() - stepStartedAt;

          await streamUseCases.publishEvent(
            buildStepCompletedEvent({
              sessionId: jobData.sessionId,
              executionId: job.id,
              step: {
                id: step.id,
                order: step.order,
                title: step.title,
                status: 'failed',
              },
              durationMs: stepDurationMs,
              toolCount: 0,
            }),
          );

          throw error;
        }
        throw error;
      }

      const stepDurationMs = Date.now() - stepStartedAt;

      // Story 12-5: step-completed 事件
      await streamUseCases.publishEvent(
        buildStepCompletedEvent({
          sessionId: jobData.sessionId,
          executionId: job.id,
          step: {
            id: step.id,
            order: step.order,
            title: step.title,
            status: result.status === 'completed' ? 'completed' : 'failed',
          },
          durationMs: stepDurationMs,
          toolCount: result.events.length,
        }),
      );

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
          metadata:
            step.id === 'validate-candidate-factors'
              ? {
                  validatedFactors: deriveCandidateFactorValidations({
                    candidateFactors: jobData.candidateFactors,
                    result,
                  }),
                }
              : undefined,
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
      async runMetricQuery(request, options) {
        return await semanticQueryUseCases.runMetricQuery(
          request as NonNullable<
            Parameters<typeof semanticQueryUseCases.runMetricQuery>[0]
          >,
          options,
        );
      },
      checkHealth: semanticQueryUseCases.checkHealth,
    },
graphUseCases: (() => {
      const graphAdapter = neo4jModule.createNeo4jGraphAdapter();
      const created = createGraphUseCases({
        graphReadPort: graphAdapter,
        graphWritePort: graphAdapter,
      });
      return {
        expandCandidateFactors: (request: unknown, options?: { signal?: AbortSignal }) =>
          created.expandCandidateFactors(
            request as Parameters<typeof created.expandCandidateFactors>[0],
            options,
          ),
        checkHealth: created.checkHealth,
      };
    })(),
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
