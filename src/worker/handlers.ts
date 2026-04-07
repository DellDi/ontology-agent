import type { Job } from '@/domain/job-contract/models';
import { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';
import { checkRedisHealth } from '@/infrastructure/redis/health';
import type { RedisClientType } from 'redis';

export type JobHandler = (
  job: Job,
  context: { redis: RedisClientType },
) => Promise<Record<string, unknown>>;

const handlers: Record<string, JobHandler> = {
  'health-check': async (_job, { redis }) => {
    const health = await checkRedisHealth(redis);

    return {
      workerAlive: true,
      redisOk: health.ok,
      redisLatencyMs: health.latencyMs,
      timestamp: new Date().toISOString(),
    };
  },
  'analysis-execution': async (job, { redis }) => {
    const plan = job.data.plan as
      | { steps?: { id?: string; order?: number; title?: string }[] }
      | undefined;
    const sessionId = String(job.data.sessionId ?? '');
    const executionId = job.id;
    const streamUseCases = createAnalysisExecutionStreamUseCases({
      eventStore: createRedisAnalysisExecutionEventStore(redis),
    });
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];

    let processedStepCount = 0;

    for (const step of steps) {
      const stepId = String(step.id ?? 'unknown-step');
      const stepOrder = typeof step.order === 'number' ? step.order : 0;
      const stepTitle = String(step.title ?? '未命名步骤');
      const tools = buildToolItemsForStep(stepId);

      await streamUseCases.publishEvent({
        sessionId,
        executionId,
        kind: 'step-lifecycle',
        message: `正在执行步骤 ${stepOrder}：${stepTitle}`,
        step: {
          id: stepId,
          order: stepOrder,
          title: stepTitle,
          status: 'running',
        },
        stage: {
          key: stepId,
          label: `步骤 ${stepOrder}`,
          status: 'running',
        },
        renderBlocks: [
          {
            type: 'status',
            title: '执行进度',
            value: '执行中',
            tone: 'info',
          },
          {
            type: 'kv-list',
            title: '当前步骤',
            items: [
              { label: '步骤标题', value: stepTitle },
              { label: '顺序', value: String(stepOrder) },
            ],
          },
          {
            type: 'tool-list',
            title: '工具调用',
            items: tools,
          },
        ],
      });

      processedStepCount += 1;

      const stageResultEvent = streamUseCases.createStageResultEvent({
        sessionId,
        executionId,
        step: {
          id: stepId,
          order: stepOrder,
          title: stepTitle,
          status: 'completed',
        },
        tools: tools.map((tool) => ({
          ...tool,
          status: 'completed',
        })),
        processedStepCount,
        totalStepCount: steps.length,
        message: `步骤 ${stepOrder} 已完成，阶段结果已生成。`,
      });

      await streamUseCases.publishEvent({
        sessionId,
        executionId,
        kind: stageResultEvent.kind,
        message: stageResultEvent.message,
        step: stageResultEvent.step,
        stage: stageResultEvent.stage,
        renderBlocks: stageResultEvent.renderBlocks,
        metadata: {
          processedStepCount,
          totalStepCount: steps.length,
        },
      });
    }

    return {
      executionId,
      sessionId,
      processedStepCount,
      acceptedAt: new Date().toISOString(),
      stage: 'queued-for-stream',
    };
  },
};

function buildToolItemsForStep(stepId: string) {
  switch (stepId) {
    case 'inspect-metric-change':
      return [
        {
          toolName: 'cube.semantic-query',
          objective: '读取语义层指标对比结果',
          status: 'selected' as const,
        },
      ];
    case 'validate-candidate-factors':
      return [
        {
          toolName: 'neo4j.graph-query',
          objective: '扩展候选因素关系',
          status: 'selected' as const,
        },
        {
          toolName: 'erp.read-model',
          objective: '读取范围内业务事实',
          status: 'selected' as const,
        },
      ];
    default:
      return [
        {
          toolName: 'llm.structured-analysis',
          objective: '执行结构化分析与阶段总结',
          status: 'selected' as const,
        },
      ];
  }
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers[type];
}
