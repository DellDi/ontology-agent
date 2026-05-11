import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type {
  AnalysisToolInvocationResult,
  OrchestrationStepExecutionResult,
} from '@/domain/tooling/models';
import {
  buildToolRenderBlocks,
  summarizeToolEvent,
} from '@/shared/tooling/tool-event-presentation';
import { llmStructuredAnalysisOutputValueSchema } from '@/application/tooling/models';

export function buildToolStatus(
  result: OrchestrationStepExecutionResult,
  toolName: string,
): 'selected' | 'completed' | 'failed' {
  const matchedEvent = result.events.find((event) => event.toolName === toolName);

  if (!matchedEvent) {
    return 'selected';
  }

  return matchedEvent.ok ? 'completed' : 'failed';
}

export function buildToolOutputBlocks(
  event: AnalysisToolInvocationResult,
): AnalysisExecutionStreamEvent['renderBlocks'] {
  return buildToolRenderBlocks(event);
}

export function buildResultBlocks(input: {
  step: {
    order: number;
    title: string;
  };
  result: OrchestrationStepExecutionResult;
  processedStepCount: number;
  totalStepCount: number;
}): AnalysisExecutionStreamEvent['renderBlocks'] {
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

export function extractStructuredConclusion(result: OrchestrationStepExecutionResult): {
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

  const parsed = llmStructuredAnalysisOutputValueSchema.safeParse(llmEvent.output);
  if (!parsed.success || parsed.data.taskType !== 'conclusion-summary') {
    return {};
  }

  const value = parsed.data.value;

  return {
    summary: value.summary?.trim(),
    conclusion: value.conclusion?.trim(),
    confidence: typeof value.confidence === 'number' ? value.confidence : null,
    evidence: (value.evidence ?? [])
      .map((item) => ({
        label: item.label?.trim() || '',
        summary: item.detail?.trim() || '',
      }))
      .filter((item) => item.label && item.summary),
  };
}

export function buildStepResultMessage(
  result: OrchestrationStepExecutionResult,
  stepOrder: number,
): string {
  if (result.status !== 'completed') {
    return result.error?.message ?? `步骤 ${stepOrder} 执行失败。`;
  }

  const structuredConclusion = extractStructuredConclusion(result);

  if (structuredConclusion.summary) {
    return structuredConclusion.summary;
  }

  const emptyResultEvents = result.events.filter(
    (event) => !event.ok && event.error.code === 'tool-empty-result',
  );

  if (
    result.events.length > 0 &&
    emptyResultEvents.length === result.events.length
  ) {
    return `步骤 ${stepOrder} 已完成，但所有已选工具都未返回可用结果，请调整分析范围或检查数据口径。`;
  }

  const firstEventSummary = result.events
    .filter((event) => event.ok)
    .map(summarizeToolEvent)
    .find((value): value is string => Boolean(value));

  if (firstEventSummary) {
    return firstEventSummary;
  }

  return `步骤 ${stepOrder} 已完成，真实工具结果已回传。`;
}

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

export function buildStepRunningEvent(input: {
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

export function buildStepResultEvent(input: {
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
      processBoardProgress: {
        processed: input.processedStepCount,
        total: input.totalStepCount,
      },
      toolEvents: input.result.events.length,
      conclusionSummary: structuredConclusion.summary ?? null,
      conclusionText: structuredConclusion.conclusion ?? null,
      conclusionConfidence: structuredConclusion.confidence ?? null,
      conclusionEvidence: structuredConclusion.evidence ?? [],
    },
  };
}
