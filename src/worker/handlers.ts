import { randomUUID } from 'node:crypto';

import type { AnalysisSessionStore } from '@/application/analysis-session/ports';
import { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import type { SemanticMetricKey } from '@/application/semantic-query/models';
import type { AnalysisContext } from '@/domain/analysis-context/models';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import { recognizeIntentFromQuestion } from '@/domain/analysis-intent/models';
import type { AuthSession } from '@/domain/auth/models';
import type { Job } from '@/domain/job-contract/models';
import type {
  AnalysisToolInvocationResult,
  AnalysisToolName,
  OrchestrationStepExecutionResult,
} from '@/domain/tooling/models';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';
import { checkRedisHealth } from '@/infrastructure/redis/health';
import type { RedisClientType } from 'redis';

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
    invocationContext: {
      correlationId: string;
      source: 'worker';
      sessionId?: string;
      userId?: string;
      organizationId?: string;
    };
    toolInputsByName: Partial<Record<AnalysisToolName, unknown>>;
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

function resolveSemanticMetricKey(
  metricValue: string,
  questionText: string,
): SemanticMetricKey {
  const usesTailArrearsSemantics =
    /尾欠|历史欠费|跨年未收|历史遗留/.test(metricValue) ||
    /尾欠|历史欠费|跨年未收|历史遗留/.test(questionText);

  if (/应收/.test(metricValue) || /应收/.test(questionText)) {
    return usesTailArrearsSemantics
      ? 'tail-arrears-receivable-amount'
      : 'project-receivable-amount';
  }

  if (/实收|回款金额/.test(metricValue) || /实收|回款金额/.test(questionText)) {
    return usesTailArrearsSemantics
      ? 'tail-arrears-paid-amount'
      : 'project-paid-amount';
  }

  if (/投诉/.test(metricValue) || /投诉/.test(questionText)) {
    return 'complaint-count';
  }

  if (/满意度|评分/.test(metricValue) || /满意度|评分/.test(questionText)) {
    return 'average-satisfaction';
  }

  if (/响应/.test(metricValue) || /响应/.test(questionText)) {
    return 'average-response-duration-hours';
  }

  if (/关闭时长|完工时长/.test(metricValue) || /关闭时长|完工时长/.test(questionText)) {
    return 'average-close-duration-hours';
  }

  if (/工单|报修|维修/.test(metricValue) || /工单|报修|维修/.test(questionText)) {
    return 'service-order-count';
  }

  return usesTailArrearsSemantics
    ? 'tail-arrears-collection-rate'
    : 'project-collection-rate';
}

function resolveDateDimension(metric: SemanticMetricKey) {
  switch (metric) {
    case 'project-collection-rate':
    case 'project-receivable-amount':
      return 'receivable-accounting-period' as const;
    case 'project-paid-amount':
    case 'tail-arrears-paid-amount':
      return 'payment-date' as const;
    case 'tail-arrears-collection-rate':
    case 'tail-arrears-receivable-amount':
      return 'billing-cycle-end-date' as const;
    case 'average-satisfaction':
    case 'average-close-duration-hours':
      return 'completed-at' as const;
    default:
      return 'created-at' as const;
  }
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function resolveDateRange(
  metric: SemanticMetricKey,
  context: AnalysisContext,
  now: Date = new Date(),
) {
  const value = context.timeRange.value;
  const current = new Date(now);

  if (/本月/.test(value)) {
    const from = new Date(current.getFullYear(), current.getMonth(), 1);

    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/上月/.test(value)) {
    const from = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    const to = new Date(current.getFullYear(), current.getMonth(), 0);

    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(to),
    };
  }

  if (/近三个月|最近三个月/.test(value)) {
    const from = new Date(current.getFullYear(), current.getMonth() - 2, 1);

    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/本季度/.test(value)) {
    const quarterMonth = Math.floor(current.getMonth() / 3) * 3;
    const from = new Date(current.getFullYear(), quarterMonth, 1);

    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/今年/.test(value)) {
    const from = new Date(current.getFullYear(), 0, 1);

    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(current),
    };
  }

  if (/去年/.test(value)) {
    const from = new Date(current.getFullYear() - 1, 0, 1);
    const to = new Date(current.getFullYear() - 1, 11, 31);

    return {
      dimension: resolveDateDimension(metric),
      from: formatDate(from),
      to: formatDate(to),
    };
  }

  return undefined;
}

function buildWorkerAuthSession(input: {
  sessionId: string;
  ownerUserId: string;
  organizationId: string;
  projectIds: string[];
  areaIds: string[];
}): AuthSession {
  return {
    userId: input.ownerUserId,
    displayName: 'analysis-execution-worker',
    scope: {
      organizationId: input.organizationId,
      projectIds: input.projectIds,
      areaIds: input.areaIds,
      roleCodes: ['PROPERTY_ANALYST'],
    },
    sessionId: input.sessionId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

function resolveErpResource(questionText: string) {
  if (/收费|回款|缴费|欠费/.test(questionText)) {
    return 'receivables' as const;
  }

  if (/工单|投诉|满意度|报修|维修/.test(questionText)) {
    return 'service-orders' as const;
  }

  return 'projects' as const;
}

function buildToolInputs(input: {
  sessionId: string;
  ownerUserId: string;
  organizationId: string;
  projectIds: string[];
  areaIds: string[];
  questionText: string;
  context: AnalysisContext;
  step: {
    id: string;
    title: string;
    objective: string;
  };
  planSummary: string;
}) {
  const intent = recognizeIntentFromQuestion(input.questionText);
  const metric = resolveSemanticMetricKey(
    input.context.targetMetric.value,
    input.questionText,
  );
  const authSession = buildWorkerAuthSession({
    sessionId: input.sessionId,
    ownerUserId: input.ownerUserId,
    organizationId: input.organizationId,
    projectIds: input.projectIds,
    areaIds: input.areaIds,
  });

  return {
    'platform.capability-status': {},
    'llm.structured-analysis': {
      taskType: 'conclusion-summary' as const,
      model: 'bailian/qwen3.6-plus',
      input: {
        questionText: input.questionText,
        evidenceSummary: [
          `步骤：${input.step.title}`,
          `目标：${input.step.objective}`,
          `指标：${input.context.targetMetric.value}`,
          `实体：${input.context.entity.value}`,
          `时间：${input.context.timeRange.value}`,
        ].join('\n'),
      },
      context: {
        userId: input.ownerUserId,
        organizationId: input.organizationId,
        purpose: 'analysis-execution',
        timeoutMs: 60_000,
        sessionId: input.sessionId,
      },
    },
    'cube.semantic-query': {
      metric,
      scope: {
        organizationId: input.organizationId,
        projectIds: input.projectIds,
      },
      dateRange: resolveDateRange(metric, input.context),
      groupBy: input.projectIds.length > 1 ? ['project-name'] : undefined,
      limit: 20,
    },
    'neo4j.graph-query': {
      intentType: intent.type,
      metric: input.context.targetMetric.value,
      entity: input.context.entity.value,
      timeRange: input.context.timeRange.value,
      questionText: input.questionText,
    },
    'erp.read-model': {
      resource: resolveErpResource(input.questionText),
      session: authSession,
    },
  } satisfies Partial<Record<AnalysisToolName, unknown>>;
}

function buildToolStatus(result: OrchestrationStepExecutionResult, toolName: string) {
  const matchedEvent = result.events.find((event) => event.toolName === toolName);

  if (!matchedEvent) {
    return 'selected' as const;
  }

  return matchedEvent.ok ? ('completed' as const) : ('failed' as const);
}

function buildResultBlocks(input: {
  step: {
    order: number;
    title: string;
  };
  result: OrchestrationStepExecutionResult;
  processedStepCount: number;
  totalStepCount: number;
}) {
  const blocks: AnalysisExecutionStreamEvent['renderBlocks'] = [
    {
      type: 'status',
      title: '阶段状态',
      value: input.result.status === 'completed' ? '已完成' : '已失败',
      tone: input.result.status === 'completed' ? 'success' : 'error',
    },
    {
      type: 'kv-list',
      title: '阶段结果',
      items: [
        { label: '当前步骤', value: input.step.title },
        {
          label: '进度',
          value: `${input.processedStepCount}/${input.totalStepCount}`,
        },
        {
          label: '工具选择策略',
          value: input.result.strategy,
        },
      ],
    },
    {
      type: 'tool-list',
      title: '工具调用',
      items: input.result.tools.map((tool) => ({
        toolName: tool.toolName,
        objective: tool.objective,
        status: buildToolStatus(input.result, tool.toolName),
      })),
    },
  ];

  for (const event of input.result.events) {
    blocks.push(...buildToolOutputBlocks(event));
  }

  return blocks;
}

function buildToolOutputBlocks(event: AnalysisToolInvocationResult) {
  if (!event.ok) {
    return [
      {
        type: 'markdown',
        title: `工具失败：${event.toolName}`,
        content: event.error.message,
      },
    ] satisfies AnalysisExecutionStreamEvent['renderBlocks'];
  }

  switch (event.toolName) {
    case 'cube.semantic-query': {
      const output = event.output as {
        metric: string;
        rowCount: number;
        rows: {
          value: number | null;
          time: string | null;
          dimensions: Record<string, string | null>;
        }[];
      };

      return [
        {
          type: 'table',
          title: '指标结果',
          columns: ['时间', '维度', '值'],
          rows: output.rows.slice(0, 5).map((row) => [
            row.time ?? '-',
            Object.entries(row.dimensions)
              .map(([key, value]) => `${key}=${value ?? '-'}`)
              .join(', ') || '-',
            row.value === null ? '-' : String(row.value),
          ]),
        },
      ] satisfies AnalysisExecutionStreamEvent['renderBlocks'];
    }
    case 'neo4j.graph-query': {
      const output = event.output as {
        factors: {
          factorLabel: string;
          relationType: string;
          explanation: string;
        }[];
      };

      return [
        {
          type: 'table',
          title: '候选因素',
          columns: ['因素', '关系', '说明'],
          rows: output.factors.slice(0, 5).map((factor) => [
            factor.factorLabel,
            factor.relationType,
            factor.explanation,
          ]),
        },
      ] satisfies AnalysisExecutionStreamEvent['renderBlocks'];
    }
    case 'erp.read-model': {
      const output = event.output as {
        resource: string;
        count: number;
      };

      return [
        {
          type: 'kv-list',
          title: 'ERP 读取结果',
          items: [
            { label: '资源', value: output.resource },
            { label: '记录数', value: String(output.count) },
          ],
        },
      ] satisfies AnalysisExecutionStreamEvent['renderBlocks'];
    }
    case 'llm.structured-analysis': {
      const output = event.output as {
        ok?: boolean;
        value?: {
          summary?: string;
          conclusion?: string;
        };
      };

      const summary = output.value?.summary?.trim();
      const conclusion = output.value?.conclusion?.trim();

      return [
        {
          type: 'markdown',
          title: '结构化分析摘要',
          content:
            [summary, conclusion ? `结论：${conclusion}` : null]
              .filter(Boolean)
              .join('\n\n') || '结构化分析未返回可展示摘要。',
        },
      ] satisfies AnalysisExecutionStreamEvent['renderBlocks'];
    }
    case 'platform.capability-status': {
      const output = event.output as {
        capabilities: {
          llm: { status: string };
          erp: { status: string };
          cube: { status: string };
          neo4j: { status: string };
        };
      };

      return [
        {
          type: 'kv-list',
          title: '平台能力状态',
          items: [
            { label: 'LLM', value: output.capabilities.llm.status },
            { label: 'ERP', value: output.capabilities.erp.status },
            { label: 'Cube', value: output.capabilities.cube.status },
            { label: 'Neo4j', value: output.capabilities.neo4j.status },
          ],
        },
      ] satisfies AnalysisExecutionStreamEvent['renderBlocks'];
    }
    default:
      return [];
  }
}

function extractStructuredConclusion(
  result: OrchestrationStepExecutionResult,
): {
  summary?: string;
  conclusion?: string;
  confidence?: number | null;
  evidence?: { label: string; summary: string }[];
} {
  const llmEvent = result.events.find(
    (event) => event.ok && event.toolName === 'llm.structured-analysis',
  );

  if (!llmEvent || !llmEvent.ok) {
    return {};
  }

  const output = llmEvent.output as {
    value?: {
      summary?: string;
      conclusion?: string;
      evidence?: { label?: string; detail?: string }[];
      confidence?: number;
    };
  };

  return {
    summary: output.value?.summary?.trim(),
    conclusion: output.value?.conclusion?.trim(),
    confidence:
      typeof output.value?.confidence === 'number'
        ? output.value.confidence
        : null,
    evidence: (output.value?.evidence ?? [])
      .map((item) => ({
        label: item.label?.trim() || '',
        summary: item.detail?.trim() || '',
      }))
      .filter((item) => item.label && item.summary),
  };
}

function buildStepResultMessage(result: OrchestrationStepExecutionResult, stepOrder: number) {
  if (result.status !== 'completed') {
    return result.error?.message ?? `步骤 ${stepOrder} 执行失败。`;
  }

  const structuredConclusion = extractStructuredConclusion(result);

  if (structuredConclusion.summary) {
    return structuredConclusion.summary;
  }

  const cubeEvent = result.events.find(
    (event) => event.ok && event.toolName === 'cube.semantic-query',
  );

  if (cubeEvent && cubeEvent.ok) {
    const output = cubeEvent.output as {
      metric?: string;
      rowCount?: number;
      rows?: { value: number | null }[];
    };

    return [
      output.metric ? `已返回指标 ${output.metric}` : '已返回指标结果',
      typeof output.rowCount === 'number' ? `${output.rowCount} 行` : null,
      output.rows?.[0]?.value !== null && output.rows?.[0]?.value !== undefined
        ? `首条值 ${output.rows[0].value}`
        : null,
    ]
      .filter(Boolean)
      .join('，');
  }

  const neo4jEvent = result.events.find(
    (event) => event.ok && event.toolName === 'neo4j.graph-query',
  );

  if (neo4jEvent && neo4jEvent.ok) {
    const output = neo4jEvent.output as {
      factors?: { factorLabel?: string }[];
    };
    const firstFactor = output.factors?.[0]?.factorLabel;
    const factorCount = output.factors?.length ?? 0;

    if (factorCount > 0) {
      return [
        `已扩展 ${factorCount} 个候选因素`,
        firstFactor ? `首个因素 ${firstFactor}` : null,
      ]
        .filter(Boolean)
        .join('，');
    }
  }

  const erpEvent = result.events.find(
    (event) => event.ok && event.toolName === 'erp.read-model',
  );

  if (erpEvent && erpEvent.ok) {
    const output = erpEvent.output as {
      resource?: string;
      count?: number;
    };

    return [
      '已读取 ERP 数据',
      output.resource ? `资源 ${output.resource}` : null,
      typeof output.count === 'number' ? `记录数 ${output.count}` : null,
    ]
      .filter(Boolean)
      .join('，');
  }

  return `步骤 ${stepOrder} 已完成，真实工具结果已回传。`;
}

function buildStepRunningEvent(input: {
  sessionId: string;
  executionId: string;
  step: {
    id: string;
    order: number;
    title: string;
    objective: string;
  };
}): Parameters<AnalysisExecutionStreamPublisher['publishEvent']>[0] {
  return {
    sessionId: input.sessionId,
    executionId: input.executionId,
    kind: 'step-lifecycle' as const,
    message: `正在执行步骤 ${input.step.order}：${input.step.title}`,
    step: {
      id: input.step.id,
      order: input.step.order,
      title: input.step.title,
      status: 'running' as const,
    },
    stage: {
      key: input.step.id,
      label: `步骤 ${input.step.order}`,
      status: 'running' as const,
    },
    renderBlocks: [
      {
        type: 'status',
        title: '执行进度',
        value: '执行中',
        tone: 'info' as const,
      },
      {
        type: 'kv-list',
        title: '当前步骤',
        items: [
          { label: '步骤标题', value: input.step.title },
          { label: '步骤目标', value: input.step.objective },
        ],
      },
    ],
  };
}

function buildStepResultEvent(input: {
  sessionId: string;
  executionId: string;
  step: {
    id: string;
    order: number;
    title: string;
  };
  result: OrchestrationStepExecutionResult;
  processedStepCount: number;
  totalStepCount: number;
}): Parameters<AnalysisExecutionStreamPublisher['publishEvent']>[0] {
  const status = input.result.status === 'completed' ? 'completed' : 'failed';
  const structuredConclusion = extractStructuredConclusion(input.result);
  const message = buildStepResultMessage(input.result, input.step.order);

  return {
    sessionId: input.sessionId,
    executionId: input.executionId,
    kind: 'stage-result' as const,
    message,
    step: {
      id: input.step.id,
      order: input.step.order,
      title: input.step.title,
      status,
    },
    stage: {
      key: input.step.id,
      label: `步骤 ${input.step.order}`,
      status,
    },
    renderBlocks: buildResultBlocks({
      step: input.step,
      result: input.result,
      processedStepCount: input.processedStepCount,
      totalStepCount: input.totalStepCount,
    }),
    metadata: {
      processedStepCount: input.processedStepCount,
      totalStepCount: input.totalStepCount,
      toolEvents: input.result.events.length,
      conclusionSummary: structuredConclusion.summary ?? null,
      conclusionText: structuredConclusion.conclusion ?? null,
      conclusionConfidence: structuredConclusion.confidence ?? null,
      conclusionEvidence: structuredConclusion.evidence ?? [],
    },
  };
}

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
          context: analysisSession.savedContext,
          step,
          planSummary: jobData.plan.summary,
        }),
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
