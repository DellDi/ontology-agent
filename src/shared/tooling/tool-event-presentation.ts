import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisToolInvocationResult } from '@/domain/tooling/models';

type ToolEventPresentation = {
  summary: string | null;
  renderBlocks: AnalysisExecutionStreamEvent['renderBlocks'];
};

function buildFailurePresentation(
  event: Extract<AnalysisToolInvocationResult, { ok: false }>,
): ToolEventPresentation {
  return {
    summary: `工具 ${event.toolName} 失败：${event.error.message}`,
    renderBlocks: [
      {
        type: 'markdown',
        title: `工具失败：${event.toolName}`,
        content: event.error.message,
      },
    ],
  };
}

function buildSuccessPresentation(
  event: Extract<AnalysisToolInvocationResult, { ok: true }>,
): ToolEventPresentation {
  switch (event.toolName) {
    case 'cube.semantic-query': {
      const output = event.output as {
        metric?: string;
        rowCount?: number;
        rows?: {
          value: number | null;
          time: string | null;
          dimensions: Record<string, string | null>;
        }[];
      };
      const firstValue = output.rows?.[0]?.value;

      return {
        summary: [
          output.metric ? `指标 ${output.metric}` : 'Cube 指标',
          typeof output.rowCount === 'number' ? `返回 ${output.rowCount} 行` : null,
          firstValue !== null && firstValue !== undefined
            ? `首条值 ${firstValue}`
            : null,
        ]
          .filter(Boolean)
          .join('，'),
        renderBlocks: [
          {
            type: 'table',
            title: '指标结果',
            columns: ['时间', '维度', '值'],
            rows: (output.rows ?? []).slice(0, 5).map((row) => [
              row.time ?? '-',
              Object.entries(row.dimensions ?? {})
                .map(([key, value]) => `${key}=${value ?? '-'}`)
                .join(', ') || '-',
              row.value === null ? '-' : String(row.value),
            ]),
          },
        ],
      };
    }
    case 'neo4j.graph-query': {
      const output = event.output as {
        factors?: {
          factorLabel?: string;
          relationType?: string;
          explanation?: string;
        }[];
      };
      const firstFactor = output.factors?.[0];
      const factorCount = output.factors?.length ?? 0;

      return {
        summary:
          factorCount === 0
            ? 'Neo4j 未返回候选因素。'
            : [
                `Neo4j 返回 ${factorCount} 个候选因素`,
                firstFactor?.factorLabel
                  ? `首个因素 ${firstFactor.factorLabel}`
                  : null,
                firstFactor?.explanation ?? null,
              ]
                .filter(Boolean)
                .join('，'),
        renderBlocks: [
          {
            type: 'table',
            title: '候选因素',
            columns: ['因素', '关系', '说明'],
            rows: (output.factors ?? []).slice(0, 5).map((factor) => [
              factor.factorLabel ?? '-',
              factor.relationType ?? '-',
              factor.explanation ?? '-',
            ]),
          },
        ],
      };
    }
    case 'erp.read-model': {
      const output = event.output as {
        resource?: string;
        count?: number;
      };

      return {
        summary: [
          'ERP 读取结果',
          output.resource ? `资源 ${output.resource}` : null,
          typeof output.count === 'number' ? `记录数 ${output.count}` : null,
        ]
          .filter(Boolean)
          .join('，'),
        renderBlocks: [
          {
            type: 'kv-list',
            title: 'ERP 读取结果',
            items: [
              { label: '资源', value: output.resource ?? '-' },
              {
                label: '记录数',
                value:
                  typeof output.count === 'number' ? String(output.count) : '-',
              },
            ],
          },
        ],
      };
    }
    case 'llm.structured-analysis': {
      const output = event.output as {
        value?: {
          summary?: string;
          conclusion?: string;
        };
      };
      const summary = output.value?.summary?.trim();
      const conclusion = output.value?.conclusion?.trim();

      return {
        summary: summary || conclusion || '结构化分析已完成。',
        renderBlocks: [
          {
            type: 'markdown',
            title: '结构化分析摘要',
            content:
              [summary, conclusion ? `结论：${conclusion}` : null]
                .filter(Boolean)
                .join('\n\n') || '结构化分析未返回可展示摘要。',
          },
        ],
      };
    }
    case 'platform.capability-status': {
      const output = event.output as {
        capabilities?: {
          llm?: { status?: string };
          erp?: { status?: string };
          cube?: { status?: string };
          neo4j?: { status?: string };
        };
      };

      return {
        summary: [
          '平台能力状态',
          output.capabilities?.llm?.status
            ? `LLM=${output.capabilities.llm.status}`
            : null,
          output.capabilities?.erp?.status
            ? `ERP=${output.capabilities.erp.status}`
            : null,
          output.capabilities?.cube?.status
            ? `Cube=${output.capabilities.cube.status}`
            : null,
          output.capabilities?.neo4j?.status
            ? `Neo4j=${output.capabilities.neo4j.status}`
            : null,
        ]
          .filter(Boolean)
          .join('，'),
        renderBlocks: [
          {
            type: 'kv-list',
            title: '平台能力状态',
            items: [
              {
                label: 'LLM',
                value: output.capabilities?.llm?.status ?? 'unknown',
              },
              {
                label: 'ERP',
                value: output.capabilities?.erp?.status ?? 'unknown',
              },
              {
                label: 'Cube',
                value: output.capabilities?.cube?.status ?? 'unknown',
              },
              {
                label: 'Neo4j',
                value: output.capabilities?.neo4j?.status ?? 'unknown',
              },
            ],
          },
        ],
      };
    }
    default:
      return {
        summary: null,
        renderBlocks: [],
      };
  }
}

export function presentToolEvent(
  event: AnalysisToolInvocationResult,
): ToolEventPresentation {
  if (!event.ok) {
    return buildFailurePresentation(event);
  }

  return buildSuccessPresentation(event);
}

export function summarizeToolEvent(
  event: AnalysisToolInvocationResult,
): string | null {
  return presentToolEvent(event).summary;
}

export function buildToolRenderBlocks(
  event: AnalysisToolInvocationResult,
): AnalysisExecutionStreamEvent['renderBlocks'] {
  return presentToolEvent(event).renderBlocks;
}
