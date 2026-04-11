import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type {
  AnalysisToolInvocationResult,
  OrchestrationStepExecutionResult,
} from '@/domain/tooling/models';

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
  if (!event.ok) {
    return [
      {
        type: 'markdown',
        title: `工具失败：${event.toolName}`,
        content: event.error.message,
      },
    ];
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
      ];
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
      ];
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
      ];
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
      ];
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
      ];
    }
    default:
      return [];
  }
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
      toolEvents: input.result.events.length,
      conclusionSummary: structuredConclusion.summary ?? null,
      conclusionText: structuredConclusion.conclusion ?? null,
      conclusionConfidence: structuredConclusion.confidence ?? null,
      conclusionEvidence: structuredConclusion.evidence ?? [],
    },
  };
}
