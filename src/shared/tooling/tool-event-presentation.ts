import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisToolInvocationResult } from '@/domain/tooling/models';

type ToolEventPresentation = {
  summary: string | null;
  renderBlocks: NonNullable<AnalysisExecutionStreamEvent['renderBlocks']>;
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

const ERP_RESOURCE_LABELS: Record<string, string> = {
  projects: '项目基础数据',
  'service-orders': '工单数据',
  payments: '缴费记录',
  receivables: '应收数据',
  owners: '业主信息',
  complaints: '投诉记录',
};

const CUBE_DIMENSION_LABELS: Record<string, string> = {
  'project-name': '项目',
  'project-id': '项目',
  'charge-item-name': '收费项目',
  'charge-item-id': '收费项目',
  'service-type-name': '服务类型',
  'organization-id': '组织',
  'area-name': '区域',
};

function formatDimensions(dimensions: Record<string, string | null> | null | undefined): string {
  if (!dimensions) return '-';
  const entries = Object.entries(dimensions).filter(([, value]) => value != null);
  if (entries.length === 0) return '-';
  return entries
    .map(([key, value]) => {
      const label = CUBE_DIMENSION_LABELS[key] ?? key;
      return entries.length === 1 ? (value ?? '-') : `${label}：${value ?? '-'}`;
    })
    .join(', ');
}

function formatTimeForSummary(value: string | null | undefined) {
  if (!value) return '-';
  const monthMatch = value.match(/^(\d{4}-\d{2})/);
  return monthMatch?.[1] ?? value;
}

const NEO4J_RELATION_LABELS: Record<string, string> = {
  'contains': '包含',
  'belongs-to': '所属',
  'has-owner': '业主关联',
  'has-receivable': '应收关联',
  'has-payment': '缴费关联',
  'has-service-order': '工单关联',
  'has-complaint': '投诉关联',
  'has-satisfaction': '满意度关联',
  'causal': '因果关系',
};

function translateRelationType(raw: string | undefined): string {
  if (!raw) return '-';
  return NEO4J_RELATION_LABELS[raw] ?? raw;
}

const ERP_RESOURCE_PURPOSE: Record<string, string> = {
  projects: '项目匹配/范围校验',
  'service-orders': '工单履约分析',
  payments: '缴费行为分析',
  receivables: '应收账龄分析',
  owners: '业主画像',
  complaints: '投诉趋势分析',
};

function buildSuccessPresentation(
  event: Extract<AnalysisToolInvocationResult, { ok: true }>,
): ToolEventPresentation {
  switch (event.toolName) {
    case 'cube.semantic-query': {
      const output = event.output as {
        metric?: string;
        rowCount?: number;
        granularity?: string;
        diagnostics?: {
          summary?: string;
          ratio?: {
            numeratorRows?: number;
            denominatorRows?: number;
            rowsMissingNumerator?: number;
          };
        };
        rows?: {
          value: number | null;
          time: string | null;
          dimensions: Record<string, string | null>;
        }[];
      };
      const firstValue = output.rows?.[0]?.value;
      const isMonthly = output.granularity === 'month';
      const displayRows = isMonthly
        ? (output.rows ?? [])
        : (output.rows ?? []).slice(0, 5);
      const monthlyDetail =
        isMonthly && output.rows?.length
          ? `月度明细 ${output.rows
              .map((row) => `${formatTimeForSummary(row.time)}=${row.value ?? '-'}`)
              .join('，')}`
          : null;
      const monthlyChartBlock =
        isMonthly && output.rows?.some((row) => typeof row.value === 'number')
          ? [
              {
                type: 'chart' as const,
                title: '指标趋势',
                chartType: 'line' as const,
                series: [
                  {
                    name: output.metric ?? '指标',
                    points: output.rows
                      .filter((row) => typeof row.value === 'number')
                      .map((row) => ({
                        label: formatTimeForSummary(row.time),
                        value: row.value as number,
                      })),
                  },
                ],
              },
            ]
          : [];

      return {
        summary: [
          output.metric ? `指标 ${output.metric}` : 'Cube 指标',
          typeof output.rowCount === 'number' ? `返回 ${output.rowCount} 行` : null,
          firstValue !== null && firstValue !== undefined
            ? `首条值 ${firstValue}`
            : null,
          monthlyDetail,
          output.diagnostics?.summary ?? null,
        ]
          .filter(Boolean)
          .join('，'),
        renderBlocks: [
          ...monthlyChartBlock,
          {
            type: 'table',
            title: '指标结果',
            columns: ['时间', '维度', '值'],
            rows: displayRows.map((row) => [
              row.time ?? '-',
              formatDimensions(row.dimensions),
              row.value === null ? '-' : String(row.value),
            ]),
          },
          ...(output.diagnostics?.summary
            ? [
                {
                  type: 'kv-list' as const,
                  title: '指标诊断',
                  items: [
                    {
                      label: '诊断摘要',
                      value: output.diagnostics.summary,
                    },
                    ...(output.diagnostics.ratio
                      ? [
                          {
                            label: '分子行数',
                            value: String(output.diagnostics.ratio.numeratorRows ?? 0),
                          },
                          {
                            label: '分母行数',
                            value: String(output.diagnostics.ratio.denominatorRows ?? 0),
                          },
                          {
                            label: '缺少分子的结果行',
                            value: String(output.diagnostics.ratio.rowsMissingNumerator ?? 0),
                          },
                        ]
                      : []),
                  ],
                },
              ]
            : []),
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
            columns: ['因素', '关联类型', '说明'],
            rows: (output.factors ?? []).slice(0, 5).map((factor) => [
              factor.factorLabel ?? '-',
              translateRelationType(factor.relationType),
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
      const resourceLabel =
        ERP_RESOURCE_LABELS[output.resource ?? ''] ??
        output.resource ??
        '业务数据';
      const purpose =
        ERP_RESOURCE_PURPOSE[output.resource ?? ''] ?? '数据分析';

      return {
        summary: `已读取${resourceLabel} ${output.count ?? 0} 条，用于${purpose}。`,
        renderBlocks: [
          {
            type: 'kv-list',
            title: 'ERP 读取结果',
            items: [
              { label: '数据类型', value: resourceLabel },
              {
                label: '记录数',
                value:
                  typeof output.count === 'number' ? String(output.count) : '-',
              },
              { label: '用途', value: purpose },
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
): NonNullable<AnalysisExecutionStreamEvent['renderBlocks']> {
  return presentToolEvent(event).renderBlocks;
}
